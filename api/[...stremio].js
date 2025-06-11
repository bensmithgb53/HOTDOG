// api/[...stremio].js
const { addonBuilder, get } = require('stremio-addon-sdk');

const builder = new addonBuilder({
  id: 'org.bytetan.minimaltest',
  version: '1.0.0',
  name: 'Minimal Test Addon',
  description: 'A barebones Stremio add-on for testing deployment.',
  resources: ['catalog', 'stream'],
  types: ['movie'],
  catalogs: [
    {
      id: 'test_catalog',
      name: 'Test Catalog',
      type: 'movie',
      extra: [{ name: 'search', isRequired: false }] // Corrected 'is' to 'isRequired'
    }
  ],
  idPrefixes: ['tt'],
  logo: 'https://www.bytetan.com/static/img/logo.png' // Optional: keep your logo
});

// Define a dummy catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (id === 'test_catalog') {
    return Promise.resolve({
      metas: [
        {
          id: 'tt1234567',
          name: 'Test Movie',
          type: 'movie',
          poster: 'https://m.media-amazon.com/images/M/MV5BNzQ2OTZlZGEtY2YzNy00ZTVhLTliYjQtMzIyOWU0MmQyNjY5XkEyXkFqcGdeQXVyMzAyNDc1MjI@._V1_QL75_UY281_CR1,0,190,281_.jpg'
        }
      ]
    });
  }
  return Promise.resolve({ metas: [] });
});

// Define a dummy stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  return Promise.resolve({
    streams: [
      { url: 'https://www.w3schools.com/html/mov_bbb.mp4', title: 'Sample MP4 Stream' }
    ]
  });
});

// This is the Vercel serverless function entry point
// This uses the canonical 'get' function from the SDK for serverless.
module.exports = (req, res) => {
    try {
        get(builder)(req, res); // This is the recommended way to export for serverless
    } catch (error) {
        console.error("Critical error in Vercel handler:", error);
        res.status(500).json({ error: "Internal Server Error during handler execution." });
    }
};
