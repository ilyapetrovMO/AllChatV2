import { describe, expect, it, vi } from 'vitest';

import { RealtimeConnection, type RealtimeSocket } from './realtime-connection';

describe('RealtimeConnection', () => {
  it('opens an authenticated cursor-resuming socket and emits valid frames', () => {
    const socket: RealtimeSocket = {
      readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null,
      send: vi.fn(), close: vi.fn(),
    };
    const createSocket = vi.fn(() => socket);
    const onFrame = vi.fn();
    const connection = new RealtimeConnection({
      baseUrl: 'https://chat.example', token: 'secret', cursor: 8, onFrame, createSocket,
    });

    connection.start();
    socket.readyState = 1;
    connection.sendActivity(true);
    socket.onmessage?.({ data: JSON.stringify({ type: 'message.created', cursor: 9, channel_id: 'chat', payload: {} }) });

    expect(createSocket).toHaveBeenCalledWith('wss://chat.example/api/v1/realtime?cursor=8', 'secret');
    expect(onFrame).toHaveBeenCalledWith({ type: 'message.created', cursor: 9, channel_id: 'chat', payload: {} });
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'activity', active: true }));
    connection.stop();
  });
});
// @vitest-environment node
