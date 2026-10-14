const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' }
});

const userId = '902d6c15-7cd3-400b-bd78-829d01162d5f';
const downloads = 'C:/Users/yuvra/Downloads';

async function uploadAll() {
  const files = fs.readdirSync(downloads).filter(f => f.endsWith('.epub'));
  for (const f of files) {
    const fullPath = path.join(downloads, f);
    const buf = fs.readFileSync(fullPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const key = userId + '/' + hash;
    console.log('Uploading ' + f + ' as ' + key + ' (' + (buf.length/1024/1024).toFixed(2) + ' MB)');
    await client.send(new PutObjectCommand({
      Bucket: 'verso-books',
      Key: key,
      Body: buf,
      ContentType: 'application/octet-stream'
    }));
  }
  const list = await client.send(new ListObjectsV2Command({
    Bucket: 'verso-books',
    Prefix: userId + '/'
  }));
  console.log('\nSuccessfully stored in s3rver:');
  list.Contents?.forEach(c => console.log(' - ' + c.Key + ' (' + c.Size + ' bytes)'));
}

uploadAll().catch(console.error);
