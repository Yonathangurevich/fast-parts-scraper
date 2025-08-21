const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// SmartProxy STATIC RESIDENTIAL Configuration (YOUR EXACT SETTINGS!)
const PROXY_CONFIG = {
    server: 'eu.smartproxy.com',  // EU server
    port: '3120',                  // Static residential port
    username: process.env.PROXY_USERNAME || 'smart-byparr_area-IL_city-TELAVIV',  // Full username with smart-
    password: process.env.PROXY_PASSWORD || '1209QWEasdzxcv'
};

// Build proxy URL
const PROXY_URL = `http://${PROXY_CONFIG.server}:${PROXY_CONFIG.port}`;

// Browser args
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--disable-images',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection'
];

// Main scraping function
async function scrapeParts(url, options = {}) {
    const startTime = Date.now();
    let browser = null;
    let page = null;
    
    try {
        console.log(`🔧 Scraping via SmartProxy Static Residential...`);
        console.log(`🌐 Proxy: ${PROXY_URL}`);
        console.log(`👤 User: ${PROXY_CONFIG.username}`);
        
        // Launch browser with proxy
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                ...BROWSER_ARGS,
                `--proxy-server=${PROXY_URL}`  // Just the server URL
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });
        
        page = await browser.newPage();
        
        // CRITICAL: Authenticate with FULL credentials
        console.log('🔐 Authenticating...');
        await page.authenticate({
            username: PROXY_CONFIG.username,  // smart-byparr_area-IL_city-TELAVIV
            password: PROXY_CONFIG.password   // 1209QWEasdzxcv
        });
        
        // Test proxy first
        console.log('🧪 Testing proxy connection...');
        try {
            await page.goto('http://ipinfo.io/json', { 
                timeout: 10000,
                waitUntil: 'domcontentloaded' 
            });
            const ipInfo = await page.evaluate(() => document.body.innerText);
            const ipData = JSON.parse(ipInfo);
            console.log('✅ Proxy working! Location:', ipData.city, ipData.country);
            console.log('📍 IP:', ipData.ip);
        } catch (proxyError) {
            console.error('❌ Proxy test failed:', proxyError.message);
            // Continue anyway - sometimes ipinfo blocks proxies
        }
        
        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        // Anti-detection
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
            
            Object.defineProperty(navigator, 'languages', {
                get: () => ['he-IL', 'he', 'en-US', 'en']  // Israel locale
            });
        });
        
        // Navigate to target
        console.log('📍 Navigating to target...');
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        
        console.log(`📄 Status: ${response.status()}`);
        
        // If 407, auth failed
        if (response.status() === 407) {
            console.error('❌ Proxy authentication failed!');
            const content = await page.content();
            console.log('Error page:', content.substring(0, 500));
        }
        
        // Handle Cloudflare
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            const title = await page.title();
            
            if (title.includes('Just a moment') || title.includes('Checking')) {
                console.log(`⏳ Cloudflare check ${attempts + 1}/${maxAttempts}...`);
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
        if (page) await page.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

// Test proxy endpoint
app.get('/test-proxy', async (req, res) => {
    console.log('🧪 Testing SmartProxy connection...');
    
    let browser = null;
    let page = null;
    
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                `--proxy-server=${PROXY_URL}`
            ]
        });
        
        page = await browser.newPage();
        
        await page.authenticate({
            username: PROXY_CONFIG.username,
            password: PROXY_CONFIG.password
        });
        
        await page.goto('http://ipinfo.io/json', { timeout: 15000 });
        const ipInfo = await page.evaluate(() => JSON.parse(document.body.innerText));
        
        console.log('✅ Proxy test successful:', ipInfo);
        res.json({
            success: true,
            proxy: {
                server: `${PROXY_CONFIG.server}:${PROXY_CONFIG.port}`,
                username: PROXY_CONFIG.username,
                location: ipInfo
            }
        });
        
    } catch (error) {
        console.error('❌ Proxy test failed:', error.message);
        res.json({
            success: false,
            error: error.message,
            config: {
                server: `${PROXY_CONFIG.server}:${PROXY_CONFIG.port}`,
                username: PROXY_CONFIG.username
            }
        });
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
    }
});

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
                    cookies: result.cookies || [],
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
        proxy: {
            type: 'SmartProxy Static Residential',
            server: `${PROXY_CONFIG.server}:${PROXY_CONFIG.port}`,
            location: 'Tel Aviv, Israel'
        }
    });
});

// Root
app.get('/', (req, res) => {
    res.send(`
        <h1>🔧 Parts Scraper with SmartProxy</h1>
        <p>Type: Static Residential</p>
        <p>Server: ${PROXY_CONFIG.server}:${PROXY_CONFIG.port}</p>
        <p>Location: Tel Aviv, Israel</p>
        <hr>
        <p><a href="/test-proxy">Test Proxy Connection</a></p>
    `);
});

// Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║  🔧 Parts Scraper v2.0                 ║
║  Proxy: SmartProxy Static Residential  ║
║  Server: ${PROXY_CONFIG.server}:${PROXY_CONFIG.port}        ║
║  Location: Tel Aviv, Israel            ║
╚════════════════════════════════════════╝
    `);
    console.log('✅ Ready!');
});

// Cleanup
process.on('SIGTERM', async () => {
    console.log('📛 Shutting down...');
    process.exit(0);
});
