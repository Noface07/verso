import { db, dirty, uid } from '../db';
import type { CatalogSource } from './types';
import { gutenbergSource } from './gutenberg';
import { standardEbooksSource, OpdsSource } from './opds';

export async function getAllBookSources(): Promise<CatalogSource[]> {
  const customSources = await db.sources
    .filter((s) => !s.deleted_at && (s.kind === 'books' || s.kind === 'opds'))
    .toArray();

  const customInstances: CatalogSource[] = [];
  for (const cs of customSources) {
    const cred = await db.source_credentials.get(cs.id);
    customInstances.push(
      new OpdsSource(
        cs.id,
        cs.name,
        cs.url,
        cred
          ? {
              username: cred.username,
              password: cred.password,
              apiKey: cred.apiKey,
            }
          : undefined,
      ),
    );
  }

  return [gutenbergSource, standardEbooksSource, ...customInstances];
}

export async function getSourceById(id: string): Promise<CatalogSource | undefined> {
  if (id === 'gutenberg') return gutenbergSource;
  if (id === 'standardebooks') return standardEbooksSource;

  const cs = await db.sources.get(id);
  if (!cs || cs.deleted_at) return undefined;

  const cred = await db.source_credentials.get(id);
  return new OpdsSource(
    cs.id,
    cs.name,
    cs.url,
    cred
      ? {
          username: cred.username,
          password: cred.password,
          apiKey: cred.apiKey,
        }
      : undefined,
  );
}

export async function addCustomOpdsSource(data: {
  name: string;
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
}): Promise<CatalogSource> {
  const id = uid();
  const sourceRecord = {
    id,
    kind: 'opds',
    name: data.name.trim(),
    url: data.url.trim(),
    meta: {},
    sort_order: Date.now(),
    deleted_at: null,
    ...dirty(),
  };

  await db.sources.put(sourceRecord);

  if (data.username || data.password || data.apiKey) {
    await db.source_credentials.put({
      id,
      username: data.username,
      password: data.password,
      apiKey: data.apiKey,
    });
  }

  return new OpdsSource(id, sourceRecord.name, sourceRecord.url, {
    username: data.username,
    password: data.password,
    apiKey: data.apiKey,
  });
}

export async function removeCustomSource(id: string): Promise<void> {
  const existing = await db.sources.get(id);
  if (existing) {
    await db.sources.update(id, {
      deleted_at: Date.now(),
      ...dirty(),
    });
  }
  await db.source_credentials.delete(id);
}
