import type {MobileBootstrap, Message} from '../client/bootstrap';
import type {RealtimeEvent, RealtimeFrame} from '../realtime/RealtimeClient';

export type CommunityState = MobileBootstrap & {needs_refresh: boolean};

export function communityStateFromBootstrap(bootstrap: MobileBootstrap): CommunityState {
  return {...bootstrap, needs_refresh: false};
}

export function reduceRealtimeFrame(state: CommunityState, frame: RealtimeFrame): CommunityState {
  if (frame.type === 'events') {
    const reduced = (frame.events || []).reduce((current, event) => reduceEvent(current, event), state);
    return {...reduced, cursor: Math.max(reduced.cursor, frame.cursor || 0)};
  }
  if (frame.type === 'snapshot_required') {
    return {...state, cursor: Math.max(state.cursor, frame.cursor || 0), needs_refresh: true};
  }
  return reduceEvent(state, {
    cursor: frame.cursor || state.cursor,
    type: frame.type,
    channel_id: frame.channel_id || '',
    payload: frame.payload,
  });
}

function reduceEvent(state: CommunityState, event: RealtimeEvent): CommunityState {
  const cursor = Math.max(state.cursor, event.cursor || 0);
  if (event.type === 'state.ephemeral') {
    const payload = event.payload as Partial<Pick<MobileBootstrap, 'presence' | 'typing'>> | undefined;
    return {...state, cursor, presence: payload?.presence || state.presence, typing: payload?.typing || state.typing};
  }
  if (event.type === 'channel.removed') {
    const messages = {...state.messages}; delete messages[event.channel_id];
    return {
      ...state, cursor, messages,
      channels: state.channels.filter(channel => channel.id !== event.channel_id),
      channel_states: state.channel_states.filter(channel => channel.channel_id !== event.channel_id),
    };
  }
  if ((event.type === 'reaction.updated' || event.type === 'pin.updated') && event.payload && event.channel_id) {
    const current = state.messages[event.channel_id] || [];
    const payload = event.payload as {message_id: string; member_id?: string; emoji?: string; active?: boolean; pinned?: boolean};
    const messagesForChannel = current.map(message => {
      if (message.id !== payload.message_id) return message;
      if (event.type === 'pin.updated') return {...message, pinned: Boolean(payload.pinned)};
      const reactions = [...(message.reactions || [])];
      const index = reactions.findIndex(reaction => reaction.emoji === payload.emoji);
      if (index < 0 && payload.active) reactions.push({emoji: payload.emoji || '', count: 1, me: payload.member_id === state.member.id});
      else if (index >= 0) {
        const reaction = reactions[index];
        const count = Math.max(0, reaction.count + (payload.active ? 1 : -1));
        if (!count) reactions.splice(index, 1);
        else reactions[index] = {...reaction, count, ...(payload.member_id === state.member.id ? {me: Boolean(payload.active)} : {})};
      }
      return {...message, reactions};
    });
    return {...state, cursor, messages: {...state.messages, [event.channel_id]: messagesForChannel}};
  }
  if (!event.type.startsWith('message.') || !event.payload || !event.channel_id) {
    return cursor === state.cursor ? state : {...state, cursor};
  }

  const incoming = event.payload as Message;
  const current = state.messages[event.channel_id] || [];
  const index = current.findIndex(message => message.id === incoming.id);
  let messagesForChannel: Message[];
  let created = false;
  if (index < 0) {
    if (event.type !== 'message.created') return {...state, cursor};
    created = true;
    messagesForChannel = [...current, incoming].sort((left, right) => left.sequence - right.sequence);
  } else {
    messagesForChannel = [...current];
    messagesForChannel[index] = event.type === 'message.deleted'
      ? {...messagesForChannel[index], deleted: true}
      : {...messagesForChannel[index], ...incoming};
  }

  const channelStates = [...state.channel_states];
  const stateIndex = channelStates.findIndex(channel => channel.channel_id === event.channel_id);
  const previous = stateIndex < 0
    ? {channel_id: event.channel_id, read_sequence: 0, last_sequence: 0, unread: 0}
    : channelStates[stateIndex];
  const nextChannelState = {
    ...previous,
    last_sequence: Math.max(previous.last_sequence, incoming.sequence || 0),
    unread: previous.unread + (created && incoming.author_id !== state.member.id ? 1 : 0),
  };
  if (stateIndex < 0) channelStates.push(nextChannelState); else channelStates[stateIndex] = nextChannelState;
  return {...state, cursor, messages: {...state.messages, [event.channel_id]: messagesForChannel}, channel_states: channelStates};
}
