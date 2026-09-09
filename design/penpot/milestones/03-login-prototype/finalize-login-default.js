// Run separately after author-login-default.js so component initialization settles.
if(penpot.currentPage.name!=='Desktop — Login')throw Error('Expected Desktop — Login');
const b=penpot.currentPage.root.children.find(s=>s.name==='Desktop / Login / Default');
if(!b)throw Error('Default login board missing');
for(const label of ['Sign in','Register','Recovery']){
 const tab=penpotUtils.findShape(s=>s.name==='Authentication tab / '+label,b);
 penpotUtils.findShape(s=>s.type==='text',tab).characters=label;
}
penpot.viewport.zoomIntoView([b]);
return {boardId:b.id,validation:penpot.currentFile.validate()};
