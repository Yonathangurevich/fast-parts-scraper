const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// SmartProxy Configuration
const PROXY_CONFIG = {
    server: 'gate.smartproxy.com:10000',
    username: process.env.PROXY_USERNAME || 'byparr',
    password: process.env.PROXY_PASSWORD || '1209QWEasdzxcv'
};

// Browser pool
const browserPool = [];
const MAX_BROWSERS = 2;
let initComplete = false;

// Optimized browser args
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--disable-images',  // Don't load images
    '--disable-javascript-harmony-shipping',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--disable-domain-reliability',
    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
    '--disable-ipc-flooding-protection',
    '--no-pings'
];

// Initialize browser pool
async function initBrowserPool() {
    console.log('🚀 Initializing browsers with proxy...');
    
    for (let i = 0; i < MAX_BROWSERS; i++) {
        try {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    ...BROWSER_ARGS,
                    `--proxy-server=http://${PROXY_CONFIG.server}`
                ],
                ignoreDefaultArgs: ['--enable-automation']
            });
            
            browserPool.push({ 
                browser, 
                busy: false,
                lastUsed: Date.now() 
            });
            
            console.log(`✅ Browser ${i + 1} ready`);
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

// OPTIMIZED scraping function
async function scrapeParts(url, options = {}) {
    const startTime = Date.now();
    let browserObj = null;
    let page = null;
    
    try {
        console.log(`🔧 Scraping: ${url.substring(0, 80)}...`);
        
        browserObj = await getBrowser();
        if (!browserObj) {
            throw new Error('No browser available');
        }
        
        page = await browserObj.browser.newPage();
        
        // Authenticate proxy
        await page.authenticate({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
        console.log('🔐 Proxy authenticated');
        
        // OPTIMIZATION: Block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();
            
            // Block all images, fonts, media
            if (['image', 'font', 'media', 'texttrack', 'object', 'beacon', 'csp_report', 'imageset'].includes(resourceType)) {
                req.abort();
            }
            // Block analytics
            else if (url.includes('google-analytics') || 
                     url.includes('googletagmanager') || 
                     url.includes('facebook') ||
                     url.includes('doubleclick') ||
                     url.includes('analytics')) {
                req.abort();
            }
            // Allow everything else
            else {
                req.continue();
            }
        });
        
        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Stealth
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1,2,3,4,5]
            });
        });
        
        // Navigate - with shorter timeout
        console.log('📍 Navigating...');
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',  // Don't wait for all resources
            timeout: 20000  // 20 seconds max
        });
        
        console.log(`📄 Status: ${response.status()}`);
        
        // Check for Cloudflare - but don't wait too long
        let cloudflareChecks = 0;
        const maxChecks = 5;  // Less checks
        
        while (cloudflareChecks < maxChecks) {
            const title = await page.title();
            
            if (title.includes('Just a moment') || title.includes('Checking')) {
                console.log(`⏳ Cloudflare ${cloudflareChecks + 1}/${maxChecks}...`);
                await page.waitForTimeout(1500);  // Shorter wait
                cloudflareChecks++;
            } else {
                console.log('✅ Page ready!');
                break;
            }
        }
        
        // Quick wait for content
        await page.waitForTimeout(1000);  // Just 1 second
        
        // Get content immediately
        const html = await page.content();
        const finalUrl = page.url();
        
        const elapsed = Date.now() - startTime;
        console.log(`✅ Completed in ${elapsed}ms`);
        
        return {
            success: true,
            html: html,
            url: finalUrl,
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
        const { cmd, url, maxTimeout = 25000 } = req.body;  // 25 seconds default
        
        if (!url) {
            return res.status(400).json({
                status: 'error',
                message: 'URL is required'
            });
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔧 Request: ${url.substring(0, 100)}...`);
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
                    cookies: [],
                    userAgent: 'Mozilla/5.0'
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
        proxy: 'SmartProxy active',
        browsers: browserPool.length,
        active: browserPool.filter(b => b.busy).length
    });
});

// Root
app.get('/', (req, res) => {
    res.send(`
        <h1>🔧 Parts Scraper with SmartProxy</h1>
        <p>Status: Running</p>
        <p>Performance: ~10-15 seconds per request</p>
    `);
});

// Start
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`
╔════════════════════════════════════════╗
║  🔧 Parts Scraper v2.0                 ║
║  Proxy: SmartProxy Residential         ║
║  Expected: 10-15 seconds per request   ║
╚════════════════════════════════════════╝
    `);
    await initBrowserPool();
    console.log('✅ Ready!');
});

// Cleanup
process.on('SIGTERM', async () => {
    for (const b of browserPool) {
        await b.browser.close().catch(() => {});
    }
    process.exit(0);
});
