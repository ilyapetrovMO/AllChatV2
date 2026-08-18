import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './app';

describe('desktop renderer bootstrap', () => {
  it('renders the local shell and an empty Instance state', async () => {
    render(
      <App
        bridge={{
          getShellState: async () => ({ instances: [], activeInstanceId: null }),
          addInstance: async () => ({ instances: [], activeInstanceId: null }),
          selectInstance: async () => ({ instances: [], activeInstanceId: null }),
          loginInstance: async () => ({ instances: [], activeInstanceId: null }),
          logoutInstance: async () => ({ instances: [], activeInstanceId: null }),
          loadInstance: async () => { throw new Error('not authenticated'); },
          watchInstance: () => () => undefined,
          executeInstance: async () => { throw new Error('not authenticated'); },
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Add your first Instance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Instance' })).toBeVisible();
  });

  it('renders authenticated Community navigation from the versioned bootstrap contract', async () => {
    render(
      <App bridge={{
        getShellState: async () => ({
          activeInstanceId: 'home',
          instances: [{
            id: 'home', displayName: 'Home', baseUrl: 'https://chat.example',
            partition: 'persist:allchat-home', credentialRef: 'desktop-session:home',
            session: {
              member: { id: 'me', username: 'nora', owner: false },
              sessionId: 'session-1', expiresAt: '2026-09-18T00:00:00Z',
            },
          }],
        }),
        addInstance: async () => { throw new Error('unused'); },
        selectInstance: async () => { throw new Error('unused'); },
        loginInstance: async () => { throw new Error('unused'); },
        logoutInstance: async () => { throw new Error('unused'); },
        loadInstance: async () => ({
          connection: 'online',
          version: 1,
          community: { name: 'Nora Community' },
          member: { id: 'me', username: 'nora', owner: false },
          members: [],
          categories: [{ id: 'cat', name: 'General', position: 0, archived: false }],
          channels: [{ id: 'chat', category_id: 'cat', name: 'lobby', type: 'text', position: 0, archived: false }],
          direct_messages: [],
          messages: {
            chat: [{
              id: 'message-1', channel_id: 'chat', author_id: 'member-2', author_name: 'Alex',
              sequence: 1, body: 'Desktop parity starts here', created_at: '2026-08-18T09:00:00Z', deleted: false,
            }],
          },
          channel_states: [], presence: {}, typing: [],
          notifications: {
            current_member_id: 'me', community: { level: 'default', muted: false },
            channels: {}, muted_channel_ids: [],
          },
          media: { audio_bitrate: 64000, screen_bitrate: 2500000 }, cursor: 1,
        }),
        watchInstance: () => () => undefined,
        executeInstance: async () => ({ type: 'accepted' }),
      }} />,
    );

    expect(await screen.findByRole('navigation', { name: 'Community conversations' })).toBeVisible();
    expect(screen.getAllByText('Nora Community')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'lobby' })).toBeVisible();
    expect(screen.getByText('@nora')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'lobby' }));
    expect(screen.getByRole('heading', { name: 'lobby' })).toBeVisible();
    expect(screen.getByText('Desktop parity starts here')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'User Settings' }));
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'User settings' })).toBeVisible();
  });
});
