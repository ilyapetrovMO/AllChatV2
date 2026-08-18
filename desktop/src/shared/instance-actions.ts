import type { Message } from './instance-state';

export type InstanceAction = {
  type: 'send_message';
  conversationId: string;
  direct: boolean;
  body: string;
};

export type InstanceActionResult = { type: 'message'; message: Message };
