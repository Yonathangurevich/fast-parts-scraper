const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// SmartProxy Configuration - TRY DIFFERENT ENDPOINTS
const PROXY_CONFIG = {
    // Option 1: Residential Rotating (נסה את זה קודם!)
    server: 'gate.smartproxy.com:10000',
    
    // Option 2: Static Residential (אם הראשון לא עובד)
    // server: 'gate.smartproxy.com:7000',
    
    // Your credentials (without the smart- prefix for rotating)
    username: process.env.PROXY_USERNAME || 'byparr',  // שים לב - בלי smart-
    password: process.env.PROXY_PASSWORD || '1209QWEasdzxcv'
};

// For static residential, use full username:
// username: 'smart-byparr_area-IL_city-TELAVIV'

// Browser pool
const browserPool = [];
const MAX_BROWSERS = 1;  // Start with 1 for testing
let initComplete = false;

// Browser args - SIMPLIFIED
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-gpu',
    '--window-size=1920,1080'
    // REMOVED proxy from here - we'll set it differently
];

// Initialize browser pool
async function initBrowserPool() {
    console.log('🚀 Initializing browsers...');
    
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

// Scraping function
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
        
        // CRITICAL: Authenticate FIRST
        console.log('🔐 Authenticating proxy...');
        await page.authenticate({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
        
        // Test proxy connection first
        console.log('🌍 Testing proxy connection...');
        try {
            await page.goto('http://httpbin.org/ip', { 
                timeout: 10000,
                waitUntil: 'domcontentloaded' 
            });
            const proxyTest = await page.evaluate(() => document.body.innerText);
            console.log('✅ Proxy working! Response:', proxyTest);
        } catch (proxyError) {
            console.error('❌ Proxy test failed:', proxyError.message);
            throw new Error('Proxy connection failed');
        }
        
        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Stealth mode
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {}
            };
            
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1,2,3,4,5]
            });
        });
        
        // Navigate to target URL
        console.log('📍 Navigating to target...');
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        console.log(`📄 Status: ${response.status()}`);
        
        // Handle Cloudflare
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            const title = await page.title();
            
            if (title.includes('Just a moment') || title.includes('Checking')) {
                console.log(`⏳ Cloudflare ${attempts + 1}/${maxAttempts}...`);
                await page.waitForTimeout(2000);
                attempts++;
            } else {
                console.log('✅ Page loaded!');
                break;
            }
        }
        
        // Wait for content
        await page.waitForTimeout(2000);
        
        // Get content
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
        const { url, maxTimeout = 30000 } = req.body;
        
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
                    response: result.html
                },
                elapsed: Date.now() - startTime
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
        proxy: PROXY_CONFIG.server,
        browsers: browserPool.length
    });
});

// Root
app.get('/', (req, res) => {
    res.send(`<h1>🔧 Parts Scraper</h1><p>Proxy: ${PROXY_CONFIG.server}</p>`);
});

// Start
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🔧 Parts Scraper on port ${PORT}`);
    console.log(`🌐 Proxy: ${PROXY_CONFIG.server}`);
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
