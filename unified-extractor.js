const axios = require("axios");
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

async function runExtractor(source, type, imdbId, season = null, episode = null) {
  if (!extractors[source]) {
    logger.error(`Unknown source: ${source}`);
    return {};
  }

  const streamUrls = {};
  const url = extractors[source](type, imdbId, season, episode);

  try {
    logger.info(`Fetching ${url}`);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.198 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    });

    const data = response.data;
    const m3u8Match = data.match(/(https?:\/\/[^\s]+\.m3u8)/);
    const mp4Match = data.match(/(https?:\/\/[^\s]+\.mp4)/);

    if (m3u8Match) streamUrls[`${source} m3u8`] = m3u8Match[0];
    if (mp4Match) streamUrls[`${source} mp4`] = mp4Match[0];

    if (Object.keys(streamUrls).length === 0) {
      logger.warn(`${source} No stream URLs found`);
      return {};
    }

    logger.info(`${source} Stream URLs found: ${JSON.stringify(streamUrls)}`);
    return streamUrls;
  } catch (err) {
    logger.error(`Error extracting from ${source}: ${err.message}`);
    return {};
  }
}

module.exports = runExtractor;