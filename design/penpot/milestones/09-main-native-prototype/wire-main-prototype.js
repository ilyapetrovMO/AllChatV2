const page=penpot.currentPage;const boards=page.root.children.filter(b=>b.name.startsWith('Main prototype / '));const states=Object.fromEntries(boards.map(b=>[b.getPluginData('main-prototype-state'),b]));
function link(b,name,key){const s=penpotUtils.findShape(s=>s.name===name,b);if(!s)throw Error('Missing '+name);for(const target of [s,...penpotUtils.findShapes(()=>true,s)])target.addInteraction('click',{type:'navigate-to',destination:states[key],preserveScrollPosition:false});}
for(const [key,b] of Object.entries(states)){
 for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const i of [...s.interactions])s.removeInteraction(i);
 link(b,'Members toggled',key==='members-hidden'?'default':'members-hidden');link(b,'Members icon',key==='members-hidden'?'default':'members-hidden');
 link(b,'Composer placeholder','draft');link(b,'Send message',key==='draft'?'sent':key==='sent'?'sent':'default');
 link(b,'Search field','search');link(b,'Search example','search');link(b,'No results example','no-results');link(b,'Restart main','default');link(b,'Selected text channel','default');
 if(key==='search'){link(b,'Close search','sent');link(b,'Jump to message','sent');}if(key==='no-results')link(b,'Close search','default');
}
if(!page.flows.some(f=>f.name==='Desktop main — prototype'))page.createFlow('Desktop main — prototype',states.default);
for(const f of [...page.flows])if(/^Flow \d+$/.test(f.name)&&boards.some(b=>b.id===f.startingBoard.id))page.removeFlow(f);
penpot.viewport.zoomIntoView([states.default]);return {flow:'Desktop main — prototype',states:Object.keys(states)};
