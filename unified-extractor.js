Const { connect } = require("puppeteer-real-browser");
const logger = require("./logger");

// ... (existing slugify function and extractors object) ...
function slugify(text) {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars
        .replace(/--+/g, '-');         // Replace multiple - with single -
}

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
    'vidsrc.wtf': (type, id, season, episode) =>
        type === 'movie'
            ? `https://www.vidsrc.wtf/api/3/movie/?id=${id}`
            : `https://www.vidsrc.wtf/api/3/tv/?id=${id}&s=${season}&e=${episode}`,
    'flixbaba.net': (type, id, season, episode, name = 'default-name') =>
        type === 'movie'
            ? `https://flixbaba.net/movie/${id}/${slugify(name)}/watch`
            : `https://flixbaba.net/tv/${id}/${slugify(name)}/season/${season}?e=${episode}&p=1`,
    'hydrahd.sh': (type, id, season, episode, slugifiedTitle = 'default-slugified-title', year = 'YYYY') =>
        type === 'movie'
            ? `https://hydrahd.sh/movie/${id}-watch-${slugifiedTitle}-${year}-online`
            : `https://hydrahd.sh/watchseries/${slugifiedTitle}-online-free/season/${season}/episode/${episode}`,
    'vidsrc.xyz': (type, id, season, episode) =>
        type === 'movie'
            ? `https://vidsrc.xyz/embed/movie/${id}`
            : `https://vidsrc.xyz/embed/tv/${id}/${season}/${episode}`,
};


function randomUserAgent() {
  const versions = ['114.0.5735.198', '113.0.5672.126', '112.0.5615.138'];
  const version = versions[Math.floor(Math.random() * versions.length)];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
}

async function runExtractor(source, type, imdbId, season = null, episode = null, name = 'default-name', slugifiedTitle = 'default-slugified-title', year = 'YYYY') {
    if (!extractors[source]) throw new Error(`Unknown source: ${source}`);

    const streamUrls = [];
    const collectedUrls = new Set(); // Use a Set to avoid duplicate URLs

    let url;
    if (source === 'flixbaba.net') {
        url = extractors[source](type, imdbId, season, episode, name);
    } else if (source === 'hydrahd.sh') {
        url = extractors[source](type, imdbId, season, episode, slugifiedTitle, year);
    } else {
        url = extractors[source](type, imdbId, season, episode);
    }

    const {browser, page} = await connect({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            "--disable-dev-shm-usage",
            '--disable-features=IsolateOrigins,site-per-process',
            '--enable-popup-blocking'
        ],
        turnstile: true,
        customConfig: {},
        connectOption: {},
        disableXvfb: true,
        ignoreAllFlags: false,
    });
    await page.setUserAgent(randomUserAgent());
    await page.setExtraHTTPHeaders({
        url,
        'Sec-GPC': '1',
        'DNT': '1',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
    });

    await page.setRequestInterception(true);
    await page.evaluateOnNewDocument(() => { window.open = () => null; });
    page.on('dialog', async dialog => { await dialog.accept(); });

    page.on('request', async request => {
        const url = request.url();
        if (
            url.includes('analytics') || url.includes('ads') || url.includes('social') ||
            url.includes('disable-devtool') || url.includes('cloudflareinsights') ||
            url.includes('ainouzaudre') || url.includes('pixel.embed') || url.includes('histats')
        ) {
            await request.abort();
        } else if (url.includes('.mp4') || url.includes('.m3u8')) {
            if (!collectedUrls.has(url)) { // Add to Set if not already present
                logger.info(`${source} stream URL detected in request: ${url}`);
                streamUrls.push(url);
                collectedUrls.add(url);
            }
            await request.continue();
        } else {
            await request.continue();
        }
    });

    try {
        logger.info(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }); // Increased timeout for initial load
        logger.info('Player page loaded');

        // --- Site-specific interaction logic for multiple sources ---
        switch (source) {
            case 'fmovies':
                logger.info('Attempting to find server buttons on fmovies.cat...');
                // The server icon is wrapped in a div with a group-hover class and an SVG.
                // We need to click the div containing the server SVG to reveal source options.
                const serverButtonSelector = '.group[style*="border-width: 1px"] svg.lucide-server';
                const serverButton = await page.$(serverButtonSelector);
                if (serverButton) {
                    await serverButton.click();
                    logger.info('Clicked server icon on fmovies.cat. Waiting for source list...');
                    // Wait for the source list to appear
                    await page.waitForSelector('.text-sm.font-medium.truncate', { visible: true, timeout: 5000 }).catch(() => logger.warn('Source list not immediately visible after server button click.'));

                    // Now find all individual source elements (e.g., Neon, Vidfast)
                    const sourceSelectors = '.h-full.flex.flex-col.items-center.justify-center'; // This div wraps each source button
                    const sourceElements = await page.$$(sourceSelectors);

                    if (sourceElements.length > 0) {
                        logger.info(`Found ${sourceElements.length} potential sources on fmovies.cat. Clicking each...`);
                        for (let i = 0; i < sourceElements.length; i++) {
                            // Re-query elements inside the loop as DOM might change
                            const currentSourceElement = (await page.$$(sourceSelectors))[i];
                            if (currentSourceElement) {
                                const sourceName = await currentSourceElement.$eval('.text-sm.font-medium.truncate', el => el.innerText.trim()).catch(() => 'Unknown Source');
                                logger.info(`Clicking source: ${sourceName}`);
                                await currentSourceElement.click();
                                // Wait for a short period for network requests to fire after each source click
                                await page.waitForTimeout(3000); // Adjust as needed
                                logger.info(`Finished waiting for requests after clicking ${sourceName}.`);
                            }
                        }
                    } else {
                        logger.warn('No individual source elements found on fmovies.cat after clicking server button.');
                    }
                } else {
                    logger.warn('Server button not found on fmovies.cat.');
                }
                break;

            case 'flixbaba.net':
                logger.info('Attempting to find player buttons on flixbaba.net...');
                // Look for buttons like "Player #2", "Player #3"
                const playerButtonsSelector = 'button.MuiButtonBase-root.MuiButton-root.MuiButton-contained[type="button"]';
                const playerButtons = await page.$$(playerButtonsSelector);

                if (playerButtons.length > 0) {
                    logger.info(`Found ${playerButtons.length} player buttons on flixbaba.net. Clicking each...`);
                    for (let i = 0; i < playerButtons.length; i++) {
                        const currentPlayerButton = (await page.$$(playerButtonsSelector))[i];
                        if (currentPlayerButton) {
                            const buttonText = await currentPlayerButton.evaluate(el => el.innerText.trim());
                            logger.info(`Clicking player button: ${buttonText}`);
                            await currentPlayerButton.click();
                            // After clicking a player button, the iframe src changes.
                            // We might need to wait for the iframe to load or for network requests from the new iframe.
                            await page.waitForTimeout(3000); // Adjust as needed
                            logger.info(`Finished waiting for requests after clicking ${buttonText}.`);
                        }
                    }
                } else {
                    logger.warn('No player buttons found on flixbaba.net.');
                }
                break;

            case 'broflix':
                logger.info('Attempting to interact with source dropdown on broflix.si...');
                // The select element has various options. We need to select each option.
                const selectElementSelector = 'select';
                const selectElement = await page.$(selectElementSelector);

                if (selectElement) {
                    // Get all options from the select dropdown
                    const options = await page.evaluate(selector => {
                        const select = document.querySelector(selector);
                        if (!select) return [];
                        return Array.from(select.options).map(option => option.value);
                    }, selectElementSelector);

                    if (options.length > 0) {
                        logger.info(`Found ${options.length} source options on broflix.si. Selecting each...`);
                        for (const optionValue of options) {
                            logger.info(`Selecting option: ${optionValue}`);
                            await page.select(selectElementSelector, optionValue);
                            await page.waitForTimeout(3000); // Give time for new player/requests to load
                            logger.info(`Finished waiting for requests after selecting ${optionValue}.`);
                        }
                    } else {
                        logger.warn('No options found in the select dropdown on broflix.si.');
                    }
                } else {
                    logger.warn('Source select dropdown not found on broflix.si.');
                }
                break;

            case 'hydrahd.sh':
                logger.info('Attempting to interact with server selection on hydrahd.sh...');
                // First, click the "Select a Server" button
                const selectServerButtonSelector = 'button.iframe-button';
                const selectServerButton = await page.$(selectServerButtonSelector);

                if (selectServerButton) {
                    await selectServerButton.click();
                    logger.info('Clicked "Select a Server" button on hydrahd.sh. Waiting for server list...');
                    // Wait for the server list to appear (e.g., the div with class "iframe-server-button")
                    await page.waitForSelector('.iframe-server-button', { visible: true, timeout: 5000 }).catch(() => logger.warn('Server list not immediately visible after "Select a Server" click.'));

                    // Now find all individual server buttons
                    const serverOptionSelector = 'div.iframe-server-button';
                    const serverOptions = await page.$$(serverOptionSelector);

                    if (serverOptions.length > 0) {
                        logger.info(`Found ${serverOptions.length} server options on hydrahd.sh. Clicking each...`);
                        for (let i = 0; i < serverOptions.length; i++) {
                            const currentServerOption = (await page.$$(serverOptionSelector))[i];
                            if (currentServerOption) {
                                const serverName = await currentServerOption.$eval('p', el => el.innerText.trim()).catch(() => 'Unknown Server');
                                logger.info(`Clicking server: ${serverName}`);
                                await currentServerOption.click();
                                // After clicking a server, wait for the player to load and requests to fire.
                                await page.waitForTimeout(3000); // Adjust as needed
                                logger.info(`Finished waiting for requests after clicking ${serverName}.`);
                                // Close the modal if it's still open to click the next server
                                await page.keyboard.press('Escape').catch(e => logger.debug('Escape key press failed (modal might be closed or not present):', e.message));
                                await page.waitForTimeout(500); // Short delay after escape
                            }
                        }
                    } else {
                        logger.warn('No individual server options found on hydrahd.sh after clicking "Select a Server" button.');
                    }
                } else {
                    logger.warn('"Select a Server" button not found on hydrahd.sh.');
                }
                break;

            case 'videasy':
                // For videasy, your original code already clicks a button,
                // this might be the initial play button. If there are
                // multiple sources AFTER this, you'd need further selectors.
                // Assuming for now the initial button click is sufficient for primary stream.
                await page.click('button');
                logger.info('Clicked the play button for videasy');
                // You might need to add a small wait here if new iframes load
                await page.waitForTimeout(2000);
                break;

            case 'vidsrc.xyz':
                 logger.info('Attempting to find iframe and click play button on vidsrc.xyz...');
                const vidsrcXyzIframeHandle = await page.$('iframe');
                if (vidsrcXyzIframeHandle) {
                    logger.info('vidsrc.xyz iframe loaded. Attempting to get content frame...');
                    const vidsrcXyzOuterFrame = await vidsrcXyzIframeHandle.contentFrame();
                    if (vidsrcXyzOuterFrame) {
                        // This selector '#pl_but' was in your original code, it might be relevant.
                        // Or you might need to find other server/source buttons within this iframe.
                        const playButtonInIframe = await vidsrcXyzOuterFrame.$('#pl_but');
                        if (playButtonInIframe) {
                            await playButtonInIframe.click();
                            logger.info('vidsrc.xyz play button clicked within iframe.');
                            await page.waitForTimeout(3000); // Wait for stream to load
                        } else {
                            logger.warn('Play button (#pl_but) not found within vidsrc.xyz iframe.');
                            // If no direct play button, check for source selectors within the iframe
                            // This would involve looking for elements that trigger different sources.
                            // You'd need to provide HTML for this.
                        }
                    } else {
                        logger.warn('Could not get content frame of vidsrc.xyz iframe.');
                    }
                } else {
                    logger.warn('vidsrc.xyz iframe not found.');
                }
                break;

            // vidsrc.wtf looks like an API, so no clicks expected on the main page.
            // If it returns a URL to another player, you'd navigate there next.
            // For now, assuming it might eventually load a video directly, though unlikely.
            case 'vidsrc.wtf':
                logger.info('vidsrc.wtf is likely an API endpoint. No interaction expected beyond initial load to trigger requests.');
                break;

            case 'vidora':
                logger.info('No specific multiple source interaction defined for vidora. Assuming direct stream capture.');
                // If vidora has similar source selectors, add logic here.
                break;

            default:
                logger.info(`No specific interaction logic for ${source}. Proceeding with general request monitoring.`);
                break;
        }
        // --- End of Site-specific interaction logic ---


        logger.info(`${source} Waiting for m3u8/mp4 URLs to be collected.`);
        // Give some extra time for all interactions and resulting network requests
        await page.waitForTimeout(5000); // General wait time after all interactions

        // You can add a more sophisticated wait here if you want to ensure X number of URLs are found or
        // if network traffic has settled after a specific period.
        // The previous Promise.race wait might still be useful, but after all clicks.
        // For now, a fixed timeout after interactions.


        if (streamUrls.length === 0) {
            throw new Error('No stream URL found after all attempts.');
        }

        logger.info(`${source} Stream URLs found: ${ JSON.stringify(streamUrls) }`);
        return streamUrls;
    } catch (err) {
        logger.error(`Error extracting from ${source}: ${err.message}`);
        return [];
    } finally {
        await browser.close();
    }
}

module.exports = runExtractor;
