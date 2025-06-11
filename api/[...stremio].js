const { addonBuilder } = require('stremio-addon-sdk');
const NodeCache = require('node-cache');
const axios = require('axios');
const logger = require('../logger');
const extractor = require('../unified-extractor');

const builder = new addonBuilder({
  id: 'org.bytetan.bytewatch',
  version: '1.0.0',
  name: 'ByteWatch',
  description: 'Get stream links for tv shows and movies',
  resources: ['stream'],
  types: ['movie', 'series'],
  catalogs: [],
  logo: 'https://www.bytetan.com/static/img/logo.png',
  idPrefixes: ['tt']
});

const streamCache = new NodeCache({ stdTTL: 86400, checkperiod: 120 });

async function fetchOmdbDetails(imdbId) {
  try {
    const response = await axios.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=b1e4f11`);
    if (response.data.Response === 'False') {
      logger.error(`OMDB lookup failed for ${imdbId}: ${response.data.Error}`);
      return null;
    }
    return response.data;
  } catch (e) {
    logger.error(`Error fetching OMDB metadata for ${imdbId}: ${e.message}`);
    return null;
  }
}

async function fetchTmdbId(imdbId) {
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`,
      {
        headers: {
          accept: 'application/json',
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI3M2EyNzkwNWM1Y2IzNjE1NDUyOWNhN2EyODEyMzc0NCIsIm5iZiI6MS43MjM1ODA5NTAwMDg5OTk4ZSs5LCJzdWIiOiI2NmJiYzIxNjI2NmJhZmVmMTQ4YzVkYzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.y7N6qt4Lja5M6wnFkqqo44mzEMJ60Pzvm0z_TfA1vxk'
        }
      }
    );
    return response.data;
  } catch (e) {
    logger.error(`Error fetching TMDB ID for ${imdbId}: ${e.message}`);
    return null;
  }
}

async function extractAllStreams({ type, imdbId, season, episode }) {
  const streams = {};
  const tmdbRes = await fetchTmdbId(imdbId);

  const id = type === 'movie'
    ? tmdbRes?.movie_results?.[0]?.id
    : tmdbRes?.tv_results?.[0]?.id;

  if (!id) {
    logger.warn(`TMDB ID not found for ${imdbId}`);
    return streams;
  }

  const results = await Promise.allSettled([
    extractor('broflix', type, id, season, episode),
    extractor('fmovies', type, id, season, episode),
    extractor('vidora', type, id, season, episode),
    extractor('videasy', type, id, season, episode),
    extractor('vidsrc', type, id, season, episode)
  ]);

  const sources = ['broflix', 'fmovies', 'vidora', 'videasy', 'vidsrc'];
  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled' && result.value && Object.keys(result.value).length > 0) {
      for (const label in result.value) {
        streams[label] = result.value[label];
      }
      logger.info(`Extracted streams from ${source}: ${JSON.stringify(result.value)}`);
    } else {
      logger.warn(`Extraction failed for ${source}: ${result.reason?.message || 'No streams found'}`);
    }
  });

  return streams;
}

async function getMovieStreams(imdbId) {
  const cacheKey = `movie:${imdbId}`;
  const metadata = await fetchOmdbDetails(imdbId);

  const cached = streamCache.get(cacheKey);
  if (cached) {
    logger.info(`Cache hit for movie ${imdbId}`);
    return Object.entries(cached).map(([name, url]) => ({
      name,
      url,
      description: metadata ? `${metadata.Title} (${metadata.Year})` : `Movie ${imdbId}`
    }));
  }

  const streams = await extractAllStreams({ type: 'movie', imdbId });
  if (Object.keys(streams).length > 0) {
    streamCache.set(cacheKey, streams);
    logger.info(`Cached streams for movie ${imdbId}`);
  }

  return Object.entries(streams).map(([name, url]) => ({
    name,
    url,
    description: metadata ? `${metadata.Title} (${metadata.Year})` : `Movie ${imdbId}`
  }));
}

async function getSeriesStreams(imdbId, season, episode) {
  const cacheKey = `series:${imdbId}:${season}:${episode}`;
  const metadata = await fetchOmdbDetails(imdbId);

  const cached = streamCache.get(cacheKey);
  if (cached) {
    logger.info(`Cache hit for series ${imdbId} S${season}E${episode}`);
    return Object.entries(cached).map(([name, url]) => ({
      name,
      url,
      description: metadata ? `${metadata.Title} S${season}E${episode}` : `Series ${imdbId}`
    }));
  }

  const streams = await extractAllStreams({ type: 'series', imdbId, season, episode });
  if (Object.keys(streams).length > 0) {
    streamCache.set(cacheKey, streams);
    logger.info(`Cached streams for series ${imdbId} S${season}E${episode}`);
  }

  return Object.entries(streams).map(([name, url]) => ({
    name,
    url,
    description: metadata ? `${metadata.Title} S${season}E${episode}` : `Series ${imdbId}`
  }));
}

builder.defineStreamHandler(async ({ type, id }) => {
  logger.info(`Stream request: ${type} ${id}`);
  try {
    if (type === 'movie') {
      const imdbId = id.split(':')[0];
      const streams = await getMovieStreams(imdbId);
      return { streams };
    }
    if (type === 'series') {
      const [imdbId, season, episode] = id.split(':');
      const streams = await getSeriesStreams(imdbId, season, episode);
      return { streams };
    }
    logger.warn(`Unsupported type: ${type}`);
    return { streams: [] };
  } catch (error) {
    logger.error(`Stream handler error: ${error.message}`);
    return { streams: [] };
  }
});

module.exports = async (req, res) => {
  const addon = builder.getInterface();
  await addon(req, res);
};