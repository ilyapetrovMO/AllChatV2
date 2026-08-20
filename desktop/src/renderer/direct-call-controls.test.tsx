import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InstanceAction, InstanceActionResult } from '../shared/instance-actions';
import { createTransientCallStatusController, DirectCallControls } from './app';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('DirectCallControls remote lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('does not restore connected controls when an older accepted poll resolves after remote hangup', async () => {
    vi.useFakeTimers();
    const staleAccepted = deferred<InstanceActionResult | undefined>();
    const remoteHangup = deferred<InstanceActionResult | undefined>();
    let currentCallRequests = 0;
    const onAction = vi.fn((_action: InstanceAction) => {
      currentCallRequests += 1;
      return currentCallRequests === 1 ? staleAccepted.promise : remoteHangup.promise;
    });

    render(<>
      <div id="desktop-call-controls" />
      <DirectCallControls
        conversation={{ id: 'dm-alex', name: 'Alex', type: 'dm' }}
        currentMemberId="me"
        instanceId="instance-1"
        onAction={onAction}
        requestedVoiceRoom={null}
        requestedVoiceRoomName=""
        onVoiceRoomChange={vi.fn()}
        onCallChange={vi.fn()}
      />
    </>);

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(currentCallRequests).toBe(2);

    await act(async () => { remoteHangup.resolve({ type: 'call', call: null }); });
    expect(screen.queryByRole('region', { name: 'Call controls' })).not.toBeInTheDocument();

    await act(async () => {
      staleAccepted.resolve({
        type: 'call',
        call: {
          id: 'call-alex', direct_message_id: 'dm-alex', caller_id: 'me', recipient_id: 'alex',
          state: 'accepted', created_at: '2026-08-20T10:00:00Z',
        },
      });
    });

    expect(screen.queryByRole('region', { name: 'Call controls' })).not.toBeInTheDocument();
  });

  it('resolves the authenticated ringtone when an incoming Call starts', async () => {
    const onAction = vi.fn(async (action: InstanceAction): Promise<InstanceActionResult | undefined> => {
      if (action.type === 'current_call') return {type: 'call', call: {id: 'incoming', direct_message_id: 'dm-alex', caller_id: 'alex', recipient_id: 'me', state: 'ringing', created_at: '2026-08-20T10:00:00Z'}};
      if (action.type === 'load_asset') return {type: 'asset', contentType: 'application/octet-stream', data: new Uint8Array()};
      return {type: 'accepted'};
    });
    render(<><div id="desktop-call-controls" /><DirectCallControls conversation={{id:'dm-alex',name:'Alex',type:'dm'}} currentMemberId="me" instanceId="instance-1" onAction={onAction} requestedVoiceRoom={null} requestedVoiceRoomName="" onVoiceRoomChange={vi.fn()} onCallChange={vi.fn()} /></>);
    expect(await screen.findByRole('region', {name: 'Incoming Call controls'})).toBeVisible();
    expect(onAction).toHaveBeenCalledWith({type: 'load_asset', path: '/api/v1/ringtone'});
  });
});

describe('transient Call status', () => {
  afterEach(() => vi.useRealTimers());

  it('restores the connected label after temporary action feedback', () => {
    vi.useFakeTimers();
    const setStatus = vi.fn();
    const controller = createTransientCallStatusController(setStatus, () => 'Call connected');

    controller.show('Not supported.');
    expect(setStatus).toHaveBeenLastCalledWith('Not supported.');
    vi.advanceTimersByTime(2_999);
    expect(setStatus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(setStatus).toHaveBeenLastCalledWith('Call connected');
  });

  it('does not hide a real disconnection and cancels restoration on cleanup', () => {
    vi.useFakeTimers();
    const setStatus = vi.fn();
    let connected = true;
    const controller = createTransientCallStatusController(setStatus, () => connected ? 'Call connected' : null);
    controller.show('Screen sharing failed.');
    connected = false;
    vi.advanceTimersByTime(3_000);
    expect(setStatus).toHaveBeenCalledTimes(1);

    connected = true;
    controller.show('Not supported.');
    controller.clear();
    vi.advanceTimersByTime(3_000);
    expect(setStatus).toHaveBeenLastCalledWith('Not supported.');
  });
});
