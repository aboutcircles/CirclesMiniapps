import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/json',
]);

const MAX_BYTES = 5 * 1024 * 1024;

let _s3;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://s3.filebase.com',
    credentials: {
      accessKeyId: process.env.FILEBASE_ACCESS_KEY,
      secretAccessKey: process.env.FILEBASE_SECRET_KEY,
    },
  });
  return _s3;
}

export const config = { api: { bodyParser: false } };

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const contentType = req.headers['content-type'] || '';
  if (!ALLOWED_MIME.has(contentType.split(';')[0].trim())) {
    return res.status(415).json({ error: 'unsupported content type' });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return res.status(413).json({ error: err.message });
  }

  const bucket = process.env.FILEBASE_BUCKET;
  const key = `nft-marketplace/${randomUUID()}`;

  try {
    await s3().send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const cid = head?.Metadata?.cid;
    if (!cid) {
      return res.status(502).json({ error: 'filebase did not return a CID' });
    }
    return res.status(200).json({
      cid,
      gateway: `https://${cid}.ipfs.dweb.link`,
    });
  } catch (err) {
    console.error('filebase upload failed', err);
    return res.status(502).json({ error: 'upload failed', detail: err.message });
  }
}
