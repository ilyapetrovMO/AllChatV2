if(penpot.currentPage.name!=='Desktop — Login')throw Error('Expected login page');
const base=penpot.currentPage.root.children.find(b=>b.name==='Login prototype / empty');if(!base)throw Error('Missing base');
const results=[];
for(const [index,key] of ['username-focus','password-focus','register-hover','submit-hover'].entries()){
 const name='Desktop / Login / Interaction / '+key;let b=penpot.currentPage.root.children.find(b=>b.name===name);
 if(!b){b=base.clone();b.name=name;b.x=7400+(index%2)*1400;b.y=900+Math.floor(index/2)*860;
 const find=name=>penpotUtils.findShape(s=>s.name===name,b);find('Prototype controls').remove();b.resize(1280,720);b.showInViewMode=false;
 for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const i of [...s.interactions])s.removeInteraction(i);
 if(key.endsWith('focus')){const input=find(key.startsWith('username')?'Username input':'Password input');input.strokes=[{strokeColor:'#7180FF',strokeOpacity:1,strokeWidth:1,strokeStyle:'solid',strokeAlignment:'inner'}];
 const outline=penpot.createBoard();outline.name='Keyboard focus outline';outline.resize(394,52.28);outline.fills=[];outline.borderRadius=9;outline.strokes=[{strokeColor:'#00A8FC',strokeOpacity:1,strokeWidth:3,strokeStyle:'solid',strokeAlignment:'inner'}];input.parent.appendChild(outline);outline.x=input.x-5;outline.y=input.y-5;
 }else if(key==='submit-hover'){find('Submit').fills=[{fillColor:'#5962D6',fillOpacity:1}];}
 else{const tab=find('Tab / Register');tab.fills=[{fillColor:'#30323A',fillOpacity:1}];for(const t of penpotUtils.findShapes(s=>s.type==='text',tab))t.fills=[{fillColor:'#F0F1F5',fillOpacity:1}];}
 b.setPluginData('interaction-reference',JSON.stringify({key,source:'Browser computed styles, desktop/src/renderer/styles.css',kind:'Static interaction reference; browser prototype provides live hover/focus'}));}
 results.push({id:b.id,name:b.name});
}return results;
