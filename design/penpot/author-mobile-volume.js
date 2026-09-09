if(penpot.currentPage.name!=='03 — Mobile')throw Error('Wrong page');const font=penpot.fonts.findAllByName('Roboto').find(f=>f.name==='Roboto');if(!font)throw Error('Roboto missing');
const results=[];
for(const [index,value] of [0,.5,1].entries()){
 const name=`Mobile / Participant volume / ${value*100} percent dark`;const existing=penpot.library.local.components.find(c=>[c.path,c.name].filter(Boolean).join(' / ')===name);if(existing){results.push({value,componentId:existing.id,mainId:existing.mainInstance().id});continue;}
 const b=penpot.createBoard();b.name=name;b.resize(892.5,278.25);b.x=2600;b.y=5400+index*400;b.borderRadius=31.5;b.fills=[{fillColor:'#25272e',fillOpacity:1}];
 function text(value,y,size,weight,color){const t=penpot.createText(value);font.applyToText(t,font.variants.find(v=>v.fontWeight===weight&&v.fontStyle==='normal'));t.name=value;t.fontSize=String(size);b.appendChild(t);t.x=b.x+47.25;t.y=b.y+y;t.fills=[{fillColor:color,fillOpacity:1}];return t;}
 text('Member volume',47.25,42,'800','#f5f6fb');text(`${value*100}%`,109,34.125,'400','#aeb2c0');
 function rect(name,x,y,w,h,color,radius){const r=penpot.createRectangle();r.name=name;r.resize(w,h);r.borderRadius=radius;r.fills=[{fillColor:color,fillOpacity:1}];b.appendChild(r);r.x=b.x+x;r.y=b.y+y;return r;}
 rect('Volume track',47.25,205,798,21,'#393c46',10.5);if(value>0)rect('Volume fill',47.25,205,798*value,21,'#5865f2',10.5);rect('Volume thumb',47.25+798*value-26.25,189.25,52.5,52.5,'#f5f6fb',26.25);
 b.setPluginData('source','mobile/src/screens/CommunityScreen.tsx:2508-2561; styles:4995-5013');b.setPluginData('status','Source-derived component; text baselines, overall height, elevation shadow, native capture and visual verification pending');b.setPluginData('behavior','0–100% in 5% increments; preview on drag; commit on release or termination; accessibility increment/decrement commits immediately; outside tap or Android Back closes');
 const c=penpot.library.local.createComponent([b]);c.name=name;results.push({value,componentId:c.id,mainId:c.mainInstance().id});
}return results;
