import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type pg from 'pg';
import { NotifyHub } from '../src/notify.js';

class FakeClient extends EventEmitter {
  queries: string[] = [];
  connected = false;
  async connect() {
    this.connected = true;
  }
  async query(sql: string) {
    this.queries.push(sql);
    return { rows: [] };
  }
  async end() {
    this.connected = false;
  }
  notify(channel: string) {
    this.emit('notification', { channel, processId: 1, payload: '' });
  }
}

function makeHub() {
  const clients: FakeClient[] = [];
  const hub = new NotifyHub(() => {
    const c = new FakeClient();
    clients.push(c);
    return c as unknown as pg.Client;
  });
  return { hub, clients };
}

describe('NotifyHub', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one connection and LISTENs once per channel', async () => {
    const { hub, clients } = makeHub();
    const a = vi.fn();
    const b = vi.fn();
    await hub.subscribe('sync_u1', a);
    await hub.subscribe('sync_u1', b);
    await hub.subscribe('sync_u2', vi.fn());

    expect(clients).toHaveLength(1);
    expect(clients[0].queries).toEqual(['LISTEN "sync_u1"', 'LISTEN "sync_u2"']);

    clients[0].notify('sync_u1');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await hub.close();
  });

  it('only UNLISTENs when the last subscriber leaves', async () => {
    const { hub, clients } = makeHub();
    const offA = await hub.subscribe('sync_u1', vi.fn());
    const offB = await hub.subscribe('sync_u1', vi.fn());

    await offA();
    expect(clients[0].queries).not.toContain('UNLISTEN "sync_u1"');
    await offB();
    expect(clients[0].queries).toContain('UNLISTEN "sync_u1"');
    expect(hub.channelCount).toBe(0);
    await hub.close();
  });

  it('does not deliver notifications for other channels', async () => {
    const { hub, clients } = makeHub();
    const handler = vi.fn();
    await hub.subscribe('sync_u1', handler);
    clients[0].notify('sync_u2');
    expect(handler).not.toHaveBeenCalled();
    await hub.close();
  });

  it('reconnects, re-LISTENs and pings subscribers after the connection drops', async () => {
    vi.useFakeTimers();
    const { hub, clients } = makeHub();
    const handler = vi.fn();
    await hub.subscribe('sync_u1', handler);

    clients[0].emit('error', new Error('connection terminated'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(clients).toHaveLength(2);
    expect(clients[1].queries).toEqual(['LISTEN "sync_u1"']);
    // Subscribers re-pull, since changes during the outage produced no NOTIFY.
    expect(handler).toHaveBeenCalledTimes(1);

    clients[1].notify('sync_u1');
    expect(handler).toHaveBeenCalledTimes(2);
    await hub.close();
  });

  it('quotes channel names safely', async () => {
    const { hub, clients } = makeHub();
    await hub.subscribe('sync_a"b', vi.fn());
    expect(clients[0].queries).toEqual(['LISTEN "sync_a""b"']);
    await hub.close();
  });
});
