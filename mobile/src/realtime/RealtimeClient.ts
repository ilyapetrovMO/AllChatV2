export type RealtimeEvent = {cursor: number; type: string; channel_id: string; payload: unknown};
export type RealtimeFrame = {
  type: string;
  cursor: number;
  channel_id?: string;
  payload?: unknown;
  events?: RealtimeEvent[];
  snapshot?: unknown;
};

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'stopped';

type Socket = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: {data: string}) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type SocketFactory = (url: string, token: string) => Socket;
type Timer = ReturnType<typeof setTimeout>;

export type RealtimeOptions = {
  onFrame(frame: RealtimeFrame): void;
  onStatus?(status: RealtimeStatus): void;
  socketFactory?: SocketFactory;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
  random?: () => number;
};

export class RealtimeClient {
  private socket?: Socket;
  private reconnectTimer?: Timer;
  private livenessTimer?: Timer;
  private stopped = true;
  private generation = 0;
  private retry = 0;
  private cursor = 0;

  constructor(
    private readonly instanceURL: string,
    private readonly token: string,
    private readonly options: RealtimeOptions,
  ) {}

  start(cursor: number): void {
    this.stop();
    this.stopped = false;
    this.cursor = Math.max(0, cursor);
    this.retry = 0;
    this.connect('connecting');
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.reconnectTimer) {
      (this.options.cancel || clearTimeout)(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.cancelLiveness();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'client stopped');
    this.options.onStatus?.('stopped');
  }

  sendActivity(active: boolean): void {
    this.send({type: 'activity', active});
  }

  sendTyping(channelID: string): void {
    this.send({type: 'typing', channel_id: channelID});
  }

  currentCursor(): number {
    return this.cursor;
  }

  private connect(status: RealtimeStatus): void {
    if (this.stopped) {
      return;
    }
    this.options.onStatus?.(status);
    const generation = ++this.generation;
    const socket = (this.options.socketFactory || nativeSocket)(this.realtimeURL(), this.token);
    this.socket = socket;
    this.armLiveness(socket, generation);
    socket.onopen = () => {
      if (generation === this.generation) {
        this.options.onStatus?.('connected');
      }
    };
    socket.onmessage = event => {
      if (generation !== this.generation) {
        return;
      }
      this.armLiveness(socket, generation);
      let frame: RealtimeFrame;
      try {
        frame = JSON.parse(event.data) as RealtimeFrame;
      } catch {
        return;
      }
      if (typeof frame.cursor === 'number' && frame.cursor >= this.cursor) {
        this.cursor = frame.cursor;
      }
      this.retry = 0;
      if (frame.type === 'heartbeat') {
        this.send({type: 'heartbeat'});
      }
      this.options.onFrame(frame);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (generation !== this.generation || this.stopped) {
        return;
      }
      this.socket = undefined;
      this.cancelLiveness();
      this.reconnect();
    };
  }

  private reconnect(): void {
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(this.retry, 5));
    const jitter = Math.floor((this.options.random || Math.random)() * 250);
    this.retry += 1;
    this.options.onStatus?.('reconnecting');
    this.reconnectTimer = (this.options.schedule || setTimeout)(() => {
      this.reconnectTimer = undefined;
      this.connect('reconnecting');
    }, base + jitter);
  }

  private armLiveness(socket: Socket, generation: number): void {
    this.cancelLiveness();
    this.livenessTimer = (this.options.schedule || setTimeout)(() => {
      this.livenessTimer = undefined;
      if (!this.stopped && generation === this.generation) {
        socket.close(4000, 'realtime inbound timeout');
      }
    }, 10_000);
  }

  private cancelLiveness(): void {
    if (this.livenessTimer) {
      (this.options.cancel || clearTimeout)(this.livenessTimer);
      this.livenessTimer = undefined;
    }
  }

  private send(command: object): void {
    if (this.socket?.readyState === 1) {
      this.socket.send(JSON.stringify(command));
    }
  }

  private realtimeURL(): string {
    const url = new URL(this.instanceURL);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/api/v1/realtime?cursor=${this.cursor}`;
  }
}

function nativeSocket(url: string, token: string): Socket {
  return new WebSocket(url, null, {headers: mobileRealtimeHeaders(token)}) as Socket;
}

export function mobileRealtimeHeaders(token: string) {
  return {Authorization: `Bearer ${token}`, 'User-Agent': 'AllChat-Mobile (Mobile)'};
}
