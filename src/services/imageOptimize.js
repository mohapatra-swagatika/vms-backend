const sharp = require('sharp');

const MAX_EDGE = 1920;
const WEBP_QUALITY = 82;

/** Resize and convert uploads to WebP for faster delivery (GIFs are kept as-is). */
async function optimizeImage(buffer, mimetype) {
  if (mimetype === 'image/gif') {
    return { buffer, contentType: mimetype, ext: '.gif' };
  }

  const optimized = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  return { buffer: optimized, contentType: 'image/webp', ext: '.webp' };
}

module.exports = { optimizeImage };
