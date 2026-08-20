import { describe, expect, it } from 'vitest';
import { insertMention, matchMention } from './mentions';

const members = [
  { id: 'one', username: 'mobile', displayName: 'Mobile Member' },
  { id: 'two', username: 'alice', displayName: 'Alice Example' },
];

describe('desktop mention completion', () => {
  it('matches a mention token at the caret and ignores email text', () => {
    expect(matchMention('hello @mob', 10, members)?.members.map(({ id }) => id)).toEqual(['one']);
    expect(matchMention('mail@example', 12, members)).toBeNull();
  });

  it('inserts a stable username while preserving suffix text', () => {
    const match = matchMention('hello @mob later', 10, members)!;
    expect(insertMention('hello @mob later', match, 'mobile')).toEqual({ value: 'hello @mobile  later', caret: 14 });
  });
});
