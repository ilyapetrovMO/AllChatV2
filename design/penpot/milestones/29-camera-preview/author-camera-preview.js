if(penpot.currentPage.name!=='Desktop — Main')throw Error('Expected main page');const base=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Main / Text channel');if(!base)throw Error('Missing base');
const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
function box(parent,name,x,y,w,h,color='#202127',r=8){const s=penpot.createBoard();s.name=name;s.resize(w,h);s.fills=[{fillColor:color,fillOpacity:1}];s.borderRadius=r;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}
function text(parent,name,copy,x,y,w,size=14,weight=400,color='#F0F1F5'){const t=penpot.createText(copy);t.name=name;font.applyToText(t,font.variants.find(v=>v.fontWeight===String(weight)&&v.fontStyle==='normal'));t.fontSize=String(size);t.resize(w,size*1.4);t.fills=[{fillColor:color,fillOpacity:1}];parent.appendChild(t);t.x=parent.x+x;t.y=parent.y+y;return t;}
function panel(b,name,x,y,w,h){const s=box(b,name,x,y,w,h);s.strokes=[{strokeColor:'#FFFFFF',strokeOpacity:.065,strokeWidth:1,strokeStyle:'solid',strokeAlignment:'inner'}];s.shadows=[{style:'drop-shadow',offsetX:0,offsetY:12,blur:32,spread:0,color:{color:'#000000',opacity:.46}}];return s;}
function copyIcon(b,parent,original,name,x,y){const s=penpotUtils.findShape(s=>s.name===original,b).clone();s.name=name;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}

const source=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Settings / voice-camera');if(!source)throw Error('Missing camera base');const results=[];
for(const [i,[key,ratio,scroll]] of [['voice-camera-on-landscape',16/9,880],['voice-camera-on-portrait',9/16,880],['voice-camera-started-notice',16/9,1220]].entries()){
 let b=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Settings / '+key);
 if(!b){b=source.clone();b.name='Desktop / Settings / '+key;b.x=63000+i*1400;b.y=960;b.setPluginData('static-voice-settings-state','');b.showInViewMode=false;const find=n=>penpotUtils.findShape(s=>s.name===n,b),c=find('Settings scroll content');c.resize(896,1870);c.y=b.y+104-scroll;
 const camera=find('Camera section');camera.resize(896,510);const preview=find('Camera preview');for(const s of [...preview.children])s.remove();preview.resize(854,320);preview.fills=[{fillColor:'#202127',fillOpacity:1}];const w=320*ratio,frame=box(preview,'Synthetic video frame',(854-w)/2,0,w,320,'#171A20',0);frame.setPluginData('fixture','Synthetic color-bar video; arbitrary media content, not product UI or live camera capture.');
 for(const [j,color] of ['#A7A9A2','#B1A775','#79A2A2','#739074','#A17F9A','#8A788F','#647D9C'].entries())box(frame,'Video color bar '+j,j*w/7,0,w/7,250,color,0);
 for(const [j,color] of ['#24272D','#D1D3CE','#565B63','#111318'].entries())box(frame,'Video lower bar '+j,j*w/4,250,w/4,70,color,0);
 for(const name of ['Camera device label','Camera device','Test Video button'])find(name).y+=140;
 const button=find('Test Video button');button.name='Stop Video button';for(const t of [...button.children])t.remove();const label=text(button,'Stop Video label','Stop Video',380,3,120,16,400,'#FFFFFF');
 for(const name of ['Screen sharing section','Advanced section'])find(name).y+=140;
 const notice=text(c,'Voice settings notice','Camera preview started.',0,1820,896,16,400,'#A4A8B3');
 b.setPluginData('static-camera-preview-state',key);b.setPluginData('camera-aspect-ratio',String(ratio));for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const a of [...s.interactions])s.removeInteraction(a);
 }results.push({key,id:b.id});
}return results;
