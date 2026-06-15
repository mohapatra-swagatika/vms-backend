const fs   = require('fs');
const path = require('path');
const os   = require('os');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const DRIVER     = process.env.STORAGE_DRIVER || 'local';
const LOCAL_ROOT = process.env.STORAGE_LOCAL_PATH || path.join(os.homedir(), '.vms-storage');
const API_BASE   = (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');

const EXT_MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
};

let s3Client = null;

function getS3Client() {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  });
  return s3Client;
}

function localPath(key) {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(path.resolve(LOCAL_ROOT))) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

function buildPublicUrl(key) {
  if (DRIVER === 's3') {
    if (process.env.S3_PUBLIC_URL) {
      return `${process.env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    }
    const bucket = process.env.S3_BUCKET;
    const endpoint = (process.env.S3_ENDPOINT || '').replace(/\/$/, '');
    if (endpoint) return `${endpoint}/${bucket}/${key}`;
    const region = process.env.S3_REGION || 'us-east-1';
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }
  return `${API_BASE}/media/${key}`;
}

function extFromName(name, fallback = '.jpg') {
  const ext = path.extname(name || '').toLowerCase();
  return ext || fallback;
}

function profileKey(userId, originalname) {
  return `profiles/${userId}${extFromName(originalname)}`;
}

function entityKey(entityType, entityId, originalname) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `entities/${entityType}/${entityId}/${uid}${extFromName(originalname)}`;
}

async function uploadBuffer({ key, buffer, contentType }) {
  if (DRIVER === 's3') {
    await getS3Client().send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    key,
      Body:   buffer,
      ContentType: contentType,
    }));
  } else {
    const filePath = localPath(key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
  }
  return buildPublicUrl(key);
}

async function deleteObject(key) {
  if (!key) return;
  if (DRIVER === 's3') {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    key,
    }));
    return;
  }
  const filePath = localPath(key);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/** Remove all objects under a prefix (e.g. profiles/{userId}). */
async function deleteByPrefix(prefix) {
  if (DRIVER === 's3') {
    const client = getS3Client();
    let token;
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }));
      const keys = (list.Contents || []).map(o => ({ Key: o.Key }));
      if (keys.length) {
        await client.send(new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET,
          Delete: { Objects: keys },
        }));
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    return;
  }
  const parent = path.dirname(localPath(prefix));
  const base = path.basename(prefix);
  if (!fs.existsSync(parent)) return;
  for (const name of fs.readdirSync(parent)) {
    if (name === base || name.startsWith(`${base}.`) || name.startsWith(`${base}-`)) {
      try { fs.unlinkSync(path.join(parent, name)); } catch { /* ignore */ }
    }
  }
  const nested = localPath(prefix);
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    fs.rmSync(nested, { recursive: true, force: true });
  }
}

async function getObjectStream(key) {
  if (DRIVER === 's3') {
    const res = await getS3Client().send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    key,
    }));
    return { stream: res.Body, contentType: res.ContentType };
  }
  const filePath = localPath(key);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  return {
    stream: fs.createReadStream(filePath),
    contentType: EXT_MIME[ext] || 'application/octet-stream',
  };
}

/** Extract storage key from a URL this service generated, or legacy /uploads/ path. */
function keyFromUrl(url) {
  if (!url) return null;
  if (url.startsWith('/uploads/')) {
    return url.replace(/^\/uploads\//, '');
  }
  try {
    const u = new URL(url);
    const mediaIdx = u.pathname.indexOf('/media/');
    if (mediaIdx !== -1) return u.pathname.slice(mediaIdx + '/media/'.length);
    const bucket = process.env.S3_BUCKET;
    if (bucket && u.pathname.includes(`/${bucket}/`)) {
      return u.pathname.split(`/${bucket}/`)[1];
    }
    return u.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

module.exports = {
  uploadBuffer,
  deleteObject,
  deleteByPrefix,
  getObjectStream,
  buildPublicUrl,
  profileKey,
  entityKey,
  keyFromUrl,
  LOCAL_ROOT,
  DRIVER,
};
