import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export const HASH_RE = /^[a-f0-9]{64}$/;

export interface FileItem {
  hash: string;
  size: number;
}

export interface StorageDriver {
  has(userId: string, hash: string): Promise<boolean>;
  get(userId: string, hash: string): Promise<{ stream: NodeJS.ReadableStream; size: number } | null>;
  put(userId: string, hash: string, localFilePath: string, size: number): Promise<void>;
  delete(userId: string, hash: string): Promise<void>;
  list(userId: string): Promise<FileItem[]>;
  deleteAll(userId: string): Promise<void>;
}

class LocalStorageDriver implements StorageDriver {
  private root: string;

  constructor(root = process.env.FILES_DIR || './data/files') {
    this.root = root;
  }

  private userDir(userId: string): string {
    return path.join(this.root, userId);
  }

  private filePath(userId: string, hash: string): string {
    return path.join(this.userDir(userId), hash);
  }

  async has(userId: string, hash: string): Promise<boolean> {
    try {
      await fsp.access(this.filePath(userId, hash));
      return true;
    } catch {
      return false;
    }
  }

  async get(userId: string, hash: string): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
    const p = this.filePath(userId, hash);
    try {
      const stat = await fsp.stat(p);
      return {
        stream: fs.createReadStream(p),
        size: stat.size,
      };
    } catch {
      return null;
    }
  }

  async put(userId: string, hash: string, localFilePath: string): Promise<void> {
    const dir = this.userDir(userId);
    await fsp.mkdir(dir, { recursive: true });
    const final = this.filePath(userId, hash);
    if (localFilePath !== final) {
      await fsp.rename(localFilePath, final);
    }
  }

  async delete(userId: string, hash: string): Promise<void> {
    await fsp.rm(this.filePath(userId, hash), { force: true });
  }

  async list(userId: string): Promise<FileItem[]> {
    const dir = this.userDir(userId);
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const files: FileItem[] = [];
      for (const entry of entries) {
        if (entry.isFile() && HASH_RE.test(entry.name)) {
          const stat = await fsp.stat(path.join(dir, entry.name));
          files.push({ hash: entry.name, size: stat.size });
        }
      }
      return files;
    } catch {
      return [];
    }
  }

  async deleteAll(userId: string): Promise<void> {
    await fsp.rm(this.userDir(userId), { recursive: true, force: true });
  }
}

class R2StorageDriver implements StorageDriver {
  private client: S3Client;
  private bucket: string;

  constructor(config: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; region?: string }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region || 'auto',
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private key(userId: string, hash: string): string {
    return `${userId}/${hash}`;
  }

  async has(userId: string, hash: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.key(userId, hash),
        }),
      );
      return true;
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async get(userId: string, hash: string): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(userId, hash),
        }),
      );
      if (!res.Body) return null;
      return {
        stream: res.Body as NodeJS.ReadableStream,
        size: res.ContentLength ?? 0,
      };
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async put(userId: string, hash: string, localFilePath: string, size: number): Promise<void> {
    const fileStream = fs.createReadStream(localFilePath);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(userId, hash),
          Body: fileStream,
          ContentLength: size,
          ContentType: 'application/octet-stream',
        }),
      );
    } finally {
      await fsp.rm(localFilePath, { force: true });
    }
  }

  async delete(userId: string, hash: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(userId, hash),
      }),
    );
  }

  async list(userId: string): Promise<FileItem[]> {
    const prefix = `${userId}/`;
    const res = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }),
    );
    const files: FileItem[] = [];
    for (const obj of res.Contents || []) {
      if (!obj.Key) continue;
      const hash = obj.Key.slice(prefix.length);
      if (HASH_RE.test(hash)) {
        files.push({ hash, size: obj.Size ?? 0 });
      }
    }
    return files;
  }

  async deleteAll(userId: string): Promise<void> {
    const prefix = `${userId}/`;
    const listRes = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }),
    );
    const objects = (listRes.Contents || []).filter((o) => o.Key).map((o) => ({ Key: o.Key! }));
    if (objects.length > 0) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: objects },
        }),
      );
    }
  }
}

function createStorageDriver(): StorageDriver {
  const endpoint =
    process.env.R2_ENDPOINT ||
    (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (endpoint && accessKeyId && secretAccessKey && bucket) {
    return new R2StorageDriver({
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      region: process.env.R2_REGION,
    });
  }

  return new LocalStorageDriver();
}

export const storage: StorageDriver = createStorageDriver();
