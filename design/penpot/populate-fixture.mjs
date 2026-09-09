import fs from 'node:fs/promises';
import path from 'node:path';

export async function populateFixture(browser, context, baseURL, root, channel, post) {
  for (const username of ['alex','sam','mobile-member','jordan','taylor']) {
    const invitation=await post('/api/v1/invitations',{expires_in_minutes:60,max_uses:1});
    const memberContext=await browser.newContext({baseURL});
    try {
      const response=await memberContext.request.post('/api/v1/auth/register',{data:{token:invitation.token,username,password:'visual regression password'}});
      if(!response.ok())throw Error(`Fixture member registration failed: ${response.status()}`);
      const member=await response.json();
      const dm=await post('/api/v1/dms',{member_id:member.id});
      await post(`/api/v1/dms/${dm.id}/messages`,{body:`Private conversation with ${username}.`});
    } finally {await memberContext.close();}
  }
  const csrf=(await context.cookies()).find(c=>c.name==='allchat_csrf')?.value||'';
  async function upload(name,type,data) {
    const response=await context.request.post('/api/v1/attachments',{data,headers:{'X-CSRF-Token':csrf,'X-AllChat-Filename':name,'Content-Type':type}});
    if(!response.ok())throw Error(`Fixture upload failed: ${response.status()}`);
    return response.json();
  }
  const image=await upload('allchat-icon.png','image/png',await fs.readFile(path.join(root,'internal/instance/web/assets/icon-192.png')));
  await post(`/api/v1/channels/${channel.id}/messages`,{body:'Image attachment example',attachment_ids:[image.id]});
  const file=await upload('project-notes.txt','text/plain',Buffer.from('Representative file attachment for the design catalog.'));
  await post(`/api/v1/channels/${channel.id}/messages`,{body:'File attachment example',attachment_ids:[file.id]});
  await post(`/api/v1/channels/${channel.id}/messages`,{body:'**Bold**, *emphasis*, and `inline code`.'});
  await post(`/api/v1/channels/${channel.id}/messages`,{body:'```json\n{"state": "ready", "members": 6}\n```'});
}
