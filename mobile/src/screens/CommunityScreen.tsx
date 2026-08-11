import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, StyleSheet,
  ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {errorCodes, isErrorWithCode, pick, types, type DocumentPickerResponse} from '@react-native-documents/picker';
import Video from 'react-native-video';

import {AllChatClient} from '../client/AllChatClient';
import type {LinkPreview, Member, ModerationAction, Report} from '../client/AllChatClient';
import type {DirectMessage, Message, SearchResult} from '../client/bootstrap';
import {KeychainConversationCache} from '../cache/ConversationCache';
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
  const [selectedFiles, setSelectedFiles] = useState<DocumentPickerResponse[]>([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [replying, setReplying] = useState<Message>();
  const [editing, setEditing] = useState<Message>();
  const [actionMessage, setActionMessage] = useState<Message>();
  const [panel, setPanel] = useState<'pins' | 'search' | ''>('');
  const [panelMessages, setPanelMessages] = useState<Message[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [panelBusy, setPanelBusy] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<Member>();
  const [moderationOpen, setModerationOpen] = useState(false);
  const realtime = useRef<RealtimeClient | null>(null);
  const client = useMemo(() => new AllChatClient(account.instance_url), [account.instance_url]);
  const cache = useMemo(() => new KeychainConversationCache(), []);

  useEffect(() => {
    let mounted = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function synchronize() {
      try {
        const bootstrap = await client.bootstrap(account.session_token);
        if (!mounted) return;
        setCommunity(communityStateFromBootstrap(bootstrap));
        setError('');
        if (retry) clearTimeout(retry);
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
        if (!mounted) return;
        const cached = await cache.load(account.instance_url, account.member.id).catch(() => undefined);
        if (cached) setCommunity(current => current || communityStateFromBootstrap(cached));
        setError(cached ? 'Showing cached Messages while reconnecting…' : caught instanceof Error ? caught.message : 'Could not synchronize the Instance.');
        retry = setTimeout(() => synchronize().catch(() => {}), 5000);
      }
    }
    synchronize().catch(() => {});
    return () => { mounted = false; if (retry) clearTimeout(retry); realtime.current?.stop(); realtime.current = null; };
  }, [account.instance_url, account.member.id, account.session_token, cache, client]);

  useEffect(() => {
    if (!community) return;
    const timer = setTimeout(() => cache.save(account.instance_url, account.member.id, community).catch(() => {}), 1000);
    return () => clearTimeout(timer);
  }, [account.instance_url, account.member.id, cache, community]);

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
    if ((!body && !selectedFiles.length) || !community || sending || direct?.blocked_by_me || direct?.blocked_me) return;
    setSending(true);
    setError('');
    try {
      const attachmentIDs: string[] = [];
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        setUploadStatus(`Uploading ${index + 1} of ${selectedFiles.length}…`);
        const attachment = await client.uploadAttachment(account.session_token, {uri: file.uri, name: file.name || `attachment-${index + 1}`, type: file.type || 'application/octet-stream', size: file.size});
        attachmentIDs.push(attachment.id);
      }
      const message = editing
        ? await client.editMessage(account.session_token, editing.id, body)
        : await client.publishMessage(account.session_token, activeID, body, Boolean(direct), attachmentIDs, replying?.id);
      setCommunity(value => value ? reduceRealtimeFrame(value, {type: editing ? 'message.edited' : 'message.created', cursor: value.cursor, channel_id: activeID, payload: message}) : value);
      setDraft('');
      setSelectedFiles([]);
      setReplying(undefined);
      setEditing(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the Message.');
    } finally {
      setSending(false);
      setUploadStatus('');
    }
  }

  async function performMessageAction(action: 'reply' | 'edit' | 'delete' | 'pin', message: Message) {
    setActionMessage(undefined); setError('');
    if (action === 'reply') { setReplying(message); setEditing(undefined); return; }
    if (action === 'edit') { setEditing(message); setReplying(undefined); setDraft(message.body || ''); return; }
    try {
      if (action === 'delete') {
        await client.deleteMessage(account.session_token, message.id);
        setCommunity(value => value ? reduceRealtimeFrame(value, {type: 'message.deleted', cursor: value.cursor, channel_id: activeID, payload: {...message, deleted: true}}) : value);
      } else {
        await client.setPinned(account.session_token, message.id, !message.pinned);
        setCommunity(value => value ? reduceRealtimeFrame(value, {type: 'pin.updated', cursor: value.cursor, channel_id: activeID, payload: {message_id: message.id, pinned: !message.pinned}}) : value);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Message action failed.'); }
  }

  async function toggleReaction(message: Message, emoji: string) {
    const active = !message.reactions?.find(item => item.emoji === emoji)?.me;
    try {
      await client.setReaction(account.session_token, message.id, emoji, active);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update the reaction.'); }
  }

  async function openPins() {
    setPanel('pins'); setPanelBusy(true); setPanelMessages([]); setError('');
    try { setPanelMessages(await client.pinnedMessages(account.session_token, activeID)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load pinned Messages.'); }
    finally { setPanelBusy(false); }
  }

  async function search() {
    if (!searchQuery.trim()) return;
    setPanelBusy(true); setError('');
    try { setSearchResults((await client.searchMessages(account.session_token, searchQuery.trim())).results); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not search Messages.'); }
    finally { setPanelBusy(false); }
  }

  async function startDM(member: Member) {
    setPanelBusy(true); setError('');
    try {
      const item = await client.openDirectMessage(account.session_token, member.id);
      setCommunity(value => value ? {...value, direct_messages: [item, ...value.direct_messages.filter(dm => dm.id !== item.id)]} : value);
      setMembersOpen(false); setProfileMember(undefined); await openConversation(item.id, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not open the Direct Message.'); }
    finally { setPanelBusy(false); }
  }

  async function changePresence(mode: 'available' | 'dnd') {
    try { await client.setPresenceMode(account.session_token, mode); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update your presence.'); }
  }

  async function toggleBlock() {
    if (!direct) return;
    try {
      await client.setBlock(account.session_token, direct.other.id, !direct.blocked_by_me);
      setCommunity(value => value ? {...value, direct_messages: value.direct_messages.map(item => item.id === direct.id ? {...item, blocked_by_me: !item.blocked_by_me} : item)} : value);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update the block.'); }
  }

  async function chooseAttachments() {
    setError('');
    try {
      const chosen = await pick({allowMultiSelection: true, mode: 'import'});
      setSelectedFiles(current => [...current, ...chosen].filter((file, index, files) => files.findIndex(item => item.uri === file.uri) === index).slice(0, 10));
    } catch (caught) {
      if (!isErrorWithCode(caught) || caught.code !== errorCodes.OPERATION_CANCELED) setError(caught instanceof Error ? caught.message : 'Could not open the file picker.');
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
          <TouchableOpacity accessibilityLabel="Community Members" onPress={() => setMembersOpen(true)} style={styles.iconButton}><Text style={[styles.headerIcon, {color: palette.text}]}>♟</Text></TouchableOpacity>
          {community.member.owner ? <TouchableOpacity accessibilityLabel="Moderation Reports" onPress={() => setModerationOpen(true)} style={styles.iconButton}><Text style={[styles.headerIcon, {color: palette.text}]}>♜</Text></TouchableOpacity> : null}
          <TouchableOpacity accessibilityLabel="Toggle Do Not Disturb" onPress={() => changePresence(community.presence[community.member.id] === 'dnd' ? 'available' : 'dnd')} style={styles.iconButton}><Text style={[styles.presenceButton, community.presence[community.member.id] === 'dnd' ? styles.presenceDND : styles.presenceOnline]}>●</Text></TouchableOpacity>
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
        <MembersPanel busy={panelBusy} currentMemberID={community.member.id} members={community.members} onClose={() => setMembersOpen(false)} onOpenProfile={member => { setMembersOpen(false); setProfileMember(member); }} open={membersOpen} palette={palette} presence={community.presence} />
        <MemberProfile client={client} instanceURL={account.instance_url} member={profileMember} moderator={community.member.owner} onClose={() => setProfileMember(undefined)} onProfileUpdated={updated => { setProfileMember(updated); setCommunity(value => value ? {...value, member: value.member.id === updated.id ? updated : value.member, members: value.members.map(item => item.id === updated.id ? updated : item)} : value); }} onStartDM={startDM} palette={palette} self={profileMember?.id === community.member.id} token={account.session_token} />
        <ModerationPanel client={client} onClose={() => setModerationOpen(false)} open={moderationOpen} palette={palette} token={account.session_token} />
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
        {direct ? <TouchableOpacity accessibilityLabel={direct.blocked_by_me ? 'Unblock Member' : 'Block Member'} onPress={toggleBlock} style={styles.iconButton}><Text style={[styles.headerIcon, direct.blocked_by_me ? styles.dangerText : {color: palette.text}]}>⊘</Text></TouchableOpacity> : null}
        {!direct ? <TouchableOpacity accessibilityLabel="Pinned Messages" onPress={openPins} style={styles.iconButton}><Text style={[styles.headerIcon, {color: palette.text}]}>◆</Text></TouchableOpacity> : null}
        <TouchableOpacity accessibilityLabel="Search Messages" onPress={() => setPanel('search')} style={styles.iconButton}><Text style={[styles.headerIcon, {color: palette.text}]}>⌕</Text></TouchableOpacity>
      </View>
      <ConversationTimeline account={account} currentMemberID={community.member.id} key={activeID} messages={messages} onMessageAction={setActionMessage} onReaction={toggleReaction} palette={palette} />
      {typing.length ? <Text style={[styles.typing, {color: palette.muted}]}>{typingText(typing)}</Text> : null}
      {direct && (direct.blocked_by_me || direct.blocked_me) ? <Text style={[styles.blockedNotice, {color: palette.muted}]}>Messages are disabled while either Member has blocked the other.</Text> : null}
      {error ? <Text style={[styles.composerError, styles.errorColor]}>{error}</Text> : null}
      {selectedFiles.length ? <ScrollView contentContainerStyle={styles.selectedFiles} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>{selectedFiles.map(file => <SelectedFile file={file} key={file.uri} onRemove={() => setSelectedFiles(current => current.filter(item => item.uri !== file.uri))} palette={palette} />)}</ScrollView> : null}
      {replying || editing ? <View style={[styles.contextBanner, {backgroundColor: palette.field}]}><Text numberOfLines={1} style={[styles.grow, {color: palette.text}]}>{editing ? 'Editing your Message' : `Replying to ${replying?.author_name}`}</Text><TouchableOpacity accessibilityLabel="Cancel Message action" onPress={() => { setReplying(undefined); setEditing(undefined); if (editing) setDraft(''); }}><Text style={styles.contextClose}>×</Text></TouchableOpacity></View> : null}
      <View style={[styles.composer, {borderTopColor: palette.border}]}>
        <TouchableOpacity accessibilityLabel="Add Attachments" disabled={sending || direct?.blocked_by_me || direct?.blocked_me} onPress={chooseAttachments} style={[styles.attach, {backgroundColor: palette.field}, (direct?.blocked_by_me || direct?.blocked_me) && styles.disabled]}><Text style={[styles.attachText, {color: palette.text}]}>+</Text></TouchableOpacity>
        <TextInput accessibilityLabel="Message" editable={!direct?.blocked_by_me && !direct?.blocked_me} multiline onChangeText={value => { setDraft(value); if (value) realtime.current?.sendTyping(activeID); }} placeholder={`Message ${title}`} placeholderTextColor={palette.placeholder} style={[styles.composerInput, {backgroundColor: palette.field, color: palette.text}]} value={draft} />
        <TouchableOpacity accessibilityLabel="Send Message" disabled={(!draft.trim() && !selectedFiles.length) || sending || direct?.blocked_by_me || direct?.blocked_me} onPress={send} style={[styles.send, {backgroundColor: palette.accent}, ((!draft.trim() && !selectedFiles.length) || sending || direct?.blocked_by_me || direct?.blocked_me) && styles.disabled]}><Text style={styles.sendText}>{sending ? '…' : '➤'}</Text></TouchableOpacity>
      </View>
      {uploadStatus ? <Text style={[styles.uploadStatus, {color: palette.muted}]}>{uploadStatus}</Text> : null}
      <MessageActions message={actionMessage} mine={Boolean(actionMessage && actionMessage.author_id === community.member.id)} onAction={performMessageAction} onClose={() => setActionMessage(undefined)} onReaction={toggleReaction} palette={palette} />
      <ConversationPanel busy={panelBusy} messages={panelMessages} mode={panel} onClose={() => setPanel('')} onSearch={search} palette={palette} query={searchQuery} results={searchResults} setQuery={setSearchQuery} />
    </KeyboardAvoidingView>
  );
}

function SelectedFile({file, onRemove, palette}: {file: DocumentPickerResponse; onRemove(): void; palette: Palette}) {
  const image = file.type?.startsWith('image/');
  const icon = file.type?.startsWith('audio/') ? '🎵' : file.type?.startsWith('video/') ? '🎬' : '📄';
  return <View style={[styles.selectedFile, {backgroundColor: palette.field, borderColor: palette.border}]}>{image ? <Image resizeMode="cover" source={{uri: file.uri}} style={styles.selectedThumbnail} /> : <Text style={styles.selectedIcon}>{icon}</Text>}<Text numberOfLines={1} style={[styles.selectedName, {color: palette.text}]}>{file.name || 'Attachment'}</Text><TouchableOpacity accessibilityLabel={`Remove ${file.name || 'Attachment'}`} onPress={onRemove} style={styles.selectedRemove}><Text style={styles.selectedRemoveText}>×</Text></TouchableOpacity></View>;
}

export function ConversationTimeline({account, currentMemberID, messages, onMessageAction, onReaction, palette}: {account: Pick<InstanceAccount, 'instance_url' | 'session_token'>; currentMemberID: string; messages: Message[]; onMessageAction?(message: Message): void; onReaction?(message: Message, emoji: string): void; palette: Palette}) {
  return <FlatList
    contentContainerStyle={styles.messageList}
    data={[...messages].reverse()}
    inverted
    keyExtractor={item => item.id}
    renderItem={({item}) => <MessageRow instanceURL={account.instance_url} message={item} mine={item.author_id === currentMemberID} onLongPress={onMessageAction} onReaction={onReaction} palette={palette} token={account.session_token} />}
    ListEmptyComponent={<Text style={{color: palette.muted}}>This is the beginning of the conversation.</Text>}
    maintainVisibleContentPosition={{minIndexForVisible: 0, autoscrollToTopThreshold: 80}}
  />;
}

export function MessageRow({imageLoader, instanceURL, message, mine, onLongPress, onReaction, palette, token}: {imageLoader?: ImageLoader; instanceURL: string; message: Message; mine: boolean; onLongPress?(message: Message): void; onReaction?(message: Message, emoji: string): void; palette: Palette; token: string}) {
  return <TouchableOpacity activeOpacity={onLongPress ? 0.72 : 1} delayLongPress={350} disabled={!onLongPress} onLongPress={() => onLongPress?.(message)} style={styles.message}>
    {message.reply ? <View style={[styles.replyPreview, {borderLeftColor: palette.border}]}><Text numberOfLines={1} style={{color: palette.muted}}>↳ {message.reply.author_name}: {message.reply.deleted ? 'deleted Message' : message.reply.body}</Text></View> : null}
    <View style={styles.authorLine}><Text style={[styles.author, {color: mine ? palette.accent : palette.text}]}>{mine ? 'You' : message.author_name}</Text>{message.pinned ? <Text style={{color: palette.muted}}> ◆ Pinned</Text> : null}</View>
    {message.deleted ? <Text style={[styles.messageBody, {color: palette.muted}]}>Message deleted</Text> : <><FormattedBody body={message.body || ''} color={palette.text} /><MessageLinkPreview body={message.body || ''} instanceURL={instanceURL} palette={palette} token={token} />{message.attachments?.map(attachment => <AttachmentView attachment={attachment} imageLoader={imageLoader} instanceURL={instanceURL} key={attachment.id} palette={palette} token={token} />)}{message.reactions?.length ? <View style={styles.reactions}>{message.reactions.map(reaction => <TouchableOpacity accessibilityLabel={`${reaction.emoji} reaction, ${reaction.count}`} disabled={!onReaction} key={reaction.emoji} onPress={() => onReaction?.(message, reaction.emoji)} style={[styles.reaction, {backgroundColor: reaction.me ? palette.accent : palette.field, borderColor: reaction.me ? palette.accent : palette.border}]}><Text style={reaction.me ? styles.whiteText : {color: palette.text}}>{reaction.emoji} {reaction.count}</Text></TouchableOpacity>)}</View> : null}</>}
    <Text style={[styles.time, {color: palette.muted}]}>{new Date(message.created_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}{message.edited_at ? ' · edited' : ''}</Text>
  </TouchableOpacity>;
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let mounted = true;
    setDataURL(''); setFailed(false);
    loader(url, token).then(value => { if (mounted) setDataURL(value); }).catch(() => { if (mounted) setFailed(true); });
    return () => { mounted = false; };
  }, [loader, token, url]);
  if (failed) return <View style={[styles.imageFallback, {backgroundColor: palette.field, borderColor: palette.border}]}><Text style={styles.attachmentIcon}>🖼️</Text><Text style={{color: palette.muted}}>Image could not be loaded</Text></View>;
  if (!dataURL) return <View accessibilityLabel={`Loading ${accessibilityLabel}`} style={[styles.imagePlaceholder, {backgroundColor: palette.field}]}><ActivityIndicator color={palette.accent} /></View>;
  const source = {uri: dataURL};
  return <><TouchableOpacity accessibilityLabel={`Open ${accessibilityLabel}`} accessibilityRole="imagebutton" activeOpacity={0.85} onPress={() => setOpen(true)}><Image accessibilityLabel={accessibilityLabel} resizeMode="contain" source={source} style={[styles.image, {backgroundColor: palette.field}]} /></TouchableOpacity>{open ? <Modal animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent transparent visible><View style={styles.viewer}><TouchableOpacity accessibilityLabel="Close image" accessibilityRole="button" onPress={() => setOpen(false)} style={styles.viewerClose}><Text style={styles.viewerCloseText}>×</Text></TouchableOpacity><Image accessibilityLabel={accessibilityLabel} resizeMode="contain" source={source} style={styles.viewerImage} /></View></Modal> : null}</>;
}

function FormattedBody({body, color}: {body: string; color: string}) {
  const pieces = body.split(/(https?:\/\/[^\s]+|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).filter(Boolean);
  return <Text style={[styles.messageBody, {color}]}>{pieces.map((piece, index) => {
    if (/^https?:\/\//.test(piece)) return <Text accessibilityRole="link" key={index} onPress={() => Linking.openURL(piece)} style={styles.link}>{piece}</Text>;
    if (piece.startsWith('**') && piece.endsWith('**')) return <Text key={index} style={styles.bold}>{piece.slice(2, -2)}</Text>;
    if (piece.startsWith('`') && piece.endsWith('`')) return <Text key={index} style={styles.code}>{piece.slice(1, -1)}</Text>;
    if (piece.startsWith('*') && piece.endsWith('*')) return <Text key={index} style={styles.italic}>{piece.slice(1, -1)}</Text>;
    return piece;
  })}</Text>;
}

function MessageLinkPreview({body, instanceURL, palette, token}: {body: string; instanceURL: string; palette: Palette; token: string}) {
  const target = body.match(/https?:\/\/[^\s]+/)?.[0] || '';
  const [preview, setPreview] = useState<LinkPreview>();
  useEffect(() => {
    let mounted = true; setPreview(undefined);
    if (target) new AllChatClient(instanceURL).linkPreview(token, target).then(value => { if (mounted) setPreview(value); }).catch(() => {});
    return () => { mounted = false; };
  }, [instanceURL, target, token]);
  if (!preview) return null;
  return <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL(preview.url)} style={[styles.linkCard, {backgroundColor: palette.field, borderColor: palette.border}]}><View style={styles.linkContent}><Text numberOfLines={1} style={{color: palette.muted}}>{preview.site_name || hostname(preview.url)}</Text><Text numberOfLines={2} style={[styles.linkTitle, {color: palette.accent}]}>{preview.title || preview.url}</Text>{preview.description ? <Text numberOfLines={3} style={{color: palette.text}}>{preview.description}</Text> : null}</View>{preview.image_url ? <PreviewImage imageURL={preview.image_url} instanceURL={instanceURL} token={token} /> : null}</TouchableOpacity>;
}

function PreviewImage({imageURL, instanceURL, token}: {imageURL: string; instanceURL: string; token: string}) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let mounted = true;
    const proxy = `${instanceURL}/api/v1/link-preview/image?url=${encodeURIComponent(imageURL)}`;
    loadAuthenticatedImage(proxy, token).then(value => { if (mounted) setSource(value); }).catch(() => {});
    return () => { mounted = false; };
  }, [imageURL, instanceURL, token]);
  return source ? <Image source={{uri: source}} style={styles.linkImage} /> : null;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮'];

function MessageActions({message, mine, onAction, onClose, onReaction, palette}: {message?: Message; mine: boolean; onAction(action: 'reply' | 'edit' | 'delete' | 'pin', message: Message): void; onClose(): void; onReaction(message: Message, emoji: string): void; palette: Palette}) {
  if (!message) return null;
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible><TouchableOpacity activeOpacity={1} onPress={onClose} style={styles.sheetBackdrop}><View style={[styles.sheet, {backgroundColor: palette.background}]}><Text style={[styles.sheetTitle, {color: palette.text}]}>Message actions</Text><View style={styles.quickReactions}>{QUICK_REACTIONS.map(emoji => <TouchableOpacity accessibilityLabel={`React with ${emoji}`} key={emoji} onPress={() => { onReaction(message, emoji); onClose(); }} style={[styles.quickReaction, {backgroundColor: palette.field}]}><Text style={styles.quickReactionText}>{emoji}</Text></TouchableOpacity>)}</View><ActionButton label="Reply" onPress={() => onAction('reply', message)} palette={palette} /><ActionButton label={message.pinned ? 'Unpin Message' : 'Pin Message'} onPress={() => onAction('pin', message)} palette={palette} />{mine && !message.deleted ? <ActionButton label="Edit Message" onPress={() => onAction('edit', message)} palette={palette} /> : null}{mine && !message.deleted ? <ActionButton danger label="Delete Message" onPress={() => onAction('delete', message)} palette={palette} /> : null}</View></TouchableOpacity></Modal>;
}

function ActionButton({danger, label, onPress, palette}: {danger?: boolean; label: string; onPress(): void; palette: Palette}) {
  return <TouchableOpacity onPress={onPress} style={[styles.actionButton, {borderTopColor: palette.border}]}><Text style={[styles.actionText, danger ? styles.dangerText : {color: palette.text}]}>{label}</Text></TouchableOpacity>;
}

function ConversationPanel({busy, messages, mode, onClose, onSearch, palette, query, results, setQuery}: {busy: boolean; messages: Message[]; mode: 'pins' | 'search' | ''; onClose(): void; onSearch(): void; palette: Palette; query: string; results: SearchResult[]; setQuery(value: string): void}) {
  if (!mode) return null;
  const items = mode === 'pins' ? messages.map(message => ({id: message.id, author: message.author_name, body: message.body || 'Attachment'})) : results.map(result => ({id: result.message.id, author: `${result.message.author_name} in #${result.channel_name}`, body: result.snippet}));
  return <Modal animationType="slide" onRequestClose={onClose} visible><View style={[styles.panel, {backgroundColor: palette.background}]}><View style={[styles.header, {borderBottomColor: palette.border}]}><Text style={[styles.title, {color: palette.text}]}>{mode === 'pins' ? 'Pinned Messages' : 'Search'}</Text><View style={styles.grow} /><TouchableOpacity accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}><Text style={[styles.contextClose, {color: palette.text}]}>×</Text></TouchableOpacity></View>{mode === 'search' ? <View style={styles.searchBar}><TextInput autoFocus onChangeText={setQuery} onSubmitEditing={onSearch} placeholder="Search Messages" placeholderTextColor={palette.placeholder} returnKeyType="search" style={[styles.searchInput, {backgroundColor: palette.field, color: palette.text}]} value={query} /><TouchableOpacity onPress={onSearch} style={[styles.searchButton, {backgroundColor: palette.accent}]}><Text style={styles.searchButtonText}>Search</Text></TouchableOpacity></View> : null}{busy ? <ActivityIndicator color={palette.accent} style={styles.panelBusy} /> : <FlatList contentContainerStyle={styles.panelList} data={items} keyExtractor={item => item.id} ListEmptyComponent={<Text style={{color: palette.muted}}>{mode === 'pins' ? 'No pinned Messages.' : query ? 'No results.' : 'Enter a search query.'}</Text>} renderItem={({item}) => <View style={[styles.panelItem, {backgroundColor: palette.field}]}><Text style={[styles.author, {color: palette.text}]}>{item.author}</Text><Text numberOfLines={4} style={{color: palette.text}}>{item.body}</Text></View>} />}</View></Modal>;
}

function MembersPanel({busy, currentMemberID, members, onClose, onOpenProfile, open, palette, presence}: {busy: boolean; currentMemberID: string; members: Member[]; onClose(): void; onOpenProfile(member: Member): void; open: boolean; palette: Palette; presence: CommunityState['presence']}) {
  const sorted = [...members].sort((left, right) => presenceRank(presence[left.id]) - presenceRank(presence[right.id]) || memberName(left).localeCompare(memberName(right)));
  return <Modal animationType="slide" onRequestClose={onClose} visible={open}>
    <View style={[styles.panel, {backgroundColor: palette.background}]}>
      <View style={[styles.header, {borderBottomColor: palette.border}]}>
        <Text style={[styles.title, {color: palette.text}]}>Members</Text><View style={styles.grow} />
        <TouchableOpacity accessibilityLabel="Close Members" onPress={onClose} style={styles.iconButton}><Text style={[styles.contextClose, {color: palette.text}]}>×</Text></TouchableOpacity>
      </View>
      {busy ? <ActivityIndicator color={palette.accent} /> : <FlatList
        contentContainerStyle={styles.panelList} data={sorted} keyExtractor={member => member.id}
        renderItem={({item}) => <TouchableOpacity onPress={() => onOpenProfile(item)} style={[styles.memberRow, {backgroundColor: palette.field}]}>
          <Text style={[styles.memberAvatar, {backgroundColor: palette.border, color: palette.text}]}>{memberName(item).slice(0, 1).toUpperCase()}</Text>
          <View style={styles.grow}><Text style={[styles.memberName, {color: palette.text}]}>{memberName(item)}{item.id === currentMemberID ? ' (You)' : ''}</Text><Text style={{color: palette.muted}}>@{item.username}{item.owner ? ' · Owner' : ''}</Text></View>
          <Text accessibilityLabel={presence[item.id] || 'offline'} style={[styles.presenceDot, presenceStyle(presence[item.id])]}>●</Text>
        </TouchableOpacity>}
      />}
    </View>
  </Modal>;
}

function MemberProfile({client, instanceURL, member, moderator, onClose, onProfileUpdated, onStartDM, palette, self, token}: {client: AllChatClient; instanceURL: string; member?: Member; moderator: boolean; onClose(): void; onProfileUpdated(member: Member): void; onStartDM(member: Member): void; palette: Palette; self: boolean; token: string}) {
  const [reporting, setReporting] = useState(false); const [reason, setReason] = useState(''); const [status, setStatus] = useState('');
  const [username, setUsername] = useState(''); const [profileDisplayName, setProfileDisplayName] = useState(''); const [saving, setSaving] = useState(false); const [avatarVersion, setAvatarVersion] = useState(0);
  const [moderating, setModerating] = useState(false);
  useEffect(() => { setUsername(member?.username || ''); setProfileDisplayName(member?.display_name || ''); setStatus(''); setReporting(false); }, [member?.display_name, member?.id, member?.username]);
  if (!member) return null;
  async function report() {
    if (!reason.trim()) return;
    try { await client.reportMember(token, member!.id, reason.trim()); setStatus('Report submitted.'); setReporting(false); setReason(''); }
    catch (caught) { setStatus(caught instanceof Error ? caught.message : 'Could not submit the report.'); }
  }
  async function saveProfile() {
    if (!username.trim() || saving) return;
    setSaving(true); setStatus('');
    try { const updated = await client.updateProfile(token, username.trim(), profileDisplayName.trim()); onProfileUpdated(updated); setStatus('Profile updated.'); }
    catch (caught) { setStatus(caught instanceof Error ? caught.message : 'Could not update your profile.'); }
    finally { setSaving(false); }
  }
  async function chooseAvatar() {
    try {
      const [file] = await pick({mode: 'import', type: [types.images]});
      if (!file) return;
      setSaving(true); await client.updateAvatar(token, {uri: file.uri, name: file.name || 'avatar', type: file.type || 'application/octet-stream', size: file.size});
      onProfileUpdated({...member!, avatar_url: `/api/v1/members/${member!.id}/avatar`}); setAvatarVersion(value => value + 1); setStatus('Avatar updated.');
    } catch (caught) {
      if (!isErrorWithCode(caught) || caught.code !== errorCodes.OPERATION_CANCELED) setStatus(caught instanceof Error ? caught.message : 'Could not update your avatar.');
    } finally { setSaving(false); }
  }
  async function removeAvatar() {
    try { setSaving(true); await client.removeAvatar(token); onProfileUpdated({...member!, avatar_url: undefined}); setAvatarVersion(value => value + 1); setStatus('Avatar removed.'); }
    catch (caught) { setStatus(caught instanceof Error ? caught.message : 'Could not remove your avatar.'); }
    finally { setSaving(false); }
  }
  async function moderate(action: ModerationAction) {
    if (reason.trim().length < 3) { setStatus('Provide a reason of at least three characters.'); return; }
    try { setSaving(true); await client.moderateMember(token, member!.id, action, reason.trim(), action === 'timeout' || action === 'suspend' ? 60 : 0); setStatus(`${action} applied.`); setModerating(false); setReason(''); }
    catch (caught) { setStatus(caught instanceof Error ? caught.message : 'Could not apply moderation.'); }
    finally { setSaving(false); }
  }
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible>
    <View style={styles.profileBackdrop}><ScrollView contentContainerStyle={[styles.profileCard, {backgroundColor: palette.background}]} keyboardShouldPersistTaps="handled">
      <ProfileAvatar instanceURL={instanceURL} member={member} palette={palette} token={token} version={avatarVersion} />
      <Text style={[styles.profileName, {color: palette.text}]}>{memberName(member)}</Text><Text style={{color: palette.muted}}>@{member.username}{member.owner ? ' · Owner' : ''}</Text>
      {status ? <Text style={[styles.profileStatus, {color: palette.muted}]}>{status}</Text> : null}
      {self ? <><TextInput accessibilityLabel="Username" autoCapitalize="none" onChangeText={setUsername} placeholder="Username" placeholderTextColor={palette.placeholder} style={[styles.profileInput, {backgroundColor: palette.field, color: palette.text}]} value={username} /><TextInput accessibilityLabel="Display Name" onChangeText={setProfileDisplayName} placeholder="Display Name (optional)" placeholderTextColor={palette.placeholder} style={[styles.profileInput, {backgroundColor: palette.field, color: palette.text}]} value={profileDisplayName} /><TouchableOpacity disabled={saving || !username.trim()} onPress={saveProfile} style={[styles.profilePrimary, {backgroundColor: palette.accent}, saving && styles.disabled]}><Text style={styles.whiteText}>{saving ? 'Saving…' : 'Save profile'}</Text></TouchableOpacity><TouchableOpacity disabled={saving} onPress={chooseAvatar} style={styles.profileAction}><Text style={{color: palette.text}}>Choose avatar</Text></TouchableOpacity>{member.avatar_url ? <TouchableOpacity disabled={saving} onPress={removeAvatar} style={styles.profileAction}><Text style={styles.dangerText}>Remove avatar</Text></TouchableOpacity> : null}</> : moderating ? <><TextInput autoFocus multiline onChangeText={setReason} placeholder="Moderation reason" placeholderTextColor={palette.placeholder} style={[styles.reportInput, {backgroundColor: palette.field, color: palette.text}]} value={reason} /><View style={styles.moderationActions}>{(['warn', 'timeout', 'kick', 'suspend'] as ModerationAction[]).map(action => <TouchableOpacity disabled={saving} key={action} onPress={() => moderate(action)} style={[styles.moderationAction, {backgroundColor: palette.field}]}><Text style={action === 'suspend' ? styles.dangerText : {color: palette.text}}>{action === 'timeout' ? 'Timeout 1h' : action === 'suspend' ? 'Suspend 1h' : action[0].toUpperCase() + action.slice(1)}</Text></TouchableOpacity>)}</View><TouchableOpacity onPress={() => setModerating(false)} style={styles.profileAction}><Text style={{color: palette.text}}>Cancel moderation</Text></TouchableOpacity></> : reporting ? <><TextInput autoFocus multiline onChangeText={setReason} placeholder="What happened?" placeholderTextColor={palette.placeholder} style={[styles.reportInput, {backgroundColor: palette.field, color: palette.text}]} value={reason} /><TouchableOpacity disabled={!reason.trim()} onPress={report} style={[styles.profilePrimary, {backgroundColor: palette.accent}]}><Text style={styles.whiteText}>Submit report</Text></TouchableOpacity></> : <><TouchableOpacity onPress={() => onStartDM(member)} style={[styles.profilePrimary, {backgroundColor: palette.accent}]}><Text style={styles.whiteText}>Message</Text></TouchableOpacity><TouchableOpacity onPress={() => setReporting(true)} style={styles.profileAction}><Text style={styles.dangerText}>Report Member</Text></TouchableOpacity>{moderator && !member.owner ? <TouchableOpacity onPress={() => { setModerating(true); setReason(''); }} style={styles.profileAction}><Text style={styles.dangerText}>Moderate Member</Text></TouchableOpacity> : null}</>}
      <TouchableOpacity onPress={onClose} style={styles.profileAction}><Text style={{color: palette.text}}>Close</Text></TouchableOpacity>
    </ScrollView></View>
  </Modal>;
}

function ProfileAvatar({instanceURL, member, palette, token, version}: {instanceURL: string; member: Member; palette: Palette; token: string; version: number}) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let mounted = true; setSource('');
    if (member.avatar_url) loadAuthenticatedImage(`${attachmentURL(instanceURL, member.avatar_url)}?v=${version}`, token).then(value => { if (mounted) setSource(value); }).catch(() => {});
    return () => { mounted = false; };
  }, [instanceURL, member.avatar_url, token, version]);
  return source ? <Image source={{uri: source}} style={styles.profileAvatarImage} /> : <Text style={[styles.profileAvatar, {backgroundColor: palette.field, color: palette.text}]}>{memberName(member).slice(0, 1).toUpperCase()}</Text>;
}

function ModerationPanel({client, onClose, open, palette, token}: {client: AllChatClient; onClose(): void; open: boolean; palette: Palette; token: string}) {
  const [reports, setReports] = useState<Report[]>([]); const [busy, setBusy] = useState(false); const [status, setStatus] = useState('');
  useEffect(() => {
    if (!open) return;
    setBusy(true); setStatus('');
    client.reports(token).then(setReports).catch(caught => setStatus(caught instanceof Error ? caught.message : 'Could not load reports.')).finally(() => setBusy(false));
  }, [client, open, token]);
  async function resolve(item: Report) {
    try { setBusy(true); const updated = await client.resolveReport(token, item.id, 'Reviewed and resolved from the mobile moderation panel.'); setReports(current => current.map(report => report.id === updated.id ? updated : report)); }
    catch (caught) { setStatus(caught instanceof Error ? caught.message : 'Could not resolve the report.'); }
    finally { setBusy(false); }
  }
  return <Modal animationType="slide" onRequestClose={onClose} visible={open}><View style={[styles.panel, {backgroundColor: palette.background}]}><View style={[styles.header, {borderBottomColor: palette.border}]}><Text style={[styles.title, {color: palette.text}]}>Moderation Reports</Text><View style={styles.grow} /><TouchableOpacity accessibilityLabel="Close Moderation" onPress={onClose} style={styles.iconButton}><Text style={[styles.contextClose, {color: palette.text}]}>×</Text></TouchableOpacity></View>{status ? <Text style={[styles.panelStatus, {color: palette.muted}]}>{status}</Text> : null}{busy && !reports.length ? <ActivityIndicator color={palette.accent} style={styles.panelBusy} /> : <FlatList contentContainerStyle={styles.panelList} data={reports} keyExtractor={item => item.id} ListEmptyComponent={<Text style={{color: palette.muted}}>No reports.</Text>} renderItem={({item}) => <View style={[styles.panelItem, {backgroundColor: palette.field}]}><Text style={[styles.author, {color: palette.text}]}>{item.status === 'open' ? 'Open report' : 'Resolved report'}</Text><Text style={{color: palette.text}}>{item.reason}</Text><Text style={{color: palette.muted}}>{new Date(item.created_at).toLocaleString()}</Text>{item.status === 'open' ? <TouchableOpacity disabled={busy} onPress={() => resolve(item)} style={[styles.resolveButton, {backgroundColor: palette.accent}]}><Text style={styles.whiteText}>Mark resolved</Text></TouchableOpacity> : item.outcome ? <Text style={{color: palette.muted}}>{item.outcome}</Text> : null}</View>} />}</View></Modal>;
}

function memberName(member: Member) { return member.display_name || member.username; }
function presenceRank(value?: string) { return value === 'online' || value === 'mobile' ? 0 : value === 'dnd' ? 1 : value === 'idle' ? 2 : 3; }
function presenceStyle(value?: string) { return value === 'dnd' ? styles.presenceDND : value === 'idle' ? styles.presenceIdle : value === 'online' || value === 'mobile' ? styles.presenceOnline : styles.presenceOffline; }

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
function hostname(value: string) { try { return new URL(value).hostname; } catch { return value; } }
function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function displayName(dm: DirectMessage) { return dm.other.display_name || dm.other.username; }
function unreadFor(state: CommunityState, id: string) { return state.channel_states.find(item => item.channel_id === id)?.unread || 0; }
function typingText(names: string[]) { if (names.length > 3) return 'Several people are typing…'; if (names.length === 1) return `${names[0]} is typing…`; return `${names.join(', ')} are typing…`; }

const styles = StyleSheet.create({
  fill: {flex: 1}, grow: {flex: 1}, center: {alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24}, error: {color: '#ed4245', fontSize: 15, textAlign: 'center'}, errorColor: {color: '#ed4245'}, connected: {color: '#3ba55d'},
  header: {alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 66, paddingHorizontal: 16}, title: {fontSize: 20, fontWeight: '800'}, headerButton: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8},
  iconButton: {alignItems: 'center', height: 44, justifyContent: 'center', width: 44}, headerIcon: {fontSize: 25},
  presenceButton: {fontSize: 20}, presenceDot: {fontSize: 18}, presenceOnline: {color: '#3ba55d'}, presenceDND: {color: '#ed4245'}, presenceIdle: {color: '#faa61a'}, presenceOffline: {color: '#747f8d'},
  conversationList: {gap: 8, padding: 16}, section: {fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4}, conversation: {alignItems: 'center', borderRadius: 10, flexDirection: 'row', minHeight: 54, paddingHorizontal: 16}, conversationName: {flex: 1, fontSize: 16, fontWeight: '600'}, badge: {backgroundColor: '#ed4245', borderRadius: 12, color: '#fff', fontSize: 12, fontWeight: '800', minWidth: 24, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, textAlign: 'center'},
  back: {marginRight: 6, padding: 6}, backText: {fontSize: 38, lineHeight: 38}, messageList: {paddingHorizontal: 14, paddingVertical: 10}, message: {paddingVertical: 7, width: '100%'}, authorLine: {alignItems: 'center', flexDirection: 'row'}, author: {fontSize: 13, fontWeight: '800', marginBottom: 2}, messageBody: {fontSize: 16, lineHeight: 22}, bold: {fontWeight: '800'}, italic: {fontStyle: 'italic'}, code: {fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier', fontSize: 15}, link: {color: '#00a8fc', textDecorationLine: 'underline'}, replyPreview: {borderLeftWidth: 2, marginBottom: 4, paddingLeft: 8}, reactions: {flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7}, reaction: {borderRadius: 12, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4}, time: {fontSize: 11, marginTop: 2}, image: {borderRadius: 8, height: 240, marginTop: 8, maxWidth: 420, width: '100%'}, imagePlaceholder: {alignItems: 'center', borderRadius: 8, height: 160, justifyContent: 'center', marginTop: 8, maxWidth: 420, width: '100%'}, imageFallback: {alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 6, height: 120, justifyContent: 'center', marginTop: 8, maxWidth: 420, width: '100%'}, viewer: {backgroundColor: 'rgba(0,0,0,0.96)', flex: 1, justifyContent: 'center'}, viewerImage: {height: '100%', width: '100%'}, viewerClose: {alignItems: 'center', backgroundColor: 'rgba(32,32,36,0.85)', borderRadius: 24, height: 48, justifyContent: 'center', position: 'absolute', right: 16, top: 42, width: 48, zIndex: 1}, viewerCloseText: {color: '#ffffff', fontSize: 34, lineHeight: 38}, video: {borderRadius: 8, height: 240, marginTop: 8, maxWidth: 420, width: '100%'}, audio: {borderRadius: 8, height: 64, marginTop: 8, maxWidth: 420, width: '100%'}, attachment: {alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 10, marginTop: 8, maxWidth: 420, padding: 10, width: '100%'}, attachmentIcon: {fontSize: 26}, attachmentName: {fontSize: 14, fontWeight: '700'}, typing: {fontSize: 12, minHeight: 20, paddingHorizontal: 14}, composerError: {fontSize: 12, paddingHorizontal: 14, paddingBottom: 4},
  selectedFiles: {gap: 8, paddingHorizontal: 10, paddingVertical: 8}, selectedFile: {alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', height: 54, maxWidth: 230, minWidth: 150, overflow: 'hidden', paddingRight: 4}, selectedThumbnail: {height: 52, marginRight: 8, width: 52}, selectedIcon: {fontSize: 24, marginHorizontal: 10}, selectedName: {flex: 1, fontSize: 13, fontWeight: '600'}, selectedRemove: {alignItems: 'center', height: 40, justifyContent: 'center', width: 36}, selectedRemoveText: {color: '#ed4245', fontSize: 24},
  composer: {alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8, padding: 10}, attach: {alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44}, attachText: {fontSize: 27, lineHeight: 30}, composerInput: {borderRadius: 20, flex: 1, fontSize: 16, maxHeight: 120, minHeight: 44, paddingHorizontal: 16, paddingVertical: 11}, send: {alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44}, sendText: {color: '#fff', fontSize: 20, fontWeight: '800'}, uploadStatus: {fontSize: 12, paddingBottom: 6, paddingHorizontal: 14}, disabled: {opacity: 0.5},
  blockedNotice: {fontSize: 12, paddingHorizontal: 14, paddingVertical: 6},
  contextBanner: {alignItems: 'center', flexDirection: 'row', marginHorizontal: 10, paddingHorizontal: 12, paddingVertical: 8}, contextClose: {fontSize: 28, paddingHorizontal: 8}, sheetBackdrop: {backgroundColor: 'rgba(0,0,0,0.55)', flex: 1, justifyContent: 'flex-end'}, sheet: {borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24, paddingHorizontal: 16, paddingTop: 18}, sheetTitle: {fontSize: 18, fontWeight: '800', marginBottom: 12}, quickReactions: {flexDirection: 'row', gap: 8, marginBottom: 12}, quickReaction: {alignItems: 'center', borderRadius: 22, height: 44, justifyContent: 'center', width: 44}, quickReactionText: {fontSize: 22}, actionButton: {borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 15}, panel: {flex: 1}, searchBar: {flexDirection: 'row', gap: 8, padding: 12}, searchInput: {borderRadius: 10, flex: 1, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10}, searchButton: {borderRadius: 10, justifyContent: 'center', paddingHorizontal: 16}, panelBusy: {marginTop: 40}, panelList: {gap: 8, padding: 12}, panelItem: {borderRadius: 10, padding: 12},
  actionText: {fontSize: 16}, dangerText: {color: '#ed4245'}, whiteText: {color: '#fff'}, searchButtonText: {color: '#fff', fontWeight: '800'},
  memberRow: {alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 12, padding: 12}, memberAvatar: {borderRadius: 22, fontSize: 18, fontWeight: '800', height: 44, lineHeight: 44, overflow: 'hidden', textAlign: 'center', width: 44}, memberName: {fontSize: 16, fontWeight: '700'}, profileBackdrop: {alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.65)', flex: 1, justifyContent: 'center', padding: 24}, profileCard: {borderRadius: 16, maxWidth: 420, padding: 20, width: '100%'}, profileAvatar: {borderRadius: 38, fontSize: 30, fontWeight: '800', height: 76, lineHeight: 76, marginBottom: 12, overflow: 'hidden', textAlign: 'center', width: 76}, profileAvatarImage: {borderRadius: 38, height: 76, marginBottom: 12, width: 76}, profileName: {fontSize: 22, fontWeight: '800'}, profileStatus: {marginTop: 10}, profileInput: {borderRadius: 10, fontSize: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 11}, profilePrimary: {alignItems: 'center', borderRadius: 10, marginTop: 16, padding: 13}, profileAction: {alignItems: 'center', padding: 13}, reportInput: {borderRadius: 10, marginTop: 16, minHeight: 100, padding: 12, textAlignVertical: 'top'},
  linkCard: {borderLeftWidth: 4, borderRadius: 6, borderWidth: 1, flexDirection: 'row', marginTop: 8, maxWidth: 420, overflow: 'hidden', width: '100%'}, linkContent: {flex: 1, gap: 4, justifyContent: 'center', padding: 10}, linkTitle: {fontSize: 15, fontWeight: '800'}, linkImage: {height: 112, width: 112},
  moderationActions: {gap: 8, marginTop: 12}, moderationAction: {alignItems: 'center', borderRadius: 8, padding: 12}, panelStatus: {paddingHorizontal: 12, paddingTop: 12}, resolveButton: {alignItems: 'center', borderRadius: 8, marginTop: 10, padding: 10},
});
