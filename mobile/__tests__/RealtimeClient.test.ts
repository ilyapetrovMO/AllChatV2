import {mobileRealtimeHeaders, RealtimeClient, RealtimeFrame, RealtimeStatus} from '../src/realtime/RealtimeClient';

class FakeSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: {data: string}) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  frame(frame: object) { this.onmessage?.({data: JSON.stringify(frame)}); }
  disconnect() { this.readyState = 3; this.onclose?.(); }
}

describe('RealtimeClient', () => {
  it('identifies its realtime connection as mobile to the Instance', () => {
    expect(mobileRealtimeHeaders('session-token')).toEqual({
      Authorization: 'Bearer session-token',
      'User-Agent': 'AllChat-Mobile (Mobile)',
    });
  });

  it('authenticates, resumes a cursor, and acknowledges heartbeats', () => {
    const socket = new FakeSocket();
    const connections: Array<{url: string; token: string}> = [];
    const frames: RealtimeFrame[] = [];
    const client = new RealtimeClient('https://chat.example.test', 'session-token', {
      socketFactory: (url, token) => { connections.push({url, token}); return socket; },
      onFrame: frame => frames.push(frame),
    });

    client.start(42);
    socket.open();
    socket.frame({type: 'heartbeat', cursor: 45});

    expect(connections).toEqual([{url: 'wss://chat.example.test/api/v1/realtime?cursor=42', token: 'session-token'}]);
    expect(client.currentCursor()).toBe(45);
    expect(socket.sent).toEqual([JSON.stringify({type: 'heartbeat'})]);
    expect(frames[0].type).toBe('heartbeat');
    client.stop();
  });

  it('reconnects from the latest cursor with bounded backoff', () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const urls: string[] = [];
    const scheduled: Array<{callback: () => void; delay: number}> = [];
    const statuses: RealtimeStatus[] = [];
    const client = new RealtimeClient('http://10.0.2.2:8080', 'token', {
      socketFactory: url => { urls.push(url); return sockets[urls.length - 1]; },
      schedule: (callback, delay) => { scheduled.push({callback, delay}); return scheduled.length as ReturnType<typeof setTimeout>; },
      cancel: () => {}, random: () => 0,
      onFrame: () => {}, onStatus: status => statuses.push(status),
    });

    client.start(5);
    sockets[0].frame({type: 'events', cursor: 9, events: []});
    sockets[0].disconnect();
    scheduled.find(item => item.delay === 1000)?.callback();

    expect(scheduled.map(item => item.delay)).toContain(1000);
    expect(urls).toEqual([
      'ws://10.0.2.2:8080/api/v1/realtime?cursor=5',
      'ws://10.0.2.2:8080/api/v1/realtime?cursor=9',
    ]);
    expect(statuses).toContain('reconnecting');
    client.stop();
  });

  it('closes a half-open socket after inbound silence', () => {
    const socket = new FakeSocket();
    const scheduled: Array<{callback: () => void; delay: number}> = [];
    const client = new RealtimeClient('https://chat.example.test', 'token', {
      socketFactory: () => socket,
      schedule: (callback, delay) => { scheduled.push({callback, delay}); return scheduled.length as ReturnType<typeof setTimeout>; },
      cancel: () => {}, random: () => 0, onFrame: () => {},
    });

    client.start(0);
    scheduled.find(item => item.delay === 10_000)?.callback();

    expect(socket.closed).toBe(true);
    expect(scheduled.map(item => item.delay)).toContain(1000);
  });

  it('does not reconnect after being stopped', () => {
    const socket = new FakeSocket();
    const delays: number[] = [];
    const client = new RealtimeClient('https://chat.example.test', 'token', {
      socketFactory: () => socket,
      schedule: (callback, delay) => { delays.push(delay); return callback as unknown as ReturnType<typeof setTimeout>; },
      cancel: () => {}, onFrame: () => {},
    });

    client.start(0);
    client.stop();
    socket.disconnect();

    expect(socket.closed).toBe(true);
    expect(delays).not.toContain(1000);
  });
});
