import WebSocket from 'ws';

import type { RealtimeFrame } from '../shared/realtime-state';

export interface RealtimeSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type Timer = ReturnType<typeof setTimeout>;

export interface RealtimeConnectionOptions {
  baseUrl: string;
  token: string;
  cursor: number;
  onFrame(frame: RealtimeFrame): void;
  onStatus?(status: 'connecting' | 'connected' | 'reconnecting' | 'stopped'): void;
  createSocket?: (url: string, token: string) => RealtimeSocket;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
}

export class RealtimeConnection {
  #socket?: RealtimeSocket;
  #timer?: Timer;
  #stopped = true;
  #cursor: number;
  #attempt = 0;

  constructor(private readonly options: RealtimeConnectionOptions) {
    this.#cursor = Math.max(0, options.cursor);
  }

  start(): void {
    this.stop();
    this.#stopped = false;
    this.#attempt = 0;
    this.connect('connecting');
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) (this.options.cancel || clearTimeout)(this.#timer);
    this.#timer = undefined;
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close(1000, 'client stopped');
    this.options.onStatus?.('stopped');
  }

  sendTyping(conversationId: string): void {
    if (this.#socket?.readyState === 1) {
      this.#socket.send(JSON.stringify({ type: 'typing', channel_id: conversationId }));
    }
  }

  private connect(status: 'connecting' | 'reconnecting'): void {
    if (this.#stopped) return;
    this.options.onStatus?.(status);
    const socket = (this.options.createSocket || createAuthenticatedSocket)(
      realtimeUrl(this.options.baseUrl, this.#cursor),
      this.options.token,
    );
    this.#socket = socket;
    socket.onopen = () => {
      this.#attempt = 0;
      this.options.onStatus?.('connected');
    };
    socket.onmessage = ({ data }) => {
      let frame: RealtimeFrame;
      try { frame = JSON.parse(data) as RealtimeFrame; } catch { return; }
      if (typeof frame.type !== 'string' || typeof frame.cursor !== 'number') return;
      this.#cursor = Math.max(this.#cursor, frame.cursor);
      if (frame.type === 'heartbeat' && socket.readyState === 1) socket.send(JSON.stringify({ type: 'heartbeat' }));
      this.options.onFrame(frame);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.#stopped || socket !== this.#socket) return;
      this.#socket = undefined;
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.#attempt++, 5));
      this.options.onStatus?.('reconnecting');
      this.#timer = (this.options.schedule || setTimeout)(() => this.connect('reconnecting'), delay);
    };
  }
}

function realtimeUrl(baseUrl: string, cursor: number): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/v1/realtime';
  url.search = new URLSearchParams({ cursor: String(cursor) }).toString();
  return url.toString();
}

function createAuthenticatedSocket(url: string, token: string): RealtimeSocket {
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
  const adapter: RealtimeSocket = {
    get readyState() { return socket.readyState; },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
  };
  socket.on('open', () => adapter.onopen?.());
  socket.on('message', (data) => adapter.onmessage?.({ data: data.toString() }));
  socket.on('error', () => adapter.onerror?.());
  socket.on('close', () => adapter.onclose?.());
  return adapter;
}
