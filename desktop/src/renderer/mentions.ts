export interface MentionMember {
  id: string;
  username: string;
  displayName?: string;
}

export interface MentionMatch {
  start: number;
  end: number;
  query: string;
  members: MentionMember[];
}

export function matchMention(draft: string, caret: number, members: MentionMember[]): MentionMatch | null {
  if (caret < 0) return null;
  const before = draft.slice(0, caret);
  const match = before.match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u);
  if (!match) return null;
  const query = match[1].toLocaleLowerCase();
  const matches = members.filter((member) => member.username.toLocaleLowerCase().startsWith(query) || (member.displayName || '').toLocaleLowerCase().includes(query)).slice(0, 8);
  if (!matches.length) return null;
  return { start: caret - match[1].length - 1, end: caret, query, members: matches };
}

export function insertMention(draft: string, match: MentionMatch, username: string): { value: string; caret: number } {
  const value = `${draft.slice(0, match.start)}@${username} ${draft.slice(match.end)}`;
  return { value, caret: match.start + username.length + 2 };
}
