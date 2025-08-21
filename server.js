const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// User agents pool - rotate between them
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Get random user agent
function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Browser args - optimized for cloud
const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--deterministic-fetch',
    '--disable-features=IsolateOrigins,site-per-process',
    '--window-size=1920,1080',
    '--start-maximized'
];

// Main scraping function - NO PROXY
async function scrapeParts(url, options = {}) {
    const startTime = Date.now();
    let browser = null;
    let page = null;
    
    try {
        console.log(`🔧 Scraping directly (no proxy)...`);
        
        // Launch browser
        browser = await puppeteer.launch({
            headless: 'new',
            args: BROWSER_ARGS,
            ignoreDefaultArgs: ['--enable-automation']
        });
        
        // Create incognito context
        const context = await browser.createIncognitoBrowserContext();
        page = await context.newPage();
        
        // Random user agent
        const userAgent = getRandomUserAgent();
        await page.setUserAgent(userAgent);
        console.log('🎭 User Agent:', userAgent.substring(0, 50) + '...');
        
        // Set viewport
        await page.setViewport({ 
            width: 1920, 
            height: 1080,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false
        });
        
        // ADVANCED Anti-detection
        await page.evaluateOnNewDocument(() => {
            // Override webdriver
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            
            // Add chrome object
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {
                    isInstalled: false,
                    InstallState: {
                        DISABLED: 'disabled',
                        INSTALLED: 'installed',
                        NOT_INSTALLED: 'not_installed'
                    }
                }
            };
            
            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    {
                        0: {type: "application/x-google-chrome-pdf", suffixes: "pdf"},
                        1: {type: "application/pdf", suffixes: "pdf"},
                        description: "Portable Document Format",
                        filename: "internal-pdf-viewer",
                        length: 2,
                        name: "Chrome PDF Plugin"
                    },
                    {
                        0: {type: "application/x-nacl", suffixes: ""},
                        1: {type: "application/x-pnacl", suffixes: ""},
                        description: "Native Client Executable",
                        filename: "internal-nacl-plugin",
                        length: 2,
                        name: "Native Client"
                    }
                ]
            });
            
            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
            
            // Override hardware concurrency
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: () => 8
            });
            
            // Override device memory
            Object.defineProperty(navigator, 'deviceMemory', {
                get: () => 8
            });
        });
        
        // Set headers
        await page.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        });
        
        // Block only heavy resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            // Only block images and media, keep CSS and fonts
            if (['image', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        // Navigate with retries
        console.log('📍 Navigating...');
        let response;
        let retries = 0;
        const maxRetries = 2;
        
        while (retries <= maxRetries) {
            try {
                response = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 25000
                });
                
                console.log(`📄 Status: ${response.status()}`);
                
                if (response.status() === 403) {
                    console.log(`⚠️ Got 403, retry ${retries + 1}/${maxRetries}...`);
                    retries++;
                    await page.waitForTimeout(2000);
                } else {
                    break;
                }
            } catch (navError) {
                console.log(`⚠️ Navigation error, retry ${retries + 1}/${maxRetries}...`);
                retries++;
                if (retries > maxRetries) throw navError;
                await page.waitForTimeout(2000);
            }
        }
        
        // Handle Cloudflare
        let attempts = 0;
        const maxAttempts = 12;
        
        while (attempts < maxAttempts) {
            const title = await page.title();
            
            if (title.includes('Just a moment') || title.includes('Checking')) {
                console.log(`⏳ Cloudflare check ${attempts + 1}/${maxAttempts}...`);
                await page.waitForTimeout(2500); // Longer wait
                attempts++;
                
                // Check if redirected
                const currentUrl = page.url();
                if (currentUrl !== url && currentUrl.includes('gid=')) {
                    console.log('✅ Redirected successfully!');
                    break;
                }
            } else {
                console.log('✅ Page loaded!');
                break;
            }
        }
        
        // Wait for content
        await page.waitForTimeout(2000);
        
        // Try to wait for parts table
        try {
            await page.waitForSelector('table, .part-row, .parts-list', { 
                timeout: 3000 
            });
            console.log('✅ Parts content found');
        } catch (e) {
            console.log('⚠️ Parts selector not found, continuing...');
        }
        
        // Get content
        const html = await page.content();
        const finalUrl = page.url();
        const cookies = await page.cookies();
        
        // Close context
        await context.close();
        
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
        if (browser) await browser.close().catch(() => {});
    }
}

// Main endpoint
app.post('/v1', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { cmd, url, maxTimeout = 35000 } = req.body;
        
        if (!url) {
            return res.status(400).json({
                status: 'error',
                message: 'URL is required'
            });
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔧 Request: ${url.substring(0, 100)}...`);
        console.log(`📡 Method: Direct (no proxy)`);
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
        method: 'Direct connection (no proxy)'
    });
});

// Root
app.get('/', (req, res) => {
    res.send(`
        <h1>🔧 Parts Scraper v3.0</h1>
        <p>Method: Direct connection</p>
        <p>Status: Running</p>
    `);
});

// Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║  🔧 Parts Scraper v3.0                 ║
║  Method: Direct (no proxy)             ║
║  Port: ${PORT}                            ║
╚════════════════════════════════════════╝
    `);
    console.log('✅ Ready!');
});
