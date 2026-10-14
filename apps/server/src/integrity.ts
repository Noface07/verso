import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from './db.js';

let instanceId: string | null = null;

/** Random id of this server database (see migration 004). Cached after first read. */
export async function getInstanceId(): Promise<string> {
  if (instanceId) return instanceId;
  try {
    const r = await pool.query<{ instance_id: string }>('select instance_id from server_meta limit 1');
    if (r.rows[0]?.instance_id) instanceId = String(r.rows[0].instance_id);
  } catch {
    // Table missing (migrations not applied yet): fall through.
  }
  // Without the table the id is per-process; clients then resync after a restart,
  // which is safe (just redundant). Migrations normally create it.
  instanceId ??= crypto.randomUUID();
  return instanceId;
}

// Whether a user id still exists. Access tokens outlive account deletion by up
// to their TTL, so authenticated routes check this (cached briefly).
const existsCache = new Map<string, { exists: boolean; at: number }>();
const EXISTS_TTL_MS = 30_000;

export async function userExists(userId: string): Promise<boolean> {
  const hit = existsCache.get(userId);
  if (hit && Date.now() - hit.at < EXISTS_TTL_MS) return hit.exists;
  const r = await pool.query('select 1 from users where id = $1', [userId]);
  const exists = (r.rowCount ?? 0) > 0;
  existsCache.set(userId, { exists, at: Date.now() });
  return exists;
}

export function forgetUser(userId: string): void {
  existsCache.set(userId, { exists: false, at: Date.now() });
}

/** True if this id belonged to an account that was deleted. */
export async function wasDeleted(userId: string): Promise<boolean> {
  try {
    const r = await pool.query('select 1 from deleted_users where id = $1', [userId]);
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Serialises one user's sync writes for the rest of the transaction.
 *
 * server_seq values are taken from a sequence when a row is written, not when
 * the transaction commits. With two devices pushing at once, a pull could see
 * the later transaction's rows (higher seq) first, advance its cursor past the
 * earlier transaction's still-uncommitted rows, and never receive them. Holding
 * a per-user lock for the whole push makes one user's writes commit in seq order.
 */
export async function lockUserWrites(client: PoolClient, userId: string): Promise<void> {
  // 48-bit key from the user id keeps us inside JS's safe-integer range.
  const key = parseInt(crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12), 16);
  await client.query('select pg_advisory_xact_lock($1)', [key]);
}
