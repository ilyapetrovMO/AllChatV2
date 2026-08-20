import type {Member} from './client/AllChatClient';

export type MentionMatch = {start: number; end: number; members: Member[]};

export function matchMention(draft: string, caret: number, members: Member[]): MentionMatch | undefined {
  const match = draft.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u);
  if (!match) return undefined;
  const query = match[1].toLocaleLowerCase();
  const choices = members.filter(member => member.username.toLocaleLowerCase().startsWith(query) || (member.display_name || '').toLocaleLowerCase().includes(query)).slice(0, 8);
  if (!choices.length) return undefined;
  return {start: caret - match[1].length - 1, end: caret, members: choices};
}

export function insertMention(draft: string, match: MentionMatch, username: string) {
  const value = `${draft.slice(0, match.start)}@${username} ${draft.slice(match.end)}`;
  return {value, caret: match.start + username.length + 2};
}
