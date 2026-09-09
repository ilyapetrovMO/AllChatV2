if(penpot.currentPage.name!=='Desktop — Main')throw Error('Expected main page');const base=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Main / Text channel');if(!base)throw Error('Missing base');
const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
function box(parent,name,x,y,w,h,color='#202127',r=8){const s=penpot.createBoard();s.name=name;s.resize(w,h);s.fills=[{fillColor:color,fillOpacity:1}];s.borderRadius=r;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}
function text(parent,name,copy,x,y,w,size=14,weight=400,color='#F0F1F5'){const t=penpot.createText(copy);t.name=name;font.applyToText(t,font.variants.find(v=>v.fontWeight===String(weight)&&v.fontStyle==='normal'));t.fontSize=String(size);t.resize(w,size*1.4);t.fills=[{fillColor:color,fillOpacity:1}];parent.appendChild(t);t.x=parent.x+x;t.y=parent.y+y;return t;}
function panel(b,name,x,y,w,h){const s=box(b,name,x,y,w,h);s.strokes=[{strokeColor:'#FFFFFF',strokeOpacity:.065,strokeWidth:1,strokeStyle:'solid',strokeAlignment:'inner'}];s.shadows=[{style:'drop-shadow',offsetX:0,offsetY:12,blur:32,spread:0,color:{color:'#000000',opacity:.46}}];return s;}
function copyIcon(b,parent,original,name,x,y){const s=penpotUtils.findShape(s=>s.name===original,b).clone();s.name=name;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}

const states=[
 ['voice-feedback-devices-unavailable','Media devices are unavailable.'],
 ['voice-feedback-microphone-working','Microphone is working.'],
 ['voice-feedback-microphone-enhanced','Microphone is working with RNNoise.','Enhanced (RNNoise)'],
 ['voice-feedback-microphone-fallback','Enhanced RNNoise is unavailable; standard WebRTC suppression is active.','Enhanced (RNNoise)'],
 ['voice-feedback-microphone-error','Microphone permission was denied or the selected device is unavailable.'],
 ['voice-feedback-camera-stopped','Camera preview stopped.'],
 ['voice-feedback-camera-error','Camera permission was denied or the selected device is unavailable.'],
 ['voice-feedback-speaker-played','Speaker test played.'],
 ['voice-feedback-reset','Voice & Video settings were reset.']
];
const source=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Settings / voice-advanced');if(!source)throw Error('Missing voice base');let created=0;const results=[];
for(const [i,[key,notice,suppression]] of states.entries()){
 const name='Desktop / Settings / '+key;let b=penpot.currentPage.root.children.find(b=>b.name===name);
 if(!b&&created<3){b=source.clone();b.name=name;b.x=58600+(i%3)*1400;b.y=Math.floor(i/3)*960;b.setPluginData('static-voice-settings-state','');b.showInViewMode=false;
 const c=penpotUtils.findShape(s=>s.name==='Settings scroll content',b);text(c,'Voice settings notice',notice,0,1680,896,16,400,'#A4A8B3');
 if(suppression){const value=penpotUtils.findShape(s=>s.name==='Noise suppression value',b);value.characters=suppression;value.growType='auto-width';}
 b.setPluginData('static-voice-feedback-state',key);b.setPluginData('voice-feedback-copy',notice);for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const a of [...s.interactions])s.removeInteraction(a);created++;}
 if(b)results.push({key,id:b.id,notice});
}
return {created,remaining:states.length-results.length,boards:results};
