import {render,screen} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import {ReplyExcerpt,replySummary} from './message-reply';
describe('reply previews',()=>{
 it('summarizes multiline, attachment-only, and deleted originals',()=>{
  expect(replySummary({body:'First line\nSecond line',deleted:false})).toBe('First line Second line');
  expect(replySummary({deleted:false,attachments:[{id:'a',name:'mockups.png',content_type:'image/png',size:42}]})).toBe('mockups.png');
  expect(replySummary({body:'Private original',deleted:true})).toBe('Message deleted');
 });
 it('hides the text of a deleted original in a sent reply',()=>{
  render(<ReplyExcerpt reply={{message_id:'original',author_name:'sam',body:'Old text',deleted:true}}/>);
  expect(screen.getByText('sam')).toBeVisible();
  expect(screen.getByText('Message deleted')).toBeVisible();
  expect(screen.queryByText('Old text')).not.toBeInTheDocument();
 });
});
