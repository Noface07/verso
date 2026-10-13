import { describe, it, expect } from 'vitest';
import { normalizeServerUrl } from '../src/features/auth/storage';

describe('normalizeServerUrl', () => {
  it('rejects the Supabase database address (what was entered by mistake)', () => {
    const r = normalizeServerUrl('aws-0-ap-southeast-1.pooler.supabase.com:5432');
    expect('error' in r && r.error).toMatch(/database/i);
  });

  it('rejects postgres connection strings and DB ports', () => {
    expect('error' in normalizeServerUrl('postgresql://postgres:pw@db.x.supabase.co:5432/postgres')).toBe(true);
    expect('error' in normalizeServerUrl('https://example.com:6543')).toBe(true);
  });

  it('adds a scheme and strips trailing slashes', () => {
    expect(normalizeServerUrl('folio.example.com/')).toEqual({ url: 'https://folio.example.com' });
    expect(normalizeServerUrl('localhost:8080')).toEqual({ url: 'http://localhost:8080' });
    expect(normalizeServerUrl('192.168.1.20:8080//')).toEqual({ url: 'http://192.168.1.20:8080' });
  });

  it('keeps a valid https address', () => {
    expect(normalizeServerUrl('https://ffxasce.duckdns.org')).toEqual({ url: 'https://ffxasce.duckdns.org' });
  });
});
