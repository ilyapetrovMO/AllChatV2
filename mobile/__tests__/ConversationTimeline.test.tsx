import React from 'react';
import {FlatList, Image} from 'react-native';
import renderer, {act} from 'react-test-renderer';

import {ConversationTimeline, isNearLatest, MessageRow} from '../src/screens/CommunityScreen';
import type {Message} from '../src/client/bootstrap';

const palette = {background: '#111111', field: '#222222', border: '#333333', text: '#ffffff', muted: '#aaaaaa', placeholder: '#777777', accent: '#5555ff'};
const message: Message = {id: 'message-1', channel_id: 'channel-1', author_id: 'member-2', author_name: 'Member', sequence: 1, body: 'Hello', created_at: '2030-01-01T00:00:00Z', deleted: false};

describe('native conversation timeline', () => {
  it('requests the latest position after initial layout and content growth', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<ConversationTimeline account={{instance_url: 'https://chat.example.test', session_token: 'session-token'}} currentMemberID="member-1" messages={[message]} palette={palette} />); });
    const list = tree.root.findByType(FlatList);

    expect(list.props.onLayout).toEqual(expect.any(Function));
    expect(list.props.onContentSizeChange).toEqual(expect.any(Function));
    expect(isNearLatest({contentSize: {height: 1000, width: 400}, layoutMeasurement: {height: 600, width: 400}, contentOffset: {x: 0, y: 330}, velocity: undefined, zoomScale: 1, contentInset: {top: 0, left: 0, bottom: 0, right: 0}, targetContentOffset: undefined})).toBe(true);
    expect(isNearLatest({contentSize: {height: 1000, width: 400}, layoutMeasurement: {height: 600, width: 400}, contentOffset: {x: 0, y: 100}, velocity: undefined, zoomScale: 1, contentInset: {top: 0, left: 0, bottom: 0, right: 0}, targetContentOffset: undefined})).toBe(false);
  });

  it('renders authenticated image attachments as images', () => {
    const withImage = {...message, attachments: [{id: 'attachment-1', name: 'photo.png', content_type: 'image/png', size: 120, url: '/api/v1/attachments/attachment-1'}]};
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<MessageRow instanceURL="https://chat.example.test" message={withImage} mine={false} palette={palette} token="session-token" />); });

    expect(tree.root.findByType(Image).props.source).toEqual({uri: 'https://chat.example.test/api/v1/attachments/attachment-1', headers: {Authorization: 'Bearer session-token'}});
  });

  it('starts authenticated audio attachments only after the user asks to play', () => {
    const withAudio = {...message, attachments: [{id: 'attachment-2', name: 'clip.ogg', content_type: 'audio/ogg', size: 2048, url: '/api/v1/attachments/attachment-2'}]};
    let tree!: renderer.ReactTestRenderer;
    act(() => { tree = renderer.create(<MessageRow instanceURL="https://chat.example.test" message={withAudio} mine={false} palette={palette} token="session-token" />); });
    expect(tree.root.findAll(node => node.props.controls === true)).toHaveLength(0);

    act(() => { tree.root.findByProps({accessibilityLabel: 'Play clip.ogg'}).props.onPress(); });

    const player = tree.root.find(node => node.props.controls === true);
    expect(player.props.source).toEqual({uri: 'https://chat.example.test/api/v1/attachments/attachment-2', headers: {Authorization: 'Bearer session-token'}});
  });
});
