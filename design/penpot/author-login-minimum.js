if(penpot.currentFile.id!=='c828d3cf-7d4e-8145-8008-9a4f1a6ff37f'||penpot.currentPage.name!=='Desktop — Login')throw Error('Expected login file/page');
const result=[];
for(const [index,key] of ['empty','register','recovery'].entries()){
 const name='Desktop / Login / Minimum / '+key;
 let b=penpot.currentPage.root.children.find(s=>s.name===name);
 if(!b){
 const source=penpot.currentPage.root.children.find(s=>s.name==='Login prototype / '+key);if(!source)throw Error('Missing '+key);
 b=source.clone();b.name=name;b.x=7400+index*1080;b.y=0;
 const find=name=>penpotUtils.findShape(s=>s.name===name,b);
 find('Prototype controls').remove();
 for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const i of [...s.interactions])s.removeInteraction(i);
 b.resize(960,640);b.clipContent=true;b.showInViewMode=false;
 find('Desktop title bar').resize(960,28);find('Title bar divider').resize(960,1);
 for(const n of ['Minimize','Maximize','Close'])find(n).x-=320;
 find('Community rail').resize(72,612);
 for(const n of ['Add community button','Add community icon'])find(n).y-=80;
 const bg=find('Authentication background');bg.resize(888,612);bg.clipContent=true;
 const card=find('Authentication card');card.x=b.x+276;card.y=b.y+(key==='register'?52:key==='recovery'?81.266:61.672);
 b.setPluginData('minimum-window-reference',JSON.stringify({sourceId:source.id,width:960,height:640,mode:key,scrollHeight:key==='register'?636:612,kind:'Static initial viewport reference; use browser prototype for scroll and typing'}));
 }
 result.push({id:b.id,name:b.name,width:b.width,height:b.height,reference:b.getPluginData('minimum-window-reference')});
}
return result;
