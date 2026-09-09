const specs=[{state:'username-focused'},{state:'password-focused'},{state:'submit-keyboard-focused'},{state:'submit-hovered'},{state:'register-tab-hovered'},{state:'credentials-filled',username:'catalog-no-such-member',mask:24},{state:'login-error',username:'catalog-no-such-member',mask:24},{state:'credentials-edited-after-error',username:'visual-owner',mask:26}];const results=[];
for(const d of specs){const b=penpot.currentPage.root.children.find(s=>s.name===`Desktop / Sign in / ${d.state}`);if(!b)throw Error('Missing '+d.state);const all=[];function walk(s){all.push(s);for(const c of s.children||[])walk(c)}walk(b);
 for(const [name,copy] of [['Username input',d.username||' '],['Password input',d.mask?'•'.repeat(d.mask):' '],['Sign in submit','Sign in'],['Authentication tab / Sign in','Sign in'],['Authentication tab / Register','Register'],['Authentication tab / Recovery','Recovery']]){
  const c=all.find(s=>s.type==='board'&&s.name===name),t=c.children.find(s=>s.type==='text');
  // Separate invocations: component initialization and style updates can overwrite same-call text changes.
  if(storage.signInStylePass)t.fills=[{fillColor:name.endsWith('input')?'#F0F1F5':name==='Sign in submit'?'#FFFFFF':name==='Authentication tab / Sign in'||d.state==='register-tab-hovered'&&name==='Authentication tab / Register'?'#F0F1F5':'#A4A8B3',fillOpacity:1}];else t.characters=copy;
 }
 results.push({state:d.state,boardId:b.id});
}
delete storage.signInStylePass;return results;
