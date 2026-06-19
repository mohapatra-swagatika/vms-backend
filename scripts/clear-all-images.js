#!/usr/bin/env node
/**
 * Wipe all profile/entity images from DB, local disk, and S3.
 * Usage: node scripts/clear-all-images.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const LOCAL_ROOT = process.env.STORAGE_LOCAL_PATH || path.join(os.homedir(), '.vms-storage');
const S3_BUCKET = process.env.S3_BUCKET;
const S3_PREFIXES = ['profiles/', 'entities/'];

function rmDirContents(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
    } else {
      fs.unlinkSync(full);
    }
    count += 1;
  }
  return count;
}

function clearLocalStorage() {
  let total = 0;
  for (const prefix of S3_PREFIXES) {
    const dir = path.join(LOCAL_ROOT, prefix);
    total += rmDirContents(dir);
  }
  return total;
}

function s3Client() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !S3_BUCKET) return null;
  return new S3Client({
    region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function clearS3Prefix(client, prefix) {
  let deleted = 0;
  let token;
  do {
    const list = await client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    const keys = (list.Contents || []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: { Objects: keys },
      }));
      deleted += keys.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

async function clearS3() {
  const client = s3Client();
  if (!client) {
    console.log('S3: skipped (missing bucket or credentials)');
    return 0;
  }
  let total = 0;
  for (const prefix of S3_PREFIXES) {
    const n = await clearS3Prefix(client, prefix);
    console.log(`S3: deleted ${n} object(s) under ${prefix}`);
    total += n;
  }
  return total;
}

async function clearDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userImages = (await client.query('DELETE FROM user_images')).rowCount;
    const entityImages = (await client.query('DELETE FROM entity_images')).rowCount;
    const users = (await client.query('UPDATE users SET profile_image_url = NULL WHERE profile_image_url IS NOT NULL')).rowCount;
    const towers = (await client.query('UPDATE towers SET image_url = NULL WHERE image_url IS NOT NULL')).rowCount;
    const companies = (await client.query('UPDATE companies SET image_url = NULL WHERE image_url IS NOT NULL')).rowCount;
    const orgs = (await client.query('UPDATE organizations SET image_url = NULL WHERE image_url IS NOT NULL')).rowCount;
    const locations = (await client.query('UPDATE locations SET image_url = NULL WHERE image_url IS NOT NULL')).rowCount;
    const hasVisitors = (await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'visitors'`
    )).rowCount > 0;
    const visitors = hasVisitors
      ? (await client.query('UPDATE visitors SET photo_url = NULL WHERE photo_url IS NOT NULL')).rowCount
      : 0;
    await client.query('COMMIT');
    console.log('DB: cleared user_images (%d), entity_images (%d)', userImages, entityImages);
    console.log('DB: nulled profile/entity URLs — users %d, towers %d, companies %d, orgs %d, locations %d, visitors %d',
      users, towers, companies, orgs, locations, visitors);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  console.log('Clearing all images…');
  const localCount = clearLocalStorage();
  console.log(`Local: removed ${localCount} file(s) from ${LOCAL_ROOT}`);
  await clearS3();
  await clearDatabase();
  console.log('Done. STORAGE_DRIVER=%s — restart the API and re-upload images.', process.env.STORAGE_DRIVER || 'local');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
