const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// SmartProxy Configuration - YOUR EXACT SETTINGS
const PROXY_CONFIG = {
    server: 'eu.smartproxy.com:3120',  // EU endpoint with Israel IP
    username: process.env.PROXY_USERNAME || 'smart-byparr_area-IL_city-TELAVIV',
    password: process.env.PROXY_PASSWORD || '1209QWEasdzxcv'
};

// Browser pool
const browserPool = [];
const MAX_BROWSERS = 2;
let initComplete = false;

// Browser args WITH proxy
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
    `--proxy-server=http://${PROXY_CONFIG.server}`  // SmartProxy server
];

// Initialize browser pool
async function initBrowserPool() {
    console.log('🚀 Initializing browsers with SmartProxy Israel IP...');
    
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
            
            console.log(`✅ Browser ${i + 1} ready with Israel proxy`);
        } catch (error) {
            console.error(`❌ Failed to init browser ${i + 1}:`, error.message);
        }
    }
    
    initComplete = true;
}

// Get available browser
async function getBrowser() {
    while (!initComplete) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    let browserObj = browserPool.find(b => !b.busy);
    
    if (!browserObj && browserPool.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        return getBrowser();
    }
    
    if (browserObj) {
        browserObj.busy = true;
        browserObj.lastUsed = Date.now();
    }
    
    return browserObj;
}

// Release browser
function releaseBrowser(browserObj) {
    if (browserObj) {
        browserObj.busy = false;
    }
}

// Scraping with SmartProxy
async function scrapeParts(url, options = {}) {
    const startTime = Date.now();
    let browserObj = null;
    let page = null;
    
    try {
        console.log(`🇮🇱 Scraping via SmartProxy Israel: ${url.substring(0, 80)}...`);
        
        browserObj = await getBrowser();
        if (!browserObj) {
            throw new Error('No browser available');
        }
        
        page = await browserObj.browser.newPage();
        
        // CRITICAL: Authenticate with SmartProxy
        await page.authenticate({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
        
        console.log('🔐 Proxy authenticated (Tel Aviv IP)');
        
        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Advanced stealth
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
            
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1,2,3,4,5]
            });
            
            Object.defineProperty(navigator, 'languages', {
                get: () => ['he-IL', 'he', 'en-US', 'en']  // Israel languages
            });
            
            // Set timezone to Israel
            Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
                value: function() {
                    return {
                        timeZone: 'Asia/Jerusalem',
                        locale: 'he-IL'
                    };
                }
            });
        });
        
        // Set headers
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',  // Israel locale
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });
        
        // Navigate
        console.log('📍 Navigating with Tel Aviv IP...');
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        console.log(`📄 Status: ${response.status()}`);
        
        // Debug IP if needed
        if (response.status() === 403 || response.status() === 404) {
            console.log('⚠️ Got error status, checking proxy IP...');
            try {
                const testPage = await browserObj.browser.newPage();
                await testPage.authenticate({
                    username: PROXY_CONFIG.username,
                    password: PROXY_CONFIG.password
                });
                await testPage.goto('http://ipinfo.io/json', { timeout: 10000 });
                const ipInfo = await testPage.evaluate(() => document.body.innerText);
                console.log('🌍 Current IP info:', ipInfo);
                await testPage.close();
            } catch (e) {
                console.log('Could not check IP:', e.message);
            }
        }
        
        // Check for Cloudflare
        let attempts = 0;
        const maxAttempts = 8;  // Faster with proxy
        
        while (attempts < maxAttempts) {
            const title = await page.title();
            
            if (title.includes('Just a moment') || title.includes('Checking')) {
                console.log(`⏳ Cloudflare check ${attempts + 1}/${maxAttempts}...`);
                await page.waitForTimeout(1500);
                attempts++;
                
                const currentUrl = page.url();
                if (currentUrl.includes('/parts') && currentUrl.includes('gid=')) {
                    console.log('✅ Redirected to parts page!');
                    break;
                }
            } else {
                console.log('✅ Page loaded successfully!');
                break;
            }
        }
        
        // Wait for content
        await page.waitForTimeout(2000);
        
        // Try to wait for parts table
        try {
            await page.waitForSelector('table, .part-row, [data-part]', { 
                timeout: 3000 
            });
            console.log('✅ Parts table found');
        } catch (e) {
            console.log('⚠️ No parts selector found');
        }
        
        // Get content
        const html = await page.content();
        const finalUrl = page.url();
        const cookies = await page.cookies();
        
        const elapsed = Date.now() - startTime;
        console.log(`✅ Completed in ${elapsed}ms`);
        
        return {
            success: true,
            html: html,
            url: finalUrl,
            cookies: cookies,
            elapsed: elapsed
        };
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return {
            success: false,
            error: error.message
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

// Main endpoint
app.post('/v1', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { cmd, url, maxTimeout = 30000 } = req.body;
        
        if (!url) {
            return res.status(400).json({
                status: 'error',
                message: 'URL is required'
            });
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🇮🇱 SmartProxy Israel Request`);
        console.log(`🔗 URL: ${url.substring(0, 100)}...`);
        console.log(`${'='.repeat(60)}\n`);
        
        const result = await Promise.race([
            scrapeParts(url),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout')), maxTimeout)
            )
        ]);
        
        if (result.success) {
            console.log(`✅ SUCCESS - ${Date.now() - startTime}ms`);
            
            res.json({
                status: 'ok',
                message: 'Success',
                solution: {
                    url: result.url,
                    status: 200,
                    response: result.html,
                    cookies: result.cookies || []
                },
                startTimestamp: startTime,
                endTimestamp: Date.now(),
                version: '1.0.0'
            });
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        console.error(`❌ Failed: ${error.message}`);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        proxy: 'SmartProxy Israel (Tel Aviv)',
        browsers: browserPool.length,
        active: browserPool.filter(b => b.busy).length
    });
});

// Root
app.get('/', (req, res) => {
    res.send(`
        <h1>🔧 Parts Scraper with SmartProxy</h1>
        <p>Status: Ready</p>
        <p>Proxy: SmartProxy Static Residential</p>
        <p>Location: Tel Aviv, Israel</p>
    `);
});

// Start
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔════════════════════════════════════════╗
║  🔧 Parts Scraper with SmartProxy IL   ║
║  Port: ${PORT}                            ║
║  Location: Tel Aviv, Israel            ║
╚════════════════════════════════════════╝
    `);
    await initBrowserPool();
    console.log('✅ Ready with Israel proxy!');
});

// Cleanup
process.on('SIGTERM', async () => {
    for (const b of browserPool) {
        await b.browser.close().catch(() => {});
    }
    process.exit(0);
});
