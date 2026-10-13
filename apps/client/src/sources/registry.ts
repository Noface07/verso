import { db, dirty, uid } from '../db';
import type { CatalogSource, MangaSource } from './types';
import { gutenbergSource } from './gutenberg';
import { standardEbooksSource, OpdsSource } from './opds';
import { mangaDexSource } from './mangadex';
import { openLibrarySource } from './openlibrary';
import { archiveOrgSource } from './archiveorg';
import { mangaPillSource } from './mangapill';
import { SuwayomiSource } from './suwayomi';
import { KomgaSource } from './komga';

export {
  gutenbergSource,
  standardEbooksSource,
  openLibrarySource,
  archiveOrgSource,
  mangaDexSource,
  mangaPillSource,
  SuwayomiSource,
  KomgaSource,
  OpdsSource,
};

export async function getAllBookSources(): Promise<CatalogSource[]> {
  const customSources = await db.sources
    .filter((s) => !s.deleted_at)
    .toArray();

  const customInstances: CatalogSource[] = [];
  for (const cs of customSources) {
    const cred = await db.source_credentials.get(cs.id);
    if (cs.kind === 'suwayomi') {
      customInstances.push(new SuwayomiSource(cs.id, cs.name, cs.url, cred?.apiKey));
    } else if (cs.kind === 'komga') {
      customInstances.push(new KomgaSource(cs.id, cs.name, cs.url, cred));
    } else {
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
  }

  return [
    gutenbergSource,
    standardEbooksSource,
    openLibrarySource,
    archiveOrgSource,
    mangaDexSource,
    mangaPillSource,
    ...customInstances,
  ];
}

export async function getAllMangaSources(): Promise<MangaSource[]> {
  const customSources = await db.sources
    .filter((s) => !s.deleted_at && (s.kind === 'suwayomi' || s.kind === 'komga'))
    .toArray();

  const customInstances: MangaSource[] = [];
  for (const cs of customSources) {
    const cred = await db.source_credentials.get(cs.id);
    if (cs.kind === 'suwayomi') {
      customInstances.push(new SuwayomiSource(cs.id, cs.name, cs.url, cred?.apiKey));
    } else if (cs.kind === 'komga') {
      customInstances.push(new KomgaSource(cs.id, cs.name, cs.url, cred));
    }
  }

  return [mangaDexSource, mangaPillSource, ...customInstances];
}

export async function getSourceById(id: string): Promise<CatalogSource | undefined> {
  if (id === 'gutenberg') return gutenbergSource;
  if (id === 'standardebooks') return standardEbooksSource;
  if (id === 'openlibrary') return openLibrarySource;
  if (id === 'archiveorg') return archiveOrgSource;
  if (id === 'mangadex') return mangaDexSource;
  if (id === 'mangapill') return mangaPillSource;

  // Direct prefix matching for series/item IDs
  if (id.startsWith('openlibrary:')) return openLibrarySource;
  if (id.startsWith('archiveorg:')) return archiveOrgSource;
  if (id.startsWith('mangadex:')) return mangaDexSource;
  if (id.startsWith('mangapill:')) return mangaPillSource;
  if (id.startsWith('gutenberg:')) return gutenbergSource;
  if (id.startsWith('standardebooks:')) return standardEbooksSource;

  // Prefix matching for custom Suwayomi & Komga sources
  if (id.startsWith('suwayomi:')) {
    const parts = id.split(':');
    const instanceId = parts[1];
    if (instanceId && instanceId !== 'all') {
      const cs = await db.sources.get(instanceId);
      if (cs && !cs.deleted_at) {
        const cred = await db.source_credentials.get(instanceId);
        return new SuwayomiSource(cs.id, cs.name, cs.url, cred?.apiKey);
      }
    }
    // Fallback default local Suwayomi
    return new SuwayomiSource();
  }

  if (id.startsWith('komga:')) {
    const parts = id.split(':');
    const instanceId = parts[1];
    if (instanceId) {
      const cs = await db.sources.get(instanceId);
      if (cs && !cs.deleted_at) {
        const cred = await db.source_credentials.get(instanceId);
        return new KomgaSource(cs.id, cs.name, cs.url, cred);
      }
    }
    return new KomgaSource();
  }

  const cs = await db.sources.get(id);
  if (!cs || cs.deleted_at) return undefined;

  const cred = await db.source_credentials.get(id);
  if (cs.kind === 'suwayomi') {
    return new SuwayomiSource(cs.id, cs.name, cs.url, cred?.apiKey);
  }
  if (cs.kind === 'komga') {
    return new KomgaSource(cs.id, cs.name, cs.url, cred);
  }

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

export async function addCustomSuwayomiSource(data: {
  name: string;
  url: string;
  apiKey?: string;
}): Promise<CatalogSource> {
  const id = uid();
  const sourceRecord = {
    id,
    kind: 'suwayomi',
    name: data.name.trim(),
    url: data.url.trim(),
    meta: {},
    sort_order: Date.now(),
    deleted_at: null,
    ...dirty(),
  };

  await db.sources.put(sourceRecord);

  if (data.apiKey) {
    await db.source_credentials.put({
      id,
      apiKey: data.apiKey,
    });
  }

  return new SuwayomiSource(id, sourceRecord.name, sourceRecord.url, data.apiKey);
}

export async function addCustomKomgaSource(data: {
  name: string;
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
}): Promise<CatalogSource> {
  const id = uid();
  const sourceRecord = {
    id,
    kind: 'komga',
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

  return new KomgaSource(id, sourceRecord.name, sourceRecord.url, {
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
