import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';

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
      <FlatList
        contentContainerStyle={styles.messageList}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({item}) => <MessageRow message={item} mine={item.author_id === community.member.id} palette={palette} />}
        ListEmptyComponent={<Text style={{color: palette.muted}}>This is the beginning of the conversation.</Text>}
      />
      {typing.length ? <Text style={[styles.typing, {color: palette.muted}]}>{typingText(typing)}</Text> : null}
      {error ? <Text style={[styles.composerError, styles.errorColor]}>{error}</Text> : null}
      <View style={[styles.composer, {borderTopColor: palette.border}]}>
        <TextInput accessibilityLabel="Message" multiline onChangeText={value => { setDraft(value); if (value) realtime.current?.sendTyping(activeID); }} placeholder={`Message ${title}`} placeholderTextColor={palette.placeholder} style={[styles.composerInput, {backgroundColor: palette.field, color: palette.text}]} value={draft} />
        <TouchableOpacity accessibilityLabel="Send Message" disabled={!draft.trim() || sending} onPress={send} style={[styles.send, {backgroundColor: palette.accent}, (!draft.trim() || sending) && styles.disabled]}><Text style={styles.sendText}>{sending ? '…' : '➤'}</Text></TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageRow({message, mine, palette}: {message: Message; mine: boolean; palette: Palette}) {
  return <View style={[styles.message, mine && styles.mine]}><Text style={[styles.author, {color: mine ? palette.accent : palette.text}]}>{mine ? 'You' : message.author_name}</Text><Text style={[styles.messageBody, {color: message.deleted ? palette.muted : palette.text}]}>{message.deleted ? 'Message deleted' : message.body || attachmentSummary(message)}</Text><Text style={[styles.time, {color: palette.muted}]}>{new Date(message.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</Text></View>;
}

function attachmentSummary(message: Message) { return message.attachments?.length ? `📎 ${message.attachments.map(item => item.name).join(', ')}` : ''; }
function displayName(dm: DirectMessage) { return dm.other.display_name || dm.other.username; }
function unreadFor(state: CommunityState, id: string) { return state.channel_states.find(item => item.channel_id === id)?.unread || 0; }
function typingText(names: string[]) { if (names.length > 3) return 'Several people are typing…'; if (names.length === 1) return `${names[0]} is typing…`; return `${names.join(', ')} are typing…`; }

const styles = StyleSheet.create({
  fill: {flex: 1}, grow: {flex: 1}, center: {alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24}, error: {color: '#ed4245', fontSize: 15, textAlign: 'center'}, errorColor: {color: '#ed4245'}, connected: {color: '#3ba55d'},
  header: {alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 66, paddingHorizontal: 16}, title: {fontSize: 20, fontWeight: '800'}, headerButton: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8},
  conversationList: {gap: 8, padding: 16}, section: {fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4}, conversation: {alignItems: 'center', borderRadius: 10, flexDirection: 'row', minHeight: 54, paddingHorizontal: 16}, conversationName: {flex: 1, fontSize: 16, fontWeight: '600'}, badge: {backgroundColor: '#ed4245', borderRadius: 12, color: '#fff', fontSize: 12, fontWeight: '800', minWidth: 24, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, textAlign: 'center'},
  back: {marginRight: 10, padding: 6}, backText: {fontSize: 38, lineHeight: 38}, messageList: {flexGrow: 1, gap: 14, justifyContent: 'flex-end', padding: 16}, message: {alignSelf: 'flex-start', maxWidth: '88%'}, mine: {alignSelf: 'flex-end'}, author: {fontSize: 13, fontWeight: '800', marginBottom: 3}, messageBody: {fontSize: 16, lineHeight: 22}, time: {fontSize: 11, marginTop: 3}, typing: {fontSize: 12, minHeight: 20, paddingHorizontal: 16}, composerError: {fontSize: 12, paddingHorizontal: 16, paddingBottom: 4},
  composer: {alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, padding: 10}, composerInput: {borderRadius: 20, flex: 1, fontSize: 16, maxHeight: 120, minHeight: 44, paddingHorizontal: 16, paddingVertical: 11}, send: {alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44}, sendText: {color: '#fff', fontSize: 20, fontWeight: '800'}, disabled: {opacity: 0.5},
});
