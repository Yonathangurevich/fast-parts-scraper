const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Browser pool for reuse
const browserPool = [];
const MAX_BROWSERS = 2;
let initComplete = false;

// Optimized browser args for parts pages
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1920,1080',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--single-process',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--mute-audio'
];

// Initialize browser pool
async function initBrowserPool() {
    console.log('🚀 Initializing browser pool for parts scraping...');
    
    for (let i = 0; i < MAX_BROWSERS; i++) {
        try {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: BROWSER_ARGS,
                ignoreDefaultArgs: ['--enable-automation']
            });
            
            browserPool.push({ 
                browser, 
                busy: false,
                lastUsed: Date.now() 
            });
            
            console.log(`✅ Browser ${i + 1} ready for parts scraping`);
        } catch (error) {
            console.error(`❌ Failed to init browser ${i + 1}:`, error.message);
        }
    }
    
    initComplete = true;
}

// Get available browser
async function getBrowser() {
    // Wait for init if needed
    while (!initComplete) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Find available browser
    let browserObj = browserPool.find(b => !b.busy);
    
    if (!browserObj) {
        // All busy, wait and retry
        await new Promise(resolve => setTimeout(resolve, 500));
        return getBrowser();
    }
    
    browserObj.busy = true;
    browserObj.lastUsed = Date.now();
    return browserObj;
}

// Release browser
function releaseBrowser(browserObj) {
    if (browserObj) {
        browserObj.busy = false;
    }
}

// Main parts scraping function
async function scrapeParts(url, options = {}) {
    const startTime = Date.now();
    let browserObj = null;
    let page = null;
    
    try {
        console.log(`🔧 Scraping parts page: ${url.substring(0, 80)}...`);
        
        // Get browser from pool
        browserObj = await getBrowser();
        page = await browserObj.browser.newPage();
        
        // Block unnecessary resources for faster loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            
            // Block heavy resources but keep scripts and styles for parts table
            if (['image', 'media', 'font', 'texttrack', 'websocket', 'manifest'].includes(resourceType)) {
                req.abort();
            } 
            // Block analytics and tracking
            else if (url.includes('google-analytics') || 
                     url.includes('googletagmanager') || 
                     url.includes('facebook') ||
                     url.includes('doubleclick')) {
                req.abort();
            }
            else {
                req.continue();
            }
        });
        
        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Anti-detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });
        
        // Set headers
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });
        
        // Navigate to the page
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: options.timeout || 20000
        });
        
        console.log(`📄 Initial response: ${response.status()}`);
        
        // Check for Cloudflare
        let attempts = 0;
        let maxAttempts = 12;
        
        while (attempts < maxAttempts) {
            const title = await page.title();
            
            if (title.includes('Just a moment') || title.includes('Checking')) {
                console.log(`⏳ Cloudflare check ${attempts + 1}/${maxAttempts}...`);
                await page.waitForTimeout(1500);
                attempts++;
            } else {
                console.log('✅ Page loaded successfully');
                break;
            }
        }
        
        // Wait for parts table to load
        try {
            await Promise.race([
                page.waitForSelector('.parts-table', { timeout: 5000 }),
                page.waitForSelector('.part-number', { timeout: 5000 }),
                page.waitForSelector('table.table', { timeout: 5000 }),
                page.waitForSelector('[data-part-number]', { timeout: 5000 })
            ]);
            console.log('✅ Parts table detected');
            
            // Extra wait for dynamic content
            await page.waitForTimeout(1000);
        } catch (e) {
            console.log('⚠️ Parts table not found with selector, continuing...');
        }
        
        // Get the full HTML
        const html = await page.content();
        const finalUrl = page.url();
        const cookies = await page.cookies();
        
        // Simple check for parts data
        const hasPartsData = html.includes('part_number') || 
                           html.includes('partNumber') ||
                           html.includes('part-number') ||
                           html.includes('GM_OP');
        
        const elapsed = Date.now() - startTime;
        
        console.log(`✅ Scraping completed in ${elapsed}ms`);
        console.log(`📊 Has parts data: ${hasPartsData}`);
        
        return {
            success: true,
            html: html,
            url: finalUrl,
            cookies: cookies,
            hasData: hasPartsData,
            elapsed: elapsed
        };
        
    } catch (error) {
        console.error('❌ Scraping error:', error.message);
        return {
            success: false,
            error: error.message,
            url: url
        };
        
    } finally {
        if (page) {
            await page.close().catch(() => {});
        }
        if (browserObj) {
            releaseBrowser(browserObj);
        }
    }
}

// Main endpoint for parts scraping
app.post('/v1', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { cmd, url, maxTimeout = 25000 } = req.body;
        
        if (!url) {
            return res.status(400).json({
                status: 'error',
                message: 'URL is required'
            });
        }
        
        // Validate it's a parts page URL
        if (!url.includes('ssd=') || !url.includes('gid=')) {
            console.log('⚠️ Warning: URL might not be a parts page');
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔧 Parts Page Request`);
        console.log(`🔗 URL: ${url.substring(0, 100)}...`);
        console.log(`⏱️ Timeout: ${maxTimeout}ms`);
        console.log(`${'='.repeat(60)}\n`);
        
        // Scrape with timeout
        const result = await Promise.race([
            scrapeParts(url, { timeout: maxTimeout }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout exceeded')), maxTimeout)
            )
        ]);
        
        if (result.success) {
            const totalElapsed = Date.now() - startTime;
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`✅ SUCCESS - Total time: ${totalElapsed}ms`);
            console.log(`📄 HTML size: ${result.html.length} bytes`);
            console.log(`${'='.repeat(60)}\n`);
            
            res.json({
                status: 'ok',
                message: 'Success',
                solution: {
                    url: result.url,
                    status: 200,
                    response: result.html,
                    cookies: result.cookies || [],
                    userAgent: 'Mozilla/5.0'
                },
                metadata: {
                    hasData: result.hasData,
                    elapsed: totalElapsed
                },
                startTimestamp: startTime,
                endTimestamp: Date.now(),
                version: '1.0.0'
            });
        } else {
            throw new Error(result.error || 'Scraping failed');
        }
        
    } catch (error) {
        console.error(`❌ Request failed: ${error.message}`);
        
        res.status(500).json({
            status: 'error',
            message: error.message,
            solution: null
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    const memory = process.memoryUsage();
    
    res.json({
        status: 'healthy',
        service: 'parts-scraper',
        uptime: Math.round(process.uptime()) + 's',
        browsers: browserPool.length,
        activeBrowsers: browserPool.filter(b => b.busy).length,
        memory: {
            used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
            total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
        }
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
        <h1>🔧 Parts Scraper Service</h1>
        <p><strong>Purpose:</strong> Dedicated scraper for PartsOuq parts pages</p>
        <p><strong>Status:</strong> Running</p>
        <p><strong>Browsers:</strong> ${browserPool.length} active</p>
        <p><strong>Optimized for:</strong> URLs with ssd and gid parameters</p>
        <hr>
        <p><strong>Endpoints:</strong></p>
        <ul>
            <li>POST /v1 - Scrape parts page</li>
            <li>GET /health - Service health</li>
        </ul>
        <hr>
        <p><small>Version 1.0.0</small></p>
    `);
});

// Initialize and start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔════════════════════════════════════════╗
║     🔧 Parts Scraper Service           ║
║     Port: ${PORT}                          ║
║     Optimized for parts pages          ║
╚════════════════════════════════════════╝
    `);
    
    await initBrowserPool();
    console.log('✅ Service ready for parts scraping!');
});

// Cleanup on shutdown
process.on('SIGTERM', async () => {
    console.log('📛 Shutting down...');
    for (const browserObj of browserPool) {
        await browserObj.browser.close().catch(() => {});
    }
    process.exit(0);
});

// Keep browsers fresh - restart idle browsers
setInterval(async () => {
    const now = Date.now();
    for (let i = 0; i < browserPool.length; i++) {
        const browserObj = browserPool[i];
        // If browser idle for more than 5 minutes, restart it
        if (!browserObj.busy && (now - browserObj.lastUsed > 5 * 60 * 1000)) {
            console.log(`♻️ Recycling idle browser ${i + 1}`);
            try {
                await browserObj.browser.close();
                browserObj.browser = await puppeteer.launch({
                    headless: 'new',
                    args: BROWSER_ARGS,
                    ignoreDefaultArgs: ['--enable-automation']
                });
                browserObj.lastUsed = now;
            } catch (error) {
                console.error(`Failed to recycle browser ${i + 1}:`, error.message);
            }
        }
    }
}, 60000); // Check every minute
