import {insertMention, matchMention} from '../src/mentions';

const members = [
  {id: 'one', username: 'mobile', display_name: 'Mobile Member', owner: false},
  {id: 'two', username: 'alice', display_name: 'Alice Example', owner: false},
];

describe('mobile mention completion', () => {
  it('matches username and display name at a mention boundary', () => {
    expect(matchMention('@mob', 4, members)?.members[0].id).toBe('one');
    expect(matchMention('@example', 8, members)?.members[0].id).toBe('two');
    expect(matchMention('mail@example', 12, members)).toBeUndefined();
  });

  it('inserts the canonical username', () => {
    const match = matchMention('hi @mob!', 7, members)!;
    expect(insertMention('hi @mob!', match, 'mobile')).toEqual({value: 'hi @mobile !', caret: 11});
  });
});
