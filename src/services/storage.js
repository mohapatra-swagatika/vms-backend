const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl: presignUrl } = require('@aws-sdk/s3-request-presigner');

const S3_BUCKET = process.env.S3_BUCKET;
const SIGNED_URL_EXPIRY_SEC = Math.min(
  604800,
  Math.max(60, parseInt(process.env.S3_SIGNED_URL_EXPIRY_SEC || '3600', 10))
);

const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

let s3Client = null;

function s3Credentials() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey };
}

function s3Region() {
  return process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
}

function getS3Client() {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: s3Region(),
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: s3Credentials(),
  });
  return s3Client;
}

async function validateS3Config() {
  if (!S3_BUCKET) throw new Error('S3_BUCKET is required');
  if (!s3Credentials()) {
    throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required');
  }
  await getS3Client().send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
}

function extFromName(name, fallback = '.jpg') {
  const ext = require('path').extname(name || '').toLowerCase();
  return ext || fallback;
}

function profileKey(userId, originalname) {
  return `profiles/${userId}${extFromName(originalname)}`;
}

function entityKey(entityType, entityId, originalname) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `entities/${entityType}/${entityId}/${uid}${extFromName(originalname)}`;
}

/** Extract S3 object key from a DB value (raw key, legacy path, or old URL). */
function keyFromStorageRef(ref) {
  if (!ref) return null;
  const value = String(ref).trim();
  if (value.startsWith('/uploads/')) {
    return value.replace(/^\/uploads\//, '');
  }
  if (value.startsWith('profiles/') || value.startsWith('entities/')) {
    return value;
  }
  if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('/')) {
    return value;
  }
  try {
    const u = new URL(value, 'http://localhost');
    const mediaIdx = u.pathname.indexOf('/media/');
    if (mediaIdx !== -1) return decodeURIComponent(u.pathname.slice(mediaIdx + '/media/'.length));
    if (S3_BUCKET) {
      const hostPrefix = `${S3_BUCKET}.s3.`;
      if (u.hostname.startsWith(hostPrefix) || u.hostname === `${S3_BUCKET}.s3.amazonaws.com`) {
        return decodeURIComponent(u.pathname.replace(/^\//, ''));
      }
      if (u.pathname.includes(`/${S3_BUCKET}/`)) {
        return decodeURIComponent(u.pathname.split(`/${S3_BUCKET}/`)[1]);
      }
    }
    const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (path.startsWith('profiles/') || path.startsWith('entities/')) return path;
    return path || null;
  } catch {
    return null;
  }
}

/** Upload to S3; returns the object key to store in the database. */
async function uploadBuffer({ key, buffer, contentType }) {
  await getS3Client().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'private, max-age=31536000, immutable',
  }));
  return key;
}

async function getSignedUrlForKey(key) {
  if (!key) return null;
  return presignUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_EXPIRY_SEC }
  );
}

/** Resolve a DB image reference to a time-limited signed URL for API responses. */
async function resolveImageUrl(stored) {
  if (!stored) return stored;
  const key = keyFromStorageRef(stored);
  if (!key) return stored;
  return getSignedUrlForKey(key);
}

async function resolveImageRow(row, field = 'image_url') {
  if (!row?.[field]) return row;
  return { ...row, [field]: await resolveImageUrl(row[field]) };
}

async function resolveImageRows(rows, field = 'image_url') {
  return Promise.all((rows || []).map(r => resolveImageRow(r, field)));
}

async function resolveProfile(user) {
  return resolveImageRow(user, 'profile_image_url');
}

async function resolveProfiles(users) {
  return Promise.all((users || []).map(resolveProfile));
}

async function deleteObject(key) {
  if (!key) return;
  const resolved = keyFromStorageRef(key) || key;
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: resolved,
  }));
}

async function deleteByPrefix(prefix) {
  const client = getS3Client();
  let token;
  do {
    const list = await client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    const keys = (list.Contents || []).map(o => ({ Key: o.Key }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: keys },
      }));
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
}

module.exports = {
  uploadBuffer,
  deleteObject,
  deleteByPrefix,
  getSignedUrlForKey,
  resolveImageUrl,
  resolveImageRow,
  resolveImageRows,
  resolveProfile,
  resolveProfiles,
  profileKey,
  entityKey,
  keyFromStorageRef,
  validateS3Config,
  S3_BUCKET,
  SIGNED_URL_EXPIRY_SEC,
};
