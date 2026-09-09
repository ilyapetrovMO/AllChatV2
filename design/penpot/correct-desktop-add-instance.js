// Targeted corrections backed by desktop/src/renderer/styles.css and the app capture.
const board=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a624d6665de');
if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page must be active');
const all=[];function walk(s){all.push(s);for(const c of s.children||[])walk(c)}walk(board);
const get=t=>all.find(s=>s.type==='text'&&s.characters.trim()===t);
for(const label of ['Desktop Canary','Community address'])get(label).textTransform='uppercase';
get('Community address').letterSpacing='0.256';
for(const label of ['Desktop Canary','Add your first Instance','Connect an AllChat Community to start','messaging from the desktop client.','Add Instance']){
 const t=get(label);t.resize(384,Math.ceil(Number(t.fontSize)*1.4));t.x=board.x+484;t.align='center';
}
const background=all.find(s=>s.type==='rectangle'&&Math.abs(s.width-1208)<.01&&Math.abs(s.height-692)<.01);
const radius=Math.hypot(604,692)*.38;
background.name='Content / CSS radial background';
background.fills=[{fillColorGradient:{type:'radial',startX:.5,startY:0,endX:.5+radius/1208,endY:0,width:1208/692,stops:[{offset:0,color:'#404EED',opacity:1},{offset:1,color:'#0D0E11',opacity:1}]}}];
const card=all.find(s=>s.type==='rectangle'&&Math.abs(s.width-480)<.01&&Math.abs(s.height-387.31)<.02);
card.name='Onboarding card';card.shadows=[{style:'drop-shadow',offsetX:0,offsetY:12,blur:32,spread:0,hidden:false,color:{color:'#000000',opacity:.46}}];
const input=all.find(s=>s.type==='rectangle'&&Math.abs(s.width-384)<.01&&Math.abs(s.height-42.28)<.02);
input.strokes=[];
board.setPluginData('status','Canvas text confirmed by user; uppercase, alignment, background and shadow corrected; visual comparison and server export still pending');
return {boardId:board.id,backgroundId:background.id,cardId:card.id,gradientRadius:radius,correctedLabels:2};
