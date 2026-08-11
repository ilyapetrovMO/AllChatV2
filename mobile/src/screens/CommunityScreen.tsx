import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Video from 'react-native-video';

import {AllChatClient} from '../client/AllChatClient';
import type {DirectMessage, Message} from '../client/bootstrap';
import {RealtimeClient, type RealtimeStatus} from '../realtime/RealtimeClient';
import type {InstanceAccount} from '../session/SessionVault';
import {communityStateFromBootstrap, reduceRealtimeFrame, type CommunityState} from '../state/CommunityState';

type Palette = {background: string; field: string; border: string; text: string; muted: string; placeholder: string; accent: string};

export function CommunityScreen({account, palette, onManage}: {account: InstanceAccount; palette: Palette; onManage(): void}): React.JSX.Element {
  const [community, setCommunity] = useState<CommunityState>();
  const [activeID, setActiveID] = useState('');
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const realtime = useRef<RealtimeClient | null>(null);
  const client = useMemo(() => new AllChatClient(account.instance_url), [account.instance_url]);

  useEffect(() => {
    let mounted = true;
    async function synchronize() {
      try {
        const bootstrap = await client.bootstrap(account.session_token);
        if (!mounted) return;
        setCommunity(communityStateFromBootstrap(bootstrap));
        setError('');
        const stream = new RealtimeClient(account.instance_url, account.session_token, {
          onStatus: setStatus,
          onFrame: frame => {
            if (frame.type === 'snapshot_required') {
              synchronize().catch(() => {});
              return;
            }
            setCommunity(current => current ? reduceRealtimeFrame(current, frame) : current);
          },
        });
        realtime.current?.stop();
        realtime.current = stream;
        stream.start(bootstrap.cursor);
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : 'Could not synchronize the Instance.');
      }
    }
    synchronize().catch(() => {});
    return () => { mounted = false; realtime.current?.stop(); realtime.current = null; };
  }, [account.instance_url, account.session_token, client]);

  const direct = community?.direct_messages.find(item => item.id === activeID);
  const channel = community?.channels.find(item => item.id === activeID);
  const messages = community?.messages[activeID] || [];

  async function openConversation(id: string, isDirect: boolean) {
    setActiveID(id);
    const current = community?.channel_states.find(item => item.channel_id === id);
    if (!current || current.last_sequence <= current.read_sequence) return;
    try {
      const next = await client.updateReadPosition(account.session_token, id, current.last_sequence, isDirect);
      setCommunity(value => value ? {...value, channel_states: [...value.channel_states.filter(item => item.channel_id !== id), next]} : value);
    } catch {}
  }

  async function send() {
    const body = draft.trim();
    if (!body || !community || sending) return;
    setSending(true);
    setError('');
    try {
      const message = await client.publishMessage(account.session_token, activeID, body, Boolean(direct));
      setCommunity(value => value ? reduceRealtimeFrame(value, {type: 'message.created', cursor: value.cursor, channel_id: activeID, payload: message}) : value);
      setDraft('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the Message.');
    } finally {
      setSending(false);
    }
  }

  if (!community) {
    return <View style={styles.center}>{error ? <><Text style={styles.error}>{error}</Text><TouchableOpacity onPress={onManage}><Text style={{color: palette.accent}}>Manage Instances</Text></TouchableOpacity></> : <ActivityIndicator color={palette.accent} />}</View>;
  }

  if (!activeID || (!channel && !direct)) {
    const textChannels = community.channels.filter(item => item.type === 'text' && !item.archived).sort((a, b) => a.position - b.position);
    return (
      <View style={styles.fill}>
        <View style={[styles.header, {borderBottomColor: palette.border}]}>
          <View style={styles.grow}><Text style={[styles.title, {color: palette.text}]}>{community.community.name}</Text><Text style={status === 'connected' ? styles.connected : {color: palette.muted}}>{status === 'connected' ? 'Connected' : 'Reconnecting…'}</Text></View>
          <TouchableOpacity accessibilityRole="button" onPress={onManage} style={[styles.headerButton, {borderColor: palette.border}]}><Text style={{color: palette.text}}>Instances</Text></TouchableOpacity>
        </View>
        <FlatList
          contentContainerStyle={styles.conversationList}
          data={[
            ...community.direct_messages.map(item => ({id: item.id, name: displayName(item), direct: true, unread: unreadFor(community, item.id)})),
            ...textChannels.map(item => ({id: item.id, name: `# ${item.name}`, direct: false, unread: unreadFor(community, item.id)})),
          ]}
          keyExtractor={item => item.id}
          ListHeaderComponent={<Text style={[styles.section, {color: palette.muted}]}>CONVERSATIONS</Text>}
          ListEmptyComponent={<Text style={{color: palette.muted}}>No text conversations are available.</Text>}
          renderItem={({item}) => <TouchableOpacity onPress={() => openConversation(item.id, item.direct)} style={[styles.conversation, {backgroundColor: palette.field}]}><Text numberOfLines={1} style={[styles.conversationName, {color: palette.text}]}>{item.name}</Text>{item.unread > 0 ? <Text style={styles.badge}>{item.unread}</Text> : null}</TouchableOpacity>}
        />
      </View>
    );
  }

  const title = direct ? `@ ${displayName(direct)}` : `# ${channel?.name}`;
  const typing = community.typing.filter(item => item.channel_id === activeID && item.member_id !== community.member.id && Date.parse(item.expires_at) > Date.now()).map(item => item.member_name);
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <View style={[styles.header, {borderBottomColor: palette.border}]}>
        <TouchableOpacity accessibilityLabel="Back to conversations" onPress={() => setActiveID('')} style={styles.back}><Text style={[styles.backText, {color: palette.accent}]}>‹</Text></TouchableOpacity>
        <View style={styles.grow}><Text numberOfLines={1} style={[styles.title, {color: palette.text}]}>{title}</Text><Text style={status === 'connected' ? styles.connected : {color: palette.muted}}>{status === 'connected' ? 'Live' : 'Reconnecting…'}</Text></View>
      </View>
      <ConversationTimeline account={account} currentMemberID={community.member.id} key={activeID} messages={messages} palette={palette} />
      {typing.length ? <Text style={[styles.typing, {color: palette.muted}]}>{typingText(typing)}</Text> : null}
      {error ? <Text style={[styles.composerError, styles.errorColor]}>{error}</Text> : null}
      <View style={[styles.composer, {borderTopColor: palette.border}]}>
        <TextInput accessibilityLabel="Message" multiline onChangeText={value => { setDraft(value); if (value) realtime.current?.sendTyping(activeID); }} placeholder={`Message ${title}`} placeholderTextColor={palette.placeholder} style={[styles.composerInput, {backgroundColor: palette.field, color: palette.text}]} value={draft} />
        <TouchableOpacity accessibilityLabel="Send Message" disabled={!draft.trim() || sending} onPress={send} style={[styles.send, {backgroundColor: palette.accent}, (!draft.trim() || sending) && styles.disabled]}><Text style={styles.sendText}>{sending ? '…' : '➤'}</Text></TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

export function ConversationTimeline({account, currentMemberID, messages, palette}: {account: Pick<InstanceAccount, 'instance_url' | 'session_token'>; currentMemberID: string; messages: Message[]; palette: Palette}) {
  return <FlatList
    contentContainerStyle={styles.messageList}
    data={[...messages].reverse()}
    inverted
    keyExtractor={item => item.id}
    renderItem={({item}) => <MessageRow instanceURL={account.instance_url} message={item} mine={item.author_id === currentMemberID} palette={palette} token={account.session_token} />}
    ListEmptyComponent={<Text style={{color: palette.muted}}>This is the beginning of the conversation.</Text>}
    maintainVisibleContentPosition={{minIndexForVisible: 0, autoscrollToTopThreshold: 80}}
  />;
}

export function MessageRow({imageLoader, instanceURL, message, mine, palette, token}: {imageLoader?: ImageLoader; instanceURL: string; message: Message; mine: boolean; palette: Palette; token: string}) {
  return <View style={styles.message}><Text style={[styles.author, {color: mine ? palette.accent : palette.text}]}>{mine ? 'You' : message.author_name}</Text>{message.deleted ? <Text style={[styles.messageBody, {color: palette.muted}]}>Message deleted</Text> : <><FormattedBody body={message.body || ''} color={palette.text} />{message.attachments?.map(attachment => <AttachmentView attachment={attachment} imageLoader={imageLoader} instanceURL={instanceURL} key={attachment.id} palette={palette} token={token} />)}</>}<Text style={[styles.time, {color: palette.muted}]}>{new Date(message.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</Text></View>;
}

type ImageLoader = (url: string, token: string) => Promise<string>;

function AttachmentView({attachment, imageLoader, instanceURL, palette, token}: {attachment: NonNullable<Message['attachments']>[number]; imageLoader?: ImageLoader; instanceURL: string; palette: Palette; token: string}) {
  const source = {uri: attachmentURL(instanceURL, attachment.url || `/api/v1/attachments/${attachment.id}`), headers: {Authorization: `Bearer ${token}`}};
  if (attachment.content_type.startsWith('image/')) return <AuthenticatedImage accessibilityLabel={attachment.name} loader={imageLoader} palette={palette} token={token} url={source.uri} />;
  if (attachment.content_type.startsWith('audio/') || attachment.content_type.startsWith('video/')) return <InlineMedia attachment={attachment} palette={palette} source={source} />;
  const icon = attachment.content_type.startsWith('audio/') ? '🎵' : attachment.content_type.startsWith('video/') ? '🎬' : '📄';
  return <View style={[styles.attachment, {backgroundColor: palette.field, borderColor: palette.border}]}><Text style={styles.attachmentIcon}>{icon}</Text><View style={styles.grow}><Text numberOfLines={1} style={[styles.attachmentName, {color: palette.text}]}>{attachment.name}</Text><Text style={{color: palette.muted}}>{fileSize(attachment.size)} · {attachment.content_type || 'File'}</Text></View></View>;
}

function AuthenticatedImage({accessibilityLabel, loader = loadAuthenticatedImage, palette, token, url}: {accessibilityLabel: string; loader?: ImageLoader; palette: Palette; token: string; url: string}) {
  const [dataURL, setDataURL] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let mounted = true;
    setDataURL(''); setFailed(false);
    loader(url, token).then(value => { if (mounted) setDataURL(value); }).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, [loader, token, url]);
  if (failed) return <View style={[styles.imageFallback, {backgroundColor: palette.field, borderColor: palette.border}]}><Text style={styles.attachmentIcon}>🖼️</Text><Text style={{color: palette.muted}}>Image could not be loaded</Text></View>;
  if (!dataURL) return <View accessibilityLabel={`Loading ${accessibilityLabel}`} style={[styles.imagePlaceholder, {backgroundColor: palette.field}]}><ActivityIndicator color={palette.accent} /></View>;
  return <Image accessibilityLabel={accessibilityLabel} resizeMode="contain" source={{uri: dataURL}} style={[styles.image, {backgroundColor: palette.field}]} />;
}

function FormattedBody({body, color}: {body: string; color: string}) {
  const pieces = body.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).filter(Boolean);
  return <Text style={[styles.messageBody, {color}]}>{pieces.map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**')) return <Text key={index} style={styles.bold}>{piece.slice(2, -2)}</Text>;
    if (piece.startsWith('`') && piece.endsWith('`')) return <Text key={index} style={styles.code}>{piece.slice(1, -1)}</Text>;
    if (piece.startsWith('*') && piece.endsWith('*')) return <Text key={index} style={styles.italic}>{piece.slice(1, -1)}</Text>;
    return piece;
  })}</Text>;
}

export async function loadAuthenticatedImage(url: string, token: string, request: typeof fetch = fetch): Promise<string> {
  const response = await request(url, {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}`);
  const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
  return `data:${contentType};base64,${bytesToBase64(new Uint8Array(await response.arrayBuffer()))}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  /* eslint-disable no-bitwise -- Base64 packs three binary bytes into four six-bit indexes. */
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]; const second = bytes[index + 1]; const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 3) << 4) | ((second || 0) >> 4)];
    encoded += index + 1 < bytes.length ? alphabet[((second & 15) << 2) | ((third || 0) >> 6)] : '=';
    encoded += index + 2 < bytes.length ? alphabet[third & 63] : '=';
  }
  /* eslint-enable no-bitwise */
  return encoded;
}

function InlineMedia({attachment, palette, source}: {attachment: NonNullable<Message['attachments']>[number]; palette: Palette; source: {uri: string; headers: {Authorization: string}}}) {
  const [started, setStarted] = useState(false);
  const video = attachment.content_type.startsWith('video/');
  if (started) return <Video controls paused={false} resizeMode="contain" source={source} style={[video ? styles.video : styles.audio, {backgroundColor: palette.field}]} />;
  return <TouchableOpacity accessibilityLabel={`Play ${attachment.name}`} onPress={() => setStarted(true)} style={[styles.attachment, {backgroundColor: palette.field, borderColor: palette.border}]}><Text style={styles.attachmentIcon}>{video ? '▶️' : '🎵'}</Text><View style={styles.grow}><Text numberOfLines={1} style={[styles.attachmentName, {color: palette.text}]}>{attachment.name}</Text><Text style={{color: palette.muted}}>Tap to play · {fileSize(attachment.size)}</Text></View></TouchableOpacity>;
}

function attachmentURL(instanceURL: string, value: string) { return new URL(value, `${instanceURL}/`).toString(); }
function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function displayName(dm: DirectMessage) { return dm.other.display_name || dm.other.username; }
function unreadFor(state: CommunityState, id: string) { return state.channel_states.find(item => item.channel_id === id)?.unread || 0; }
function typingText(names: string[]) { if (names.length > 3) return 'Several people are typing…'; if (names.length === 1) return `${names[0]} is typing…`; return `${names.join(', ')} are typing…`; }

const styles = StyleSheet.create({
  fill: {flex: 1}, grow: {flex: 1}, center: {alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24}, error: {color: '#ed4245', fontSize: 15, textAlign: 'center'}, errorColor: {color: '#ed4245'}, connected: {color: '#3ba55d'},
  header: {alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 66, paddingHorizontal: 16}, title: {fontSize: 20, fontWeight: '800'}, headerButton: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8},
  conversationList: {gap: 8, padding: 16}, section: {fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4}, conversation: {alignItems: 'center', borderRadius: 10, flexDirection: 'row', minHeight: 54, paddingHorizontal: 16}, conversationName: {flex: 1, fontSize: 16, fontWeight: '600'}, badge: {backgroundColor: '#ed4245', borderRadius: 12, color: '#fff', fontSize: 12, fontWeight: '800', minWidth: 24, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, textAlign: 'center'},
  back: {marginRight: 6, padding: 6}, backText: {fontSize: 38, lineHeight: 38}, messageList: {paddingHorizontal: 14, paddingVertical: 10}, message: {paddingVertical: 7, width: '100%'}, author: {fontSize: 13, fontWeight: '800', marginBottom: 2}, messageBody: {fontSize: 16, lineHeight: 22}, bold: {fontWeight: '800'}, italic: {fontStyle: 'italic'}, code: {fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier', fontSize: 15}, time: {fontSize: 11, marginTop: 2}, image: {borderRadius: 8, height: 240, marginTop: 8, maxWidth: 420, width: '100%'}, imagePlaceholder: {alignItems: 'center', borderRadius: 8, height: 160, justifyContent: 'center', marginTop: 8, maxWidth: 420, width: '100%'}, imageFallback: {alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 6, height: 120, justifyContent: 'center', marginTop: 8, maxWidth: 420, width: '100%'}, video: {borderRadius: 8, height: 240, marginTop: 8, maxWidth: 420, width: '100%'}, audio: {borderRadius: 8, height: 64, marginTop: 8, maxWidth: 420, width: '100%'}, attachment: {alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 8, maxWidth: 420, padding: 10, width: '100%'}, attachmentIcon: {fontSize: 26}, attachmentName: {fontSize: 14, fontWeight: '700'}, typing: {fontSize: 12, minHeight: 20, paddingHorizontal: 14}, composerError: {fontSize: 12, paddingHorizontal: 14, paddingBottom: 4},
  composer: {alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, padding: 10}, composerInput: {borderRadius: 20, flex: 1, fontSize: 16, maxHeight: 120, minHeight: 44, paddingHorizontal: 16, paddingVertical: 11}, send: {alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44}, sendText: {color: '#fff', fontSize: 20, fontWeight: '800'}, disabled: {opacity: 0.5},
});
