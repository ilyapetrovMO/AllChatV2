// Execute through Penpot MCP on the Mobile catalog page. Pixel units match Android captures.
if(penpot.currentFile.id!=='c828d3cf-7d4e-8145-8008-9a4f1a6ff37f'||penpot.currentPage.name!=='03 — Mobile')throw Error('Wrong target');
const font=penpot.fonts.findAllByName('Roboto').find(f=>f.name==='Roboto');if(!font)throw Error('Roboto unavailable');
const palette={background:'#191a1f',field:'#25272e',border:'#393c46',text:'#f5f6fb',muted:'#aeb2c0',placeholder:'#747988',accent:'#5865f2'};
function board(name,x,y,w,h,color,radius=0){const b=penpot.createBoard();b.name=name;b.resize(w,h);b.x=x;b.y=y;b.fills=color?[{fillColor:color,fillOpacity:1}]:[];b.borderRadius=radius;return b;}
function label(parent,value,x,y,w,h,size,color,weight='400',align='left'){
 const t=penpot.createText(value);font.applyToText(t,font.variants.find(v=>v.fontWeight===weight&&v.fontStyle==='normal'));t.name=value;t.fontSize=String(size);t.growType='fixed';t.resize(w,h);t.align=align;t.verticalAlign='center';t.fills=[{fillColor:color,fillOpacity:1}];parent.appendChild(t);t.x=parent.x+x;t.y=parent.y+y;return t;
}
function component(name,create){let c=penpot.library.local.components.find(c=>[c.path,c.name].filter(Boolean).join(' / ')===name);if(c)return c;const b=create();b.setPluginData('source','mobile/src/screens/CommunityScreen.tsx:3414-3449; styles:4477-4496,4802-4816');c=penpot.library.local.createComponent([b]);c.name=name;return c;}
const close=component('Mobile / Close panel / Dark',()=>{const b=board('Close panel — 44dp target',4000,0,115.5,115.5,null);label(b,'×',0,0,115.5,115.5,73.5,palette.text,'400','center');return b;});
const search=component('Mobile / Search button / Dark',()=>{const b=board('Search button',4000,200,201,109,palette.accent,26.25);label(b,'Search',0,0,201,109,36.75,'#ffffff','800','center');return b;});
const input=component('Mobile / Search input / Empty dark',()=>{const b=board('Search input',4000,400,795,111,palette.field,26.25);label(b,'Search Messages',36.75,0,721.5,111,42,palette.placeholder);return b;});
function place(c,parent,x,y){const i=c.instance();parent.appendChild(i);i.x=parent.x+x;i.y=parent.y+y;return i;}
const result=[];
for(const [index,mode] of ['pins','search'].entries()){
 const name=`Mobile / ${mode==='pins'?'Pinned messages':'Search messages'} / Empty dark`;
 const existing=penpot.currentPage.root.children.find(b=>b.name===name);if(existing){result.push({mode,boardId:existing.id,existing:true});continue;}
 const b=board(name,1400+index*1200,0,1080,2400,palette.background);
 label(b,mode==='pins'?'Pinned Messages':'Search',42,50,800,71,52.5,palette.text,'800');
 const line=penpot.createRectangle();line.name='Header divider';line.resize(1080,1);line.fills=[{fillColor:palette.border,fillOpacity:1}];b.appendChild(line);line.x=b.x;line.y=172;
 place(close,b,923,28);
 if(mode==='search'){place(input,b,31,204);place(search,b,848,205);}
 label(b,mode==='pins'?'No pinned Messages.':'Enter a search query.',31,mode==='pins'?204:377,1017,51,36.75,palette.muted);
 b.setPluginData('source','mobile/src/screens/CommunityScreen.tsx:3373-3493');
 b.setPluginData('capture',`mobile-reference/${mode==='pins'?'pinned-messages':'search-messages'}-dark.png`);
 b.setPluginData('status','Native editable draft. Android OS status/navigation overlays are reference-only. Exact Roboto family and source weight selected. Baselines and focused input caret pending verification.');
 b.setPluginData('states',JSON.stringify({implemented:['loading spinner','empty pins','empty query','no search results','message results','jump to message','close','search submit'],captured:mode==='pins'?['empty pins']:['empty query'],pending:['loading','populated','keyboard','light theme']}));
 result.push({mode,boardId:b.id});
}
return {boards:result,components:[close,search,input].map(c=>({id:c.id,name:c.name,mainId:c.mainInstance().id})),status:'Editable drafts; visual verification pending'};
