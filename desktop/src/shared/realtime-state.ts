import type { InstanceViewState, Message } from './instance-state';

export interface RealtimeEvent {
  cursor: number;
  type: string;
  channel_id: string;
  payload: unknown;
}

export interface RealtimeFrame {
  type: string;
  cursor: number;
  channel_id?: string;
  payload?: unknown;
  events?: RealtimeEvent[];
}

export function reduceRealtimeFrame(state: InstanceViewState, frame: RealtimeFrame): InstanceViewState {
  if (frame.type === 'events') {
    const result = (frame.events || []).reduce(reduceEvent, state);
    return { ...result, cursor: Math.max(result.cursor, frame.cursor), connection: 'online' };
  }
  return reduceEvent(state, {
    cursor: frame.cursor,
    type: frame.type,
    channel_id: frame.channel_id || '',
    payload: frame.payload,
  });
}

function reduceEvent(state: InstanceViewState, event: RealtimeEvent): InstanceViewState {
  const cursor = Math.max(state.cursor, event.cursor || 0);
  if (event.type === 'state.ephemeral') {
    const payload = event.payload as Partial<Pick<InstanceViewState, 'presence' | 'typing'>> | undefined;
    return {
      ...state,
      connection: 'online',
      cursor,
      presence: payload?.presence || state.presence,
      typing: payload?.typing || state.typing,
    };
  }
  if (event.type === 'channel.removed') {
    const messages = { ...state.messages };
    delete messages[event.channel_id];
    return {
      ...state,
      connection: 'online',
      cursor,
      messages,
      channels: state.channels.filter(({ id }) => id !== event.channel_id),
      channel_states: state.channel_states.filter(({ channel_id }) => channel_id !== event.channel_id),
    };
  }
	if (event.type === 'pin.updated' && event.channel_id && event.payload && typeof event.payload === 'object') {
	  const payload = event.payload as { message_id?: unknown; pinned?: unknown };
	  if (typeof payload.message_id === 'string' && typeof payload.pinned === 'boolean') {
		return { ...state, connection: 'online', cursor, messages: { ...state.messages, [event.channel_id]: (state.messages[event.channel_id] || []).map((message) => message.id === payload.message_id ? { ...message, pinned: payload.pinned as boolean } : message) } };
	  }
	}
  if (!event.type.startsWith('message.') || !isMessage(event.payload) || !event.channel_id) {
    return { ...state, connection: 'online', cursor };
  }

  const incoming = event.payload;
  const current = state.messages[event.channel_id] || [];
  const index = current.findIndex(({ id }) => id === incoming.id);
  let messages: Message[];
  let created = false;
  if (index < 0) {
    if (event.type !== 'message.created') return { ...state, connection: 'online', cursor };
    created = true;
    messages = [...current, incoming].sort((left, right) => left.sequence - right.sequence);
  } else {
    messages = [...current];
    messages[index] = event.type === 'message.deleted'
      ? { ...messages[index], deleted: true }
      : { ...messages[index], ...incoming };
  }

  const channelStates = [...state.channel_states];
  const stateIndex = channelStates.findIndex(({ channel_id }) => channel_id === event.channel_id);
  const previous = stateIndex < 0
    ? { channel_id: event.channel_id, read_sequence: 0, last_sequence: 0, unread: 0 }
    : channelStates[stateIndex];
  const next = {
    ...previous,
    last_sequence: Math.max(previous.last_sequence, incoming.sequence),
    unread: previous.unread + (created && incoming.author_id !== state.member.id ? 1 : 0),
  };
  if (stateIndex < 0) channelStates.push(next); else channelStates[stateIndex] = next;
  return {
    ...state,
    connection: 'online',
    cursor,
    messages: { ...state.messages, [event.channel_id]: messages },
    channel_states: channelStates,
  };
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<Message>;
  return typeof message.id === 'string' && typeof message.channel_id === 'string' &&
    typeof message.author_id === 'string' && typeof message.author_name === 'string' &&
    typeof message.sequence === 'number' && typeof message.created_at === 'string' &&
    typeof message.deleted === 'boolean';
}
