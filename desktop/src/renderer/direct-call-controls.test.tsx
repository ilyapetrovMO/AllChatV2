import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InstanceAction, InstanceActionResult } from '../shared/instance-actions';
import { bindRemoteScreenTrack, createTransientCallStatusController, DirectCallControls } from './app';

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
        focusedMediaMemberId={null}
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
    const onIncomingCallNotification = vi.fn();
    const onAction = vi.fn(async (action: InstanceAction): Promise<InstanceActionResult | undefined> => {
      if (action.type === 'current_call') return {type: 'call', call: {id: 'incoming', direct_message_id: 'dm-alex', caller_id: 'alex', recipient_id: 'me', state: 'ringing', created_at: '2026-08-20T10:00:00Z'}};
      if (action.type === 'load_asset') return {type: 'asset', contentType: 'application/octet-stream', data: new Uint8Array()};
      return {type: 'accepted'};
    });
    render(<><div id="desktop-call-controls" /><DirectCallControls conversation={{id:'dm-alex',name:'Alex',type:'dm'}} currentMemberId="me" instanceId="instance-1" onAction={onAction} requestedVoiceRoom={null} requestedVoiceRoomName="" focusedMediaMemberId={null} onIncomingCallNotification={onIncomingCallNotification} onVoiceRoomChange={vi.fn()} onCallChange={vi.fn()} /></>);
    expect(await screen.findByRole('region', {name: 'Incoming Call controls'})).toBeVisible();
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({type: 'load_asset', path: '/api/v1/ringtone'}));
    await waitFor(() => expect(onIncomingCallNotification).toHaveBeenCalledWith({callId: 'incoming', callerName: 'Alex'}));
  });

  it('opens the callers Direct Message immediately when accepting', async () => {
    const onOpenDirectCall = vi.fn();
    const onAction = vi.fn(async (action: InstanceAction): Promise<InstanceActionResult | undefined> => {
      if (action.type === 'current_call') return {type: 'call', call: {id:'incoming',direct_message_id:'dm-alex',caller_id:'alex',recipient_id:'me',state:'ringing',created_at:'2026-08-20T10:00:00Z'}};
      if (action.type === 'load_asset') return {type:'asset',contentType:'application/octet-stream',data:new Uint8Array()};
      if (action.type === 'call_action') return {type:'call',call:{id:'incoming',direct_message_id:'dm-alex',caller_id:'alex',recipient_id:'me',state:'accepted',created_at:'2026-08-20T10:00:00Z'}};
      return {type:'accepted'};
    });
    render(<><div id="desktop-call-controls" /><DirectCallControls conversation={{id:'text-channel',name:'general',type:'text'}} directCallNames={{'dm-alex':'Alex'}} currentMemberId="me" instanceId="instance-1" onAction={onAction} requestedVoiceRoom={null} requestedVoiceRoomName="" focusedMediaMemberId={null} onOpenDirectCall={onOpenDirectCall} onVoiceRoomChange={vi.fn()} onCallChange={vi.fn()} /></>);

    fireEvent.click(await screen.findByRole('button', {name:'Accept'}));
    expect(onOpenDirectCall).toHaveBeenCalledWith('dm-alex');
  });

  it('keeps the active DM name when another channel is selected', async () => {
    const onOpenDirectCall = vi.fn();
    const onAction = vi.fn(async (action: InstanceAction): Promise<InstanceActionResult | undefined> => {
      if (action.type === 'current_call') return {type: 'call', call: {id:'call-mobile',direct_message_id:'dm-mobile',caller_id:'me',recipient_id:'mobile',state:'accepted',created_at:'2026-08-20T10:00:00Z'}};
      return {type:'accepted'};
    });
    render(<>
      <div id="desktop-call-controls" />
      <DirectCallControls
        conversation={{id:'text-channel',name:'text channel',type:'text'}}
        directCallNames={{'dm-mobile':'mobile'}}
        currentMemberId="me"
        instanceId="instance-1"
        onAction={onAction}
        requestedVoiceRoom={null}
        requestedVoiceRoomName=""
        focusedMediaMemberId={null}
        onOpenDirectCall={onOpenDirectCall}
        onVoiceRoomChange={vi.fn()}
        onCallChange={vi.fn()}
      />
    </>);

    const controls = await screen.findByRole('region', {name:'Call controls'});
    expect(within(controls).getByText('Connecting')).toBeVisible();
    expect(controls).toHaveTextContent('mobile');
    expect(controls).not.toHaveTextContent('text channel');
    fireEvent.click(screen.getByRole('button', {name:'Return to Direct Message with mobile'}));
    expect(onOpenDirectCall).toHaveBeenCalledWith('dm-mobile');
  });
});

describe('remote screen track lifecycle', () => {
  it('does not render an initially muted video transceiver as screen sharing', () => {
    const track = new EventTarget() as MediaStreamTrack;
    Object.defineProperties(track, {
      muted: { configurable: true, value: true, writable: true },
      readyState: { configurable: true, value: 'live', writable: true },
    });
    const stream = {} as MediaStream;
    let screens: Record<string, MediaStream> = {};
    const update = (updater: (current: Record<string, MediaStream>) => Record<string, MediaStream>) => {
      screens = updater(screens);
    };

    bindRemoteScreenTrack(track, stream, 'mobile', update);
    expect(screens).toEqual({});

    Object.defineProperty(track, 'muted', { configurable: true, value: false, writable: true });
    track.dispatchEvent(new Event('unmute'));
    expect(screens.mobile).toBe(stream);

    track.dispatchEvent(new Event('mute'));
    expect(screens).toEqual({});

    Object.defineProperty(track, 'readyState', { configurable: true, value: 'ended', writable: true });
    track.dispatchEvent(new Event('unmute'));
    expect(screens).toEqual({});
  });
  it('does not resurrect a stopped publication on a late unmute', () => {
    const track = new EventTarget() as MediaStreamTrack;
    Object.defineProperties(track, { muted: { configurable: true, value: false, writable: true }, readyState: { configurable: true, value: 'live', writable: true } });
    const stream = {} as MediaStream;
    let publishing = true, screens: Record<string, MediaStream> = {};
    bindRemoteScreenTrack(track, stream, 'mobile', update => { screens = update(screens); }, () => publishing);
    expect(screens.mobile).toBe(stream);
    publishing = false;
    track.dispatchEvent(new Event('mute'));
    track.dispatchEvent(new Event('unmute'));
    expect(screens).toEqual({});
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
