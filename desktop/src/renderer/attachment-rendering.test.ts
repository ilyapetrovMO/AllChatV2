import { describe, expect, it } from 'vitest';

import { desktopAttachmentDisplayPath } from './app';

describe('desktop Attachment rendering', () => {
  it('loads animated GIF originals instead of static generated previews', () => {
    expect(desktopAttachmentDisplayPath({ id: 'gif', name: 'party.gif', content_type: 'image/gif', size: 10, url: '/gif', preview_url: '/gif/preview' })).toBe('/gif');
    expect(desktopAttachmentDisplayPath({ id: 'png', name: 'still.png', content_type: 'image/png', size: 10, url: '/png', preview_url: '/png/preview' })).toBe('/png/preview');
  });
});
