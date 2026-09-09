if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
const results=[];
const specs=[['Button','Default'],['Button','Hover'],['Button','Keyboard focus'],['Address input','Default'],['Address input','Hover'],['Address input','Keyboard focus']];
for(let i=0;i<specs.length;i++){
 const [kind,state]=specs[i],name=`Desktop / Onboarding / ${kind} / ${state}`;
 const existing=penpot.library.local.components.find(c=>[c.path,c.name].filter(Boolean).join(' / ')===name);
 if(existing){results.push({name,componentId:existing.id,mainId:existing.mainInstance().id});continue;}
 const button=kind==='Button',h=button?43.17:42.28;
 const b=penpot.createBoard();b.name=name;b.resize(384,h);b.x=6000;b.y=i*120;b.clipContent=false;b.fills=[];
 const r=penpot.createRectangle();r.name='Background';r.resize(384,h);r.x=b.x;r.y=b.y;r.borderRadius=4;r.fills=[{fillColor:button?(state==='Hover'?'#5962D6':'#6D75E8'):'#202127',fillOpacity:1}];r.strokes=[];b.appendChild(r);
 if(!button&&state!=='Default')r.strokes=[{strokeColor:state==='Hover'?'#FFFFFF':'#7180FF',strokeOpacity:state==='Hover'?.14:1,strokeWidth:1,strokeAlignment:'inner',strokeStyle:'solid'}];
 if(state==='Keyboard focus'){
  const ring=penpot.createRectangle();ring.name='Keyboard focus outline';ring.resize(394,h+10);ring.x=b.x-5;ring.y=b.y-5;ring.borderRadius=8;ring.fills=[];ring.strokes=[{strokeColor:'#00A8FC',strokeOpacity:1,strokeWidth:3,strokeAlignment:'inner',strokeStyle:'solid'}];b.appendChild(ring);
  if(!button)r.shadows=[{style:'drop-shadow',offsetX:0,offsetY:0,blur:0,spread:3,color:{color:'#5965F2',opacity:.18}}];
 }
 const t=penpot.createText(button?'Add Instance':'chat.example');t.name=button?'Button label':'Placeholder';font.applyToText(t,font.variants.find(v=>v.fontWeight==='700'&&v.fontStyle==='normal'));t.fontSize=button?'16':'12.8';t.resize(button?384:360,20);t.x=b.x+(button?0:12);t.y=b.y+11.2;t.align=button?'center':'left';t.fills=[{fillColor:button?'#FFFFFF':'#757575',fillOpacity:1}];b.appendChild(t);
 b.setPluginData('source','desktop/src/renderer/styles.css:256; design/penpot/populated/desktop-onboarding-reference/');b.setPluginData('verification','Native editable control; Inter substitution for unavailable platform fonts; visual comparison pending');
 const c=penpot.library.local.createComponent([b]);c.name=state;c.path=`Desktop / Onboarding / ${kind}`;results.push({name,componentId:c.id,mainId:c.mainInstance().id});
}
return results;
