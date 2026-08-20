import React from 'react';
import { FlatList, Image, Modal, Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import {
  activeMediaParticipantIDs,
  acceptedDirectCallConversationID,
  ConversationTimeline,
  formatMessageTime,
  homeDirectMessages,
  FormattedBody,
  loadAuthenticatedImage,
  mergeMessagePage,
  mediaParticipantAvatarDimension,
  shouldRenderInlineCallBanner,
  MessageRow,
  trimMessageWindow,
  conversationKeyboardBehavior,
} from '../src/screens/CommunityScreen';
import type { Message } from '../src/client/bootstrap';
import type { DirectMessage } from '../src/client/bootstrap';

const palette = {
  background: '#111111',
  field: '#222222',
  border: '#333333',
  text: '#ffffff',
  muted: '#aaaaaa',
  placeholder: '#777777',
  accent: '#5555ff',
};
const message: Message = {
  id: 'message-1',
  channel_id: 'channel-1',
  author_id: 'member-2',
  author_name: 'Member',
  sequence: 1,
  body: 'Hello',
  created_at: '2030-01-01T00:00:00Z',
  deleted: false,
};

describe('native conversation timeline', () => {
  it('opens the Direct Message as soon as a Direct Call is accepted', () => {
    expect(acceptedDirectCallConversationID({
      id: 'call-1', direct_message_id: 'dm-1', caller_id: 'member-1',
      recipient_id: 'member-2', state: 'accepted', created_at: '2030-01-01T00:00:00Z',
    })).toBe('dm-1');
    expect(acceptedDirectCallConversationID({
      id: 'call-1', direct_message_id: 'dm-1', caller_id: 'member-1',
      recipient_id: 'member-2', state: 'ringing', created_at: '2030-01-01T00:00:00Z',
    })).toBeUndefined();
  });
  it('renders an incoming Direct Call only in the global banner', () => {
    const incoming = {
      id: 'call-1', direct_message_id: 'dm-1', caller_id: 'member-2',
      recipient_id: 'member-1', state: 'ringing', created_at: '2030-01-01T00:00:00Z',
    };
    expect(shouldRenderInlineCallBanner(incoming, 'member-1')).toBe(false);
    expect(shouldRenderInlineCallBanner(incoming, 'member-2')).toBe(true);
    expect(shouldRenderInlineCallBanner({...incoming, state: 'accepted'}, 'member-1')).toBe(true);
  });
  it('resizes the conversation above Android keyboards', () => {
    expect(conversationKeyboardBehavior('android')).toBe('height');
    expect(conversationKeyboardBehavior('ios')).toBe('padding');
  });
  it('bounds compact call avatars so names fit inside short participant tiles', () => {
    expect(mediaParticipantAvatarDimension(true)).toBe(64);
    expect(mediaParticipantAvatarDimension(false)).toBe(96);
  });
  it('keeps the home DM preview bounded and removes transient duplicates', () => {
    const dm = (id: string): DirectMessage => ({
      id,
      other: { id: `member-${id}`, username: id, owner: false },
      blocked_by_me: false,
      blocked_me: false,
      unread: 0,
      created_at: '2030-01-01T00:00:00Z',
    });
    expect(
      homeDirectMessages([
        dm('one'),
        dm('two'),
        dm('two'),
        dm('three'),
        dm('four'),
      ]).map(item => item.id),
    ).toEqual(['one', 'two', 'three']);
  });
  it('removes disconnected remote participants from the active media grid', () => {
    expect(
      activeMediaParticipantIDs('mobile', [
        { member_id: 'web', connected: false },
        { member_id: 'mobile', connected: true },
      ]),
    ).toEqual(['mobile']);
  });
  it('renders fenced JSON as a labelled, syntax-highlighted code block', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <FormattedBody body={'before\n```json\n{"ready": true, "count": 2}\n```\nafter'} color="#fff" />,
      );
    });
    const block = tree.root.findByProps({accessibilityLabel: 'Code block, json'});
    expect(block).toBeTruthy();
    expect(block.findAllByType(Text).map(node => node.props.children).flat(Infinity).join('')).toContain('"ready": true');
  });

  it('supports compact same-line fenced code used by existing messages', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<FormattedBody body={'```json ["123", "321"] ```'} color="#fff" />);
    });
    expect(tree.root.findByProps({accessibilityLabel: 'Code block, json'})).toBeTruthy();
  });

  it('anchors the newest Message at the bottom without waiting for layout callbacks', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <ConversationTimeline
          account={{
            instance_url: 'https://chat.example.test',
            session_token: 'session-token',
          }}
          currentMemberID="member-1"
          messages={[message, { ...message, id: 'message-2', sequence: 2 }]}
          palette={palette}
        />,
      );
    });
    const list = tree.root.findByType(FlatList);

    expect(list.props.inverted).toBe(true);
    expect(list.props.data.map((item: Message) => item.sequence)).toEqual([
      2, 1,
    ]);
    expect(list.props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 0,
      autoscrollToTopThreshold: 80,
    });
  });

  it('renders the supported bold message syntax as styled native text', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageRow
          instanceURL="https://chat.example.test"
          message={{ ...message, body: 'This is **bold**.' }}
          mine={false}
          palette={palette}
          token="session-token"
        />,
      );
    });

    expect(
      tree.root.findAll(
        node =>
          node.props.style?.fontWeight === '800' &&
          node.children.includes('bold'),
      ),
    ).toHaveLength(1);
  });

  it('loads protected image bytes before passing them to the native decoder', async () => {
    const withImage = {
      ...message,
      attachments: [
        {
          id: 'attachment-1',
          name: 'photo.png',
          content_type: 'image/png',
          size: 120,
          url: '/api/v1/attachments/attachment-1',
        },
      ],
    };
    const loadImage = jest.fn(async () => 'data:image/png;base64,cGl4ZWxz');
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <MessageRow
          imageLoader={loadImage}
          instanceURL="https://chat.example.test"
          message={withImage}
          mine={false}
          palette={palette}
          token="session-token"
        />,
      );
    });

    expect(loadImage).toHaveBeenCalledWith(
      'https://chat.example.test/api/v1/attachments/attachment-1/preview',
      'session-token',
    );
    expect(tree.root.findByType(Image).props.source).toEqual({
      uri: 'data:image/png;base64,cGl4ZWxz',
    });

    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: 'Open photo.png' })
        .props.onPress();
    });
    expect(loadImage).toHaveBeenLastCalledWith(
      'https://chat.example.test/api/v1/attachments/attachment-1',
      'session-token',
    );
    expect(tree.root.findByType(Modal).props.visible).toBe(true);
    expect(tree.root.findAllByType(Image)).toHaveLength(2);
  });

  it('shows time for today and date plus time for older Messages', () => {
    const now = new Date(2030, 4, 10, 12, 0);
    expect(
      formatMessageTime(new Date(2030, 4, 10, 9, 30).toISOString(), now),
    ).toMatch(/09:30|9:30/);
    expect(
      formatMessageTime(new Date(2030, 4, 9, 9, 30).toISOString(), now),
    ).toMatch(/May|5|09/);
  });

  it('renders the timestamp beside the Member name', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageRow
          instanceURL="https://chat.example.test"
          message={message}
          mine={false}
          palette={palette}
          token="session-token"
        />,
      );
    });
    const timestamp = tree.root.find(
      node =>
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('Sent '),
    );
    const authorLine = timestamp.parent;
    const author = authorLine?.children[0];
    expect(typeof author === 'string' ? author : author?.props.children).toBe(
      'Member',
    );
    expect(authorLine?.children[1]).toBe(timestamp);
  });

  it('merges cursor pages without duplicates and trims the oldest history at present', () => {
    const messages = Array.from({ length: 125 }, (_, index) => ({
      ...message,
      id: `message-${index + 1}`,
      sequence: index + 1,
    }));
    const merged = mergeMessagePage(messages.slice(50), messages.slice(0, 51));
    expect(merged).toHaveLength(125);
    expect(merged.map(item => item.sequence)).toEqual(
      Array.from({ length: 125 }, (_, index) => index + 1),
    );
    expect(trimMessageWindow(merged)).toEqual(messages.slice(25));
  });

  it('converts an authenticated image response into a decoder-local data URI', async () => {
    const request = jest.fn(
      async () =>
        new Response(new Uint8Array([112, 105, 120, 101, 108, 115]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
    );
    await expect(
      loadAuthenticatedImage(
        'https://chat.example.test/image',
        'session-token',
        request as typeof fetch,
      ),
    ).resolves.toBe('data:image/png;base64,cGl4ZWxz');
    expect(request).toHaveBeenCalledWith('https://chat.example.test/image', {
      headers: { Authorization: 'Bearer session-token' },
    });
  });

  it('starts authenticated audio attachments only after the user asks to play', () => {
    const withAudio = {
      ...message,
      attachments: [
        {
          id: 'attachment-2',
          name: 'clip.ogg',
          content_type: 'audio/ogg',
          size: 2048,
          url: '/api/v1/attachments/attachment-2',
        },
      ],
    };
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <MessageRow
          instanceURL="https://chat.example.test"
          message={withAudio}
          mine={false}
          palette={palette}
          token="session-token"
        />,
      );
    });
    expect(
      tree.root.findAll(node => node.props.controls === true),
    ).toHaveLength(0);

    act(() => {
      tree.root
        .findByProps({ accessibilityLabel: 'Play clip.ogg' })
        .props.onPress();
    });

    const player = tree.root.find(node => node.props.controls === true);
    expect(player.props.source).toEqual({
      uri: 'https://chat.example.test/api/v1/attachments/attachment-2',
      headers: { Authorization: 'Bearer session-token' },
    });
  });
});
