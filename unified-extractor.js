const puppeteer = require("puppeteer");
const logger = require("./logger");

const extractors = {
    broflix: (type, id, season, episode) =>
        type === 'movie'
            ? `https://broflix.si/watch/movie/${id}`
            : `https://broflix.si/watch/tv/${id}?season=${season}&episode=${episode}`,
    fmovies: (type, id, season, episode) =>
        type === 'movie'
            ? `https://fmovies.cat/watch/movie/${id}`
            : `https://fmovies.cat/watch/tv/${id}/${season}/${episode}`,
    videasy: (type, id, season, episode) =>
        type === 'movie'
            ? `https://player.videasy.net/movie/${id}`
            : `https://player.videasy.net/tv/${id}/${season}/${episode}`,
    vidora: (type, id, season, episode) =>
        type === 'movie'
            ? `https://watch.vidora.su/watch/movie/${id}`
            : `https://watch.vidora.su/watch/tv/${id}/${season}/${episode}`,
    vidsrc: (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.xyz/embed/movie/${id}`
            : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`
};

function randomUserAgent() {
    const versions = ['114.0.5735.198', '113.0.5672.126', '112.0.5615.138'];
    const version = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

async function runExtractor(source, type, imdbId, season = null, episode = null) {
    if (!extractors[source]) {
        logger.error(`Unknown source: ${source}`);
        return {};
    }

    const streamUrls = {};
    const url = extractors[source](type, imdbId, season, episode);

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--headless=new"
            ]
        });
        const page = await browser.newPage();

        await page.setUserAgent(randomUserAgent());
        await page.setExtraHTTPHeaders({
            'Sec-GPC': '1',
            'DNT': '1',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site'
        });

        await page.setRequestInterception(true);
        await page.evaluateOnNewDocument(() => {
            window.open = () => null;
        });

        page.on('dialog', async dialog => {
            await dialog.accept();
        });

        page.on('request', async request => {
            const url = request.url();
            if (
                url.includes('analytics') ||
                url.includes('ads') ||
                url.includes('social') ||
                url.includes('disable-devtool') ||
                url.includes('cloudflareinsights') ||
                url.includes('ainouzaudre') ||
                url.includes('pixel.embed') ||
                url.includes('histats')
            ) {
                await request.abort();
            } else if (url.includes('.mp4') || url.includes('.m3u8')) {
                logger.info(`${source} stream URL detected: ${url}`);
                streamUrls[`${source} Link`] = url;
                await request.continue();
            } else {
                await request.continue();
            }
        });

        logger.info(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

        if (source === 'videasy') {
            try {
                await page.click('button');
                logger.info('Clicked play button for videasy');
            } catch (err) {
                logger.warn(`Videasy play button click failed: ${err.message}`);
            }
        }

        if (source === 'vidsrc') {
            try {
                const outerIframeHandle = await page.$('iframe');
                if (outerIframeHandle) {
                    const outerFrame = await outerIframeHandle.contentFrame();
                    await outerFrame.click('#pl_but');
                    logger.info('Vidsrc button clicked');
                } else {
                    logger.warn('Vidsrc iframe not found');
                }
            } catch (err) {
                logger.warn(`Vidsrc button click failed: ${err.message}`);
            }
        }

        logger.info(`${source} Waiting for m3u8/mp4 URLs`);
        await new Promise(resolve => {
            const interval = setInterval(() => {
                if (Object.keys(streamUrls).length > 0) {
                    clearInterval(interval);
                    resolve();
                }
            }, 500);
            setTimeout(() => {
                clearInterval(interval);
                resolve();
            }, 15000);
        });

        if (Object.keys(streamUrls).length === 0) {
            logger.warn(`${source} No stream URLs found`);
            return {};
        }

        logger.info(`${source} Stream URLs found: ${JSON.stringify(streamUrls)}`);
        return streamUrls;
    } catch (err) {
        logger.error(`Error extracting from ${source}: ${err.message}`);
        return {};
    } finally {
        if (browser) {
            await browser.close().catch(err => logger.warn(`Browser close failed: ${err.message}`));
        }
    }
}

module.exports = runExtractor;
