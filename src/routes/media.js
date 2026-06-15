const router = require('express').Router();
const { getObjectStream, DRIVER } = require('../services/storage');

/** Stream objects stored on local disk (STORAGE_DRIVER=local). S3 objects use public URLs directly. */
router.get(/.*/, async (req, res) => {
  if (DRIVER !== 'local') {
    return res.status(404).json({ error: 'Media is served from object storage' });
  }

  const key = req.path.replace(/^\//, '');
  if (!key) return res.status(400).json({ error: 'Missing media key' });

  try {
    const obj = await getObjectStream(key);
    if (!obj) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', obj.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    obj.stream.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load media' });
  }
});

module.exports = router;
