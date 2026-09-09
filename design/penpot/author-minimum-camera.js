if(penpot.currentPage.name!=='Desktop — Main')throw Error('Expected main page');
const specs=[['landscape',false,304.875,542,1924.78125,1902.390625,1469],['portrait',false,320,180,1939.90625,1917.515625,1484],['landscape-notice',true,304.875,542,1924.78125,1902.390625,1469]],out=[];
for(const [i,[key,bottom,h,w,ch,ny,maxScroll]] of specs.entries()){
 let b=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Settings / voice-small-camera-'+key);
 if(!b){const source=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Settings / voice-minimum-'+(bottom?'bottom':'camera')),ref=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Settings / voice-camera-on-landscape');if(!source||!ref)throw Error('Missing prerequisite');
 b=source.clone();b.name='Desktop / Settings / voice-small-camera-'+key;b.x=126000+i*1100;b.y=0;b.showInViewMode=false;b.setPluginData('static-voice-minimum-state','');const find=n=>penpotUtils.findShape(s=>s.name===n,b),c=find('Settings scroll content');c.resize(584,ch);c.y=b.y+104-(bottom?maxScroll:935);
 const camera=find('Camera section');camera.resize(camera.width,camera.height+h-180);const preview=find('Camera preview');for(const s of [...preview.children])s.remove();preview.resize(542,h);const original=penpotUtils.findShape(s=>s.name==='Synthetic video frame',ref),frame=original.clone();preview.appendChild(frame);const sw=frame.width,sh=frame.height,rects=frame.children.map(s=>({s,x:s.x-frame.x,y:s.y-frame.y,w:s.width,h:s.height}));frame.resize(w,h);frame.x=preview.x+(542-w)/2;frame.y=preview.y;for(const r of rects){r.s.resize(r.w*w/sw,r.h*h/sh);r.s.x=frame.x+r.x*w/sw;r.s.y=frame.y+r.y*h/sh;}
 for(const n of ['Camera device label','Camera device','Test Video button','Screen sharing section','Advanced section'])find(n).y+=h-180;
 const button=find('Test Video button');button.name='Stop Video button';for(const s of [...button.children])s.remove();const label=penpotUtils.findShape(s=>s.name==='Stop Video label',ref).clone();button.appendChild(label);label.resize(84,22.390625);label.x=button.x+(button.width-82.89999389648438)/2;label.y=button.y+3;
 const notice=penpotUtils.findShape(s=>s.name==='Voice settings notice',ref).clone();c.appendChild(notice);notice.resize(584,22.390625);notice.x=c.x;notice.y=c.y+ny;
 b.setPluginData('static-minimum-camera-state',key);b.setPluginData('camera-aspect-ratio',String(w/h));for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const a of [...s.interactions])s.removeInteraction(a);
 }out.push({key:'voice-small-camera-'+key,id:b.id});
}return out;
