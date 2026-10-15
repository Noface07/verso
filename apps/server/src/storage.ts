import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export const HASH_RE = /^[a-f0-9]{64}$/;

/**
 * The storage service can't be reached (e.g. the PC running s3rver is off or the
 * ngrok tunnel is closed). Routes answer 503 "storage_offline" for this instead
 * of claiming the file doesn't exist.
 */
export class StorageOfflineError extends Error {
  constructor(cause?: unknown) {
    super('Book storage is offline', { cause });
    this.name = 'StorageOfflineError';
  }
}

type AwsError = { name?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };

/** Network-level failure or a gateway/tunnel error rather than an S3 answer. */
function isUnreachable(err: unknown): boolean {
  const e = err as AwsError;
  const status = e.$metadata?.httpStatusCode;
  if (status === 502 || status === 503 || status === 504) return true;
  const text = `${e.name ?? ''} ${e.code ?? ''} ${e.message ?? ''}`;
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|TimeoutError|ERR_NGROK|Unexpected end|Deserialization|char '<'/i.test(text);
}

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
  /** Throws StorageOfflineError if the backing store can't be reached. */
  ping(): Promise<void>;
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

  async ping(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
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
      // AWS SDK v3.729+ adds trailing CRC32 checksums to streaming uploads by
      // default. S3rver treats that aws-chunked framing as object bytes, so the
      // stored object no longer matches its content-addressed key. Let the
      // existing SHA-256 verification in files.ts remain the integrity check.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private key(userId: string, hash: string): string {
    return `${userId}/${hash}`;
  }

  private reachableUntil = 0;

  /**
   * Confirms the bucket answers. A tunnel that's down (ngrok) replies 404 to
   * every request, which on its own looks exactly like "file not found", so a
   * not-found result is only trusted once the bucket itself is reachable.
   */
  async ping(): Promise<void> {
    if (Date.now() < this.reachableUntil) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.reachableUntil = Date.now() + 30_000;
    } catch (err) {
      throw new StorageOfflineError(err);
    }
  }

  private async rethrow(err: unknown): Promise<never> {
    if (isUnreachable(err)) throw new StorageOfflineError(err);
    throw err;
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
      const e = err as AwsError;
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        await this.ping();
        return false;
      }
      return this.rethrow(err);
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
      const e = err as AwsError;
      if (e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
        await this.ping();
        return null;
      }
      return this.rethrow(err);
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
    } catch (err) {
      await this.rethrow(err);
    } finally {
      await fsp.rm(localFilePath, { force: true });
    }
  }

  async delete(userId: string, hash: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(userId, hash) }))
      .catch((err) => this.rethrow(err));
  }

  /** All object keys under a prefix. ListObjectsV2 returns at most 1000 per page. */
  private async listAll(prefix: string): Promise<{ Key: string; Size: number }[]> {
    const out: { Key: string; Size: number }[] = [];
    let token: string | undefined;
    do {
      const res = await this.client
        .send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }))
        .catch(async (err) => {
          // A 404 for the whole listing is a closed tunnel (or a missing bucket).
          if ((err as AwsError).$metadata?.httpStatusCode === 404) await this.ping();
          return this.rethrow(err);
        });
      for (const obj of res.Contents || []) {
        if (obj.Key) out.push({ Key: obj.Key, Size: obj.Size ?? 0 });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async list(userId: string): Promise<FileItem[]> {
    const prefix = `${userId}/`;
    const files: FileItem[] = [];
    for (const obj of await this.listAll(prefix)) {
      const hash = obj.Key.slice(prefix.length);
      if (HASH_RE.test(hash)) files.push({ hash, size: obj.Size });
    }
    return files;
  }

  async deleteAll(userId: string): Promise<void> {
    const keys = (await this.listAll(`${userId}/`)).map((o) => ({ Key: o.Key }));
    // DeleteObjects accepts at most 1000 keys per request.
    for (let i = 0; i < keys.length; i += 1000) {
      await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.slice(i, i + 1000) } }),
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
