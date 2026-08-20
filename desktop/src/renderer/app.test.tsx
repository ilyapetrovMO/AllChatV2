import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './app';

describe('desktop renderer bootstrap', () => {
  it('shows a single compatibility notice when a legacy Instance lacks Community settings', async () => {
    const executeInstance = vi.fn(async (_instanceId: string, action: { type: string }) => {
      if (action.type === 'get_community_settings') return {
        type: 'community_settings_unavailable' as const,
        reason: 'Update the Instance to manage Community settings from desktop.',
      };
      if (action.type === 'community_home') return { type: 'community_home' as const, markdown: '' };
      return { type: 'accepted' as const };
    });

    render(
      <StrictMode>
        <App bridge={{
          getShellState: async () => ({
            activeInstanceId: 'legacy',
            instances: [{
              id: 'legacy', displayName: 'Legacy', baseUrl: 'https://legacy.example',
              partition: 'persist:allchat-legacy', credentialRef: 'desktop-session:legacy',
              session: {
                member: { id: 'me', username: 'nora', owner: true },
                sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
              },
            }],
          }),
          addInstance: async () => { throw new Error('unused'); },
          selectInstance: async () => { throw new Error('unused'); },
          loginInstance: async () => { throw new Error('unused'); },
          registerInstance: async () => { throw new Error('unused'); },
          recoverInstance: async () => { throw new Error('unused'); },
          logoutInstance: async () => { throw new Error('unused'); },
          loadInstance: async () => ({
            connection: 'online', version: 1,
            community: { name: 'Legacy Community' },
            member: { id: 'me', username: 'nora', owner: true },
            members: [{ id: 'me', username: 'nora', owner: true }],
            categories: [], channels: [], direct_messages: [], messages: {},
            channel_states: [], presence: {}, typing: [],
            notifications: {
              current_member_id: 'me', community: { level: 'default', muted: false },
              channels: {}, muted_channel_ids: [],
            },
            media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1,
          }),
          watchInstance: () => () => undefined,
          executeInstance,
        }} />
      </StrictMode>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Legacy Community' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Community Settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Update the Instance to manage Community settings from desktop.',
    );
    await waitFor(() => {
      expect(executeInstance.mock.calls.filter(([, action]) => action.type === 'get_community_settings')).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'Communities' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeVisible();
  });

  it('renders the local shell and an empty Instance state', async () => {
    const controlWindow = vi.fn(async (_action: 'minimize' | 'toggle-maximize' | 'close') => undefined);
    const addInstance = vi.fn(async () => ({ instances: [], activeInstanceId: null }));
    render(
      <App
        bridge={{
          controlWindow,
          getShellState: async () => ({ instances: [], activeInstanceId: null }),
          addInstance,
          selectInstance: async () => ({ instances: [], activeInstanceId: null }),
          loginInstance: async () => ({ instances: [], activeInstanceId: null }),
          registerInstance: async () => ({ instances: [], activeInstanceId: null }),
          recoverInstance: async () => ({ instances: [], activeInstanceId: null }),
          logoutInstance: async () => ({ instances: [], activeInstanceId: null }),
          loadInstance: async () => { throw new Error('not authenticated'); },
          watchInstance: () => () => undefined,
          executeInstance: async () => { throw new Error('not authenticated'); },
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Add your first Instance' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Community address'), { target: { value: 'ru.elitedarklord.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }));
    await waitFor(() => expect(addInstance).toHaveBeenCalledWith({
      displayName: 'ru.elitedarklord.com',
      baseUrl: 'https://ru.elitedarklord.com',
    }));
    expect(screen.getByRole('button', { name: 'Add Instance' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }));
    expect(controlWindow.mock.calls.map(([action]) => action)).toEqual(['minimize', 'toggle-maximize', 'close']);
  });

  it('renders authenticated Community navigation from the versioned bootstrap contract', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:allchat-media'), revokeObjectURL: vi.fn() }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    }});
    let holdReaction = false;
    let resolveReaction: ((value: { type: 'accepted' }) => void) | undefined;
    const executeInstance = vi.fn(async (_instanceId: string, action: { type: string }) => {
      if (action.type === 'link_preview') return {
        type: 'link_preview' as const,
        preview: { url: 'https://example.com/story', site_name: 'Example', title: 'Example story', description: 'Preview text' },
      };
      if (action.type === 'open_dm') return {
        type: 'direct_message' as const,
        directMessage: {
          id: 'dm-alex', other: { id: 'alex', username: 'alex', owner: false },
          blocked_by_me: false, blocked_me: false, unread: 0, created_at: '2026-08-18T08:00:00Z',
        },
      };
      if (action.type === 'list_voice_participants') return {
        type: 'voice_participants' as const,
        channelId: 'voice',
        participants: [{
          member_id: 'me', room_id: 'voice', connected: true,
          joined_at: '2026-08-18T08:00:00Z', server_muted: false,
          speaking: true, muted: false, screen_sharing: false,
        }],
      };
      if (action.type === 'admin_dashboard') return {
        type: 'admin_dashboard' as const,
        dashboard: {
          checked_at: '2026-08-18T10:00:00Z', uptime_seconds: 7200,
          health: { database: 'ready', storage: 'failed', relay: 'external', sfu: 'ready' },
          counts: { members: 2, online_members: 1, messages: 42, attachments: 3 },
          resources: { cpu_seconds: 1, cpu_cores: 4, memory_bytes: 1024, heap_bytes: 512, disk_total_bytes: 4096, disk_available_bytes: 2048, app_storage_bytes: 1024 },
          storage_sources: [{ name: 'Messages', bytes: 512 }], message_rate: { messages_per_minute: 1, buckets: [] },
        },
      };
      if (action.type === 'list_roles') return { type: 'roles' as const, roles: [{ id: 'role-1', name: 'Moderator', position: 1, default: false, owner: false, permissions: ['moderate_members'] }] };
      if (action.type === 'list_invitations') return { type: 'invitations' as const, invitations: [{ id: 'invite-1', token: 'invite-token', expires_at: '2026-08-19T10:00:00Z', max_uses: 5, use_count: 1, revoked: false }] };
      if (action.type === 'list_soundboard') return { type: 'soundboard' as const, sounds: [{ id: 'sound-1', name: 'Airhorn', emoji: '📣', content_type: 'audio/ogg', size: 1024, duration_ms: 900, position: 0, audio_url: '/api/v1/soundboard/sound-1/audio' }], maxDurationMs: 10000, canManage: true };
      if (action.type === 'get_community_settings') return { type: 'community_settings' as const, settings: { name: 'AllChat Community', max_attachment_mib: 64, home_markdown: '# Welcome', push_relay_url: 'https://push.example.com', push_key_id: 'key-1', push_public_key: 'public-key' } };
      if (action.type === 'community_home') return { type: 'community_home' as const, markdown: '# Welcome to Nora Community\n\nChoose a Channel to begin.' };
      if (action.type === 'search_messages') return { type: 'search_results' as const, results: [{ message: { id: 'message-1', channel_id: 'chat', author_id: 'me', author_name: 'nora', sequence: 1, body: 'Global result', created_at: '2026-08-18T09:00:00Z', deleted: false }, channel_name: 'lobby', category_name: 'General', snippet: 'Global result', url: '/channels/chat#message-1' }] };
      if (action.type === 'load_asset') return { type: 'asset' as const, contentType: 'image/png', data: new Uint8Array([1, 2, 3]) };
      if (action.type === 'start_call') return { type: 'call' as const, call: { id: 'call-alex', direct_message_id: 'dm-alex', caller_id: 'me', recipient_id: 'alex', state: 'accepted' as const, created_at: '2026-08-18T09:00:00Z' } };
      if (action.type === 'call_action') return { type: 'call' as const, call: null };
      if (action.type === 'set_reaction' && holdReaction) return await new Promise<{ type: 'accepted' }>((resolve) => { resolveReaction = resolve; });
      return { type: 'accepted' as const };
    });
    render(
      <App bridge={{
        getShellState: async () => ({
          activeInstanceId: 'home',
          instances: [{
            id: 'home', displayName: 'Home', avatarUrl: '/api/v1/community-avatar?v=42', baseUrl: 'https://chat.example',
            partition: 'persist:allchat-home', credentialRef: 'desktop-session:home',
            session: {
              member: { id: 'me', username: 'nora', owner: true },
              sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
            },
          }],
        }),
        addInstance: async () => { throw new Error('unused'); },
        selectInstance: async () => ({
          activeInstanceId: 'home',
          instances: [{
            id: 'home', displayName: 'Home', avatarUrl: '/api/v1/community-avatar?v=42', baseUrl: 'https://chat.example',
            partition: 'persist:allchat-home', credentialRef: 'desktop-session:home',
            session: { member: { id: 'me', username: 'nora', owner: true }, sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z' },
          }],
        }),
        loginInstance: async () => { throw new Error('unused'); },
        registerInstance: async () => { throw new Error('unused'); },
        recoverInstance: async () => { throw new Error('unused'); },
        logoutInstance: async () => { throw new Error('unused'); },
        loadInstance: async () => ({
          connection: 'online',
          version: 1,
          community: { name: 'Nora Community' },
          member: { id: 'me', username: 'nora', owner: true },
          members: [
            { id: 'me', username: 'nora', owner: true },
            { id: 'alex', username: 'alex', owner: false },
          ],
          categories: [{ id: 'cat', name: 'General', position: 0, archived: false }],
          channels: [
            { id: 'chat', category_id: 'cat', name: 'lobby', type: 'text', position: 0, archived: false },
            { id: 'voice', category_id: 'cat', name: 'Lounge', type: 'voice', position: 1, archived: false },
          ],
          direct_messages: [{
            id: 'dm-alex', other: { id: 'alex', username: 'alex', owner: false },
            blocked_by_me: false, blocked_me: false, unread: 0, created_at: '2026-08-18T08:00:00Z',
          }],
          messages: {
            chat: [{
              id: 'message-1', channel_id: 'chat', author_id: 'me', author_name: 'nora',
              sequence: 1, body: '@alex Desktop parity starts here 🇺🇦 👩🏽‍💻 👨‍👩‍👧‍👦 1️⃣ 🏳️‍🌈 https://example.com/story\n```json ["123", "321"] ```', created_at: '2026-08-18T09:00:00Z', deleted: false,
              mentions: [{ member_id: 'alex', username: 'alex' }],
              attachments: [{ id: 'media-1', name: 'landscape.png', content_type: 'image/png', size: 1024, url: '/api/v1/attachments/media-1', preview_url: '/api/v1/attachments/media-1/preview' }],
            }],
          },
          channel_states: [], presence: { me: 'idle', alex: 'mobile' }, typing: [],
          notifications: {
            current_member_id: 'me', community: { level: 'default', muted: false },
            channels: {}, muted_channel_ids: [],
          },
          media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1,
        }),
        watchInstance: () => () => undefined,
        executeInstance,
      }} />,
    );

    expect(await screen.findByRole('navigation', { name: 'Community conversations' })).toBeVisible();
    expect(screen.getAllByText('Nora Community')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'lobby' })).toBeVisible();
    expect(screen.getByText('@nora')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide Members' })).toBeVisible();
    expect(document.querySelector('[data-lucide="users"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Home Instance' })).toBeVisible();
    await waitFor(() => expect(document.querySelector('.instance-avatar')).toHaveAttribute('src', 'blob:allchat-media'));
    expect(executeInstance).toHaveBeenCalledWith('home', { type: 'load_asset', path: '/api/v1/community-avatar?v=42' });
    expect(screen.getByRole('button', { name: 'Add Community' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Direct Messages' })).toBeVisible();
    expect(screen.getByLabelText('Search Messages')).toBeVisible();
    expect(document.querySelector('.presence-dot.mobile')).toBeInTheDocument();
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', { type: 'report_activity', active: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Member menu' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Presence status' })).getByRole('menuitem', { name: 'Online' }));
    expect(document.querySelector('.member-summary-avatar .presence-dot.online')).toBeInTheDocument();
    expect(executeInstance).toHaveBeenCalledWith('home', { type: 'set_presence', mode: 'available' });
    const initialVoiceMembers = await screen.findByRole('list', { name: 'Lounge participants' });
    expect(within(initialVoiceMembers).getByText('nora')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Nora Community' }));
    expect(screen.getByRole('menuitem', { name: 'Community Home' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Direct Messages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'My Account' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Community Settings' }));
    expect(screen.getByRole('heading', { name: 'Community Settings', level: 1 })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'User settings' })).not.toBeInTheDocument();
    const communityAdministration = document.querySelector('[data-community-administration]') as HTMLElement;
    expect(await within(communityAdministration).findByRole('heading', { name: 'General' })).toBeVisible();
    expect(screen.getByLabelText('Search Messages')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Home Instance' }));
    expect(await screen.findByRole('heading', { name: 'Welcome to Nora Community' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Nora Community' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Community Settings' }));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Community settings' })).getByRole('button', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Instance overview' })).toBeVisible();
    expect(await screen.findByText('42')).toBeVisible();
    expect(screen.getByText('2h 0m')).toBeVisible();
    expect(screen.getByText('Process memory')).toBeVisible();
    expect(screen.getAllByText('CPU').length).toBeGreaterThan(0);
    expect(screen.getAllByText('App storage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Relay').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Resource usage' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Messages sent' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'CPU history' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Memory and App storage history' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Messages/min history' })).toBeVisible();
    expect(screen.getByText('Storage by source')).toBeVisible();
    expect(screen.getByText('Subsystem health')).toBeVisible();
    expect(document.querySelector('.dashboard-health-dot.failed')).toBeInTheDocument();
    const communitySettingsNavigation = screen.getByRole('navigation', { name: 'Community settings' });
    fireEvent.click(within(communitySettingsNavigation).getByRole('button', { name: 'Roles' }));
    expect(await screen.findByText('Moderator')).toBeVisible();
    fireEvent.click(within(communitySettingsNavigation).getByRole('button', { name: 'Invitations' }));
    expect(await screen.findByText('invite-token')).toBeVisible();
    fireEvent.click(within(communitySettingsNavigation).getByRole('button', { name: 'Channels' }));
    const channelAdministration = document.querySelector('.administration-list') as HTMLElement;
    expect(within(channelAdministration).getByText('lobby')).toBeVisible();
    fireEvent.click(within(channelAdministration).getAllByRole('button', { name: 'Archive' })[0]);
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', { type: 'set_channel_archived', channelId: 'chat', archived: true }));
    fireEvent.click(within(communitySettingsNavigation).getByRole('button', { name: 'Soundboard' }));
    expect(await screen.findByText(/Airhorn/)).toBeVisible();

    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('message-list') ? 1_000 : 0;
    });
    fireEvent.click(screen.getByRole('button', { name: 'lobby' }));
    expect(document.querySelector('.message-body .mention')).toHaveTextContent('@alex');
    expect(screen.getByRole('heading', { name: 'lobby' })).toBeVisible();
    expect(screen.getByText(/Desktop parity starts here 🇺🇦 👩🏽‍💻 👨‍👩‍👧‍👦 1️⃣ 🏳️‍🌈/)).toBeVisible();
    const messageSearch = screen.getByLabelText('Search Messages');
    fireEvent.focus(messageSearch);
    fireEvent.click(within(screen.getByRole('menu', { name: 'Search filters' })).getByRole('menuitem', { name: /Includes a file/ }));
    expect(messageSearch).toHaveValue('has:file');
    expect(screen.getByLabelText('lobby Messages')).toHaveProperty('scrollTop', 1_000);
    scrollHeight.mockRestore();
    expect(screen.getByText(/Desktop parity starts here/)).toBeVisible();
    const jsonCode = document.querySelector('pre code.language-json') as HTMLElement;
    expect(jsonCode).toBeVisible();
    expect(jsonCode.querySelectorAll('.syntax-string')).toHaveLength(2);
    expect(jsonCode).toHaveTextContent(/"123"/);
    expect(screen.getByRole('link', { name: 'https://example.com/story' })).toHaveAttribute('href', 'https://example.com/story');
    expect(await screen.findByText('Example story')).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'View landscape.png at full size' }));
    const imageViewer = await screen.findByRole('dialog', { name: 'Image viewer: landscape.png' });
    expect(within(imageViewer).getByRole('img', { name: 'landscape.png' })).toBeVisible();
    fireEvent.wheel(imageViewer, { deltaY: -100 });
    expect(within(imageViewer).getByText('115%')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Image viewer: landscape.png' })).not.toBeInTheDocument();
    const messageList = screen.getByLabelText('lobby Messages');
    Object.defineProperties(messageList, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 300 },
    });
    messageList.scrollTop = 100;
    fireEvent.scroll(messageList);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to present' }));
    expect(messageList).toHaveProperty('scrollTop', 1_000);
    Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 1_400 });
    fireEvent.load(screen.getByRole('img', { name: 'landscape.png' }));
    expect(messageList).toHaveProperty('scrollTop', 1_400);

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByText('Replying to a Message')).toBeVisible();
    fireEvent.click(within(screen.getByText('Replying to a Message')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Editing Message')).toBeVisible();
    fireEvent.click(within(screen.getByText('Editing Message')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_pinned', messageId: 'message-1', active: true,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByRole('region', { name: 'Notification settings' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Conversation notification level'), { target: { value: 'mentions_only' } });
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_channel_notifications', channelId: 'chat', level: 'mentions_only', muted: false,
    }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region', { name: 'Notification settings' })).not.toBeInTheDocument();
    holdReaction = true;
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    expect(screen.getByRole('menu', { name: 'Choose a Reaction' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Add 👍 Reaction' }));
    expect(screen.getByRole('button', { name: '👍 1' })).toHaveAttribute('aria-pressed', 'true');
    resolveReaction?.({ type: 'accepted' });
    holdReaction = false;
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_reaction', messageId: 'message-1', emoji: '👍', active: true,
    }));
    expect(screen.getByRole('button', { name: '👍 1' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Remove 👍 Reaction' }));
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_reaction', messageId: 'message-1', emoji: '👍', active: false,
    }));
    expect(screen.queryByRole('button', { name: '👍 1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    const customReaction = screen.getByLabelText('Custom Reaction');
    fireEvent.change(customReaction, { target: { value: '🇺🇦' } });
    fireEvent.keyDown(customReaction, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_reaction', messageId: 'message-1', emoji: '🇺🇦', active: true,
    }));

    const messageInput = screen.getByLabelText('Message lobby');
    expect(screen.queryByRole('button', { name: 'Send Message' })).not.toBeInTheDocument();
    fireEvent.change(messageInput, { target: { value: 'Hello @al', selectionStart: 9 } });
    expect(screen.getByRole('listbox', { name: 'Mention a Member' })).toBeVisible();
    fireEvent.keyDown(messageInput, { key: 'Tab', code: 'Tab' });
    expect(messageInput).toHaveValue('Hello @alex ');
    const emojiMessage = 'Flags 🇺🇦 🇯🇵 · skin 👩🏽‍💻 · family 👨‍👩‍👧‍👦 · keycap 1️⃣ · rainbow 🏳️‍🌈';
    fireEvent.change(messageInput, { target: { value: emojiMessage } });
    fireEvent.keyDown(messageInput, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'send_message', conversationId: 'chat', direct: false, body: emojiMessage, attachmentIds: [],
    }));
    const sendsAfterEnter = executeInstance.mock.calls.filter(([, action]) => action.type === 'send_message').length;
    fireEvent.change(messageInput, { target: { value: 'First line' } });
    fireEvent.keyDown(messageInput, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(executeInstance.mock.calls.filter(([, action]) => action.type === 'send_message')).toHaveLength(sendsAfterEnter);

    const pastedImage = new File(['pixels'], 'clipboard.png', { type: 'image/png', lastModified: 2 });
    fireEvent.paste(messageInput, { clipboardData: { items: [{ kind: 'file', getAsFile: () => pastedImage }] } });
    expect(screen.getByText('clipboard.png')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove clipboard.png' }));

    const composer = screen.getByLabelText('Message lobby').closest('form')!;
    expect(composer).toHaveClass('message-composer');
    expect(composer.querySelector(':scope > .typing-indicator')).toBeNull();
    expect(composer.parentElement).toHaveClass('message-composer-wrap');
    expect(composer.parentElement?.querySelector(':scope > .typing-indicator')).toBeInTheDocument();
    const firstFile = new File(['notes'], 'notes.txt', { type: 'text/plain', lastModified: 1 });
    fireEvent.drop(composer, { dataTransfer: { files: [firstFile], types: ['Files'], dropEffect: 'none' } });
    expect(screen.getByRole('region', { name: 'Files ready to send' })).toBeVisible();
    expect(screen.getByText('notes.txt')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' }));
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'User Settings' }));
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'User settings' })).toBeVisible();
    const globalSearch = screen.getByLabelText('Search Messages');
    fireEvent.change(globalSearch, { target: { value: 'global' } });
    fireEvent.submit(globalSearch.closest('form')!);
    expect(await screen.findByRole('heading', { name: 'Search Results' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close Search' }));
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Voice & Video' }));
    const voiceSettings = document.querySelector('[data-voice-settings]') as HTMLElement;
    expect(within(voiceSettings).getByRole('heading', { name: 'Voice & Video' })).toBeVisible();
    expect(within(voiceSettings).getByLabelText('Microphone')).toBeVisible();
    expect(within(voiceSettings).getByLabelText('Speaker')).toBeVisible();
    expect(within(voiceSettings).getByLabelText('Camera')).toBeVisible();
    fireEvent.change(within(voiceSettings).getByLabelText('Microphone volume'), { target: { value: '1.25' } });
    expect(JSON.parse(localStorage.getItem('allchat:voice-video:v1:desktop:me') || '{}')).toMatchObject({ inputGain: 1.25 });
    fireEvent.change(within(voiceSettings).getByLabelText('Noise suppression'), { target: { value: 'off' } });
    expect(JSON.parse(localStorage.getItem('allchat:voice-video:v1:desktop:me') || '{}')).toMatchObject({ noiseSuppressionMode: 'off' });
    fireEvent.click(within(voiceSettings).getByRole('button', { name: 'Reset' }));
    expect(voiceSettings.querySelector('.voice-settings-notice')).toHaveTextContent('Voice & Video settings were reset.');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'User settings' })).getByRole('button', { name: 'Notifications' }));
    const notificationSettings = document.querySelector('[data-notification-settings]') as HTMLElement;
    expect(within(notificationSettings).getByRole('heading', { name: 'Notifications' })).toBeVisible();
    expect(within(notificationSettings).getByText('Native notifications enabled')).toBeVisible();
    fireEvent.change(within(notificationSettings).getByLabelText('Community notification level'), { target: { value: 'all_messages' } });
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_community_notifications', level: 'all_messages', muted: false, soundEnabled: true,
    }));
    fireEvent.change(within(notificationSettings).getByLabelText('lobby notification level'), { target: { value: 'nothing' } });
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_channel_notifications', channelId: 'chat', level: 'nothing', muted: false,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(screen.getAllByRole('heading', { name: 'Sessions' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Safety' }));
    expect(screen.getAllByRole('heading', { name: 'Safety' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'lobby' }));
    const alexMember = within(screen.getByRole('complementary', { name: 'Members' }))
      .getByRole('button', { name: 'alex@alex' });
    vi.spyOn(alexMember, 'getBoundingClientRect').mockReturnValue({
      x: 800, y: 240, left: 800, right: 920, top: 240, bottom: 272,
      width: 120, height: 32, toJSON: () => ({}),
    });
    fireEvent.click(alexMember);
    const memberPopover = screen.getByRole('dialog', { name: 'Member profile' });
    expect(memberPopover).toHaveStyle({ position: 'fixed', left: '716px', top: '280px' });
    expect(screen.getByRole('heading', { name: 'alex' })).toBeVisible();
    expect(within(memberPopover).queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
    fireEvent.click(within(memberPopover).getByRole('button', { name: 'Member actions' }));
    const memberActions = within(memberPopover).getByRole('group', { name: 'Member actions' });
    expect(memberActions).toHaveClass('member-card-actions');
    expect(within(memberActions).getAllByRole('button')).toHaveLength(4);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Member profile' })).not.toBeInTheDocument();
    fireEvent.click(alexMember);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Member profile' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'alex' }));
    expect(screen.getByRole('button', { name: 'Start Call' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', {
      type: 'set_block', memberId: 'alex', blocked: true,
    }));
    expect(screen.getByText('You blocked this Member. Unblock them to send Messages.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Start Call' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Call' })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Start Call' }));
    const directCallGrid = await screen.findByRole('region', { name: 'Direct Call grid' });
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
    expect(directCallGrid).toBeVisible();
    expect(directCallGrid.closest('.direct-call-workspace')).toBeTruthy();
    expect(directCallGrid.closest('.message-list')).toBeNull();
    expect(directCallGrid.querySelector('.media-stage-grid')).toHaveAttribute('data-tile-count', '2');
    expect(directCallGrid.querySelectorAll('.media-stage-visual')).toHaveLength(2);
    expect(within(directCallGrid).getByText('You')).toBeVisible();
    expect(screen.getByLabelText('alex Messages')).toBeVisible();
    fireEvent.click(within(screen.getByRole('region', { name: 'Call controls' })).getByRole('button', { name: 'End call' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Home' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Direct Messages' }));
    expect(screen.getByRole('heading', { name: 'Direct Messages', level: 1 })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Start a Direct Message'), { target: { value: 'alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open DM' }));
    await waitFor(() => expect(executeInstance).toHaveBeenCalledWith('home', { type: 'open_dm', memberId: 'alex' }));
    expect(screen.getByRole('heading', { name: 'alex' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Lounge' }));
    expect(screen.getByLabelText('Search Messages')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Join Voice' })).not.toBeInTheDocument();
    const voiceControls = screen.getByRole('region', { name: 'Voice controls' });
    expect(within(voiceControls).getByRole('button', { name: 'Disconnect voice' })).toBeVisible();
    expect(within(voiceControls).getByRole('button', { name: 'Mute microphone' })).toBeVisible();
    expect(within(voiceControls).getByRole('button', { name: 'Share screen' })).toBeVisible();
    expect(within(voiceControls).getByRole('button', { name: 'Open soundboard' })).toBeVisible();
    expect(within(voiceControls).getByRole('slider', { name: 'Call volume' })).toBeVisible();
    expect(voiceControls.parentElement?.nextElementSibling).toHaveClass('member-panel');
    const conversationHeader = document.querySelector('.conversation-content > header') as HTMLElement;
    expect(within(conversationHeader).queryByRole('button', { name: 'Disconnect voice' })).not.toBeInTheDocument();
    expect(within(conversationHeader).queryByRole('button', { name: 'Start Call' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'alex' })).toBeVisible();
    const voiceMembers = await screen.findByRole('list', { name: 'Lounge participants' });
    expect(within(voiceMembers).getByText('nora')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Lounge' }));
    expect(document.querySelector('.media-stage-tile.speaking')).toBeInTheDocument();
    fireEvent.contextMenu(within(voiceMembers).getByRole('button', { name: 'nora' }), { clientX: 400, clientY: 240 });
    const voiceMenu = screen.getByRole('menu', { name: 'Voice Member actions' });
    fireEvent.click(within(voiceMenu).getByRole('menuitem', { name: 'Profile' }));
    expect(screen.getByRole('dialog', { name: 'Member profile' })).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Nora Community' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Community Home' }));
    expect(screen.queryByRole('region', { name: 'Voice controls' })).not.toBeInTheDocument();
  }, 15_000);
});
