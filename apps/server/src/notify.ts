import pg from 'pg';
import { buildPoolConfig } from './db.js';

type Handler = () => void;

const MAX_RETRY_MS = 30_000;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function defaultClient(): pg.Client {
  const { connectionString, ssl, keepAlive, connectionTimeoutMillis } = buildPoolConfig();
  return new pg.Client({ connectionString, ssl, keepAlive, connectionTimeoutMillis });
}

/**
 * Multiplexes Postgres LISTEN/NOTIFY over a single dedicated connection.
 *
 * Each SSE stream used to check a client out of the pool and hold it for as long
 * as the device stayed connected, so a handful of open devices exhausted the pool
 * (and a hosted database's connection limit) and stalled every other request.
 * Now every stream shares one connection; channels are LISTENed while at least
 * one subscriber needs them. If the connection drops it is re-established with
 * backoff, all channels are re-LISTENed, and every subscriber is pinged once so
 * clients re-pull anything they missed while it was down.
 */
export class NotifyHub {
  private client: pg.Client | null = null;
  private connecting: Promise<pg.Client> | null = null;
  private handlers = new Map<string, Set<Handler>>();
  /** Channels LISTENed on the current connection (reset when it is replaced). */
  private listening = new Set<string>();
  private retryTimer: NodeJS.Timeout | null = null;
  private retryMs = 1000;
  private closed = false;

  constructor(private readonly createClient: () => pg.Client = defaultClient) {}

  /** Registers `handler` for `channel`. Resolves to an unsubscribe function. */
  async subscribe(channel: string, handler: Handler): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    const firstForChannel = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);

    if (firstForChannel) {
      try {
        await this.listen(await this.ensureClient(), channel);
      } catch (err) {
        // The reconnect loop LISTENs on every registered channel once it's back.
        console.error('LISTEN failed; will retry:', (err as Error).message);
        this.scheduleReconnect();
      }
    }

    return async () => {
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size > 0) return;
      this.handlers.delete(channel);
      if (this.client && this.listening.delete(channel)) {
        await this.client.query(`UNLISTEN ${quoteIdent(channel)}`).catch(() => {});
      }
    };
  }

  /** Number of channels currently listened to (for tests/diagnostics). */
  get channelCount(): number {
    return this.handlers.size;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.handlers.clear();
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => {});
  }

  private ensureClient(): Promise<pg.Client> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async connect(): Promise<pg.Client> {
    const client = this.createClient();
    client.on('notification', (msg) => {
      this.handlers.get(msg.channel)?.forEach((h) => h());
    });
    const onLost = () => this.handleLost(client);
    client.on('error', onLost);
    client.on('end', onLost);

    await client.connect();
    if (this.closed) {
      await client.end().catch(() => {});
      throw new Error('NotifyHub closed');
    }
    this.listening = new Set();
    for (const channel of this.handlers.keys()) {
      await this.listen(client, channel);
    }
    this.client = client;
    this.retryMs = 1000;
    return client;
  }

  private async listen(client: pg.Client, channel: string): Promise<void> {
    if (this.listening.has(channel)) return;
    this.listening.add(channel);
    try {
      await client.query(`LISTEN ${quoteIdent(channel)}`);
    } catch (err) {
      this.listening.delete(channel);
      throw err;
    }
  }

  private handleLost(client: pg.Client): void {
    if (this.client !== client) return;
    this.client = null;
    client.end().catch(() => {});
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer || this.handlers.size === 0) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed || this.handlers.size === 0) return;
      this.ensureClient()
        .then(() => {
          // Changes made while we were disconnected produced no notifications.
          for (const set of this.handlers.values()) set.forEach((h) => h());
        })
        .catch((err) => {
          console.error('Sync listener reconnect failed:', (err as Error).message);
          this.scheduleReconnect();
        });
    }, delay);
  }
}

let hub: NotifyHub | null = null;

export function getNotifyHub(): NotifyHub {
  if (!hub) hub = new NotifyHub();
  return hub;
}

export function setNotifyHub(next: NotifyHub | null): void {
  hub = next;
}
