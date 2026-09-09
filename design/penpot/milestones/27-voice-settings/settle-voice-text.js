// Apply final text geometry before refreshing the canvas. After this command,
// open Desktop — Login, then Desktop — Main in separate MCP requests and re-export.
const boards=penpot.currentPage.root.children.filter(b=>b.getPluginData('static-voice-settings-state'));
for(const b of boards){const t=penpotUtils.findShape(s=>s.name==='Input sensitivity output',b);t.characters='-50 dB';t.resize(60,22);t.getRange(0,t.characters.length).fontSize='13.01';}
return {updated:boards.length,requiresCanvasRemount:true};
