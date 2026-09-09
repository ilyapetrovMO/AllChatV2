import json,subprocess,xml.etree.ElementTree as E
from pathlib import Path
root=Path('/tmp/allchat-voice-current'); ns='{http://www.w3.org/2000/svg}'
for name in ['connected','muted','focus','compact','empty','owner-menu','member-menu','self-menu','soundboard']:
 d=json.loads((root/(name+'.json')).read_text()); out=[]
 for a in d['items']:
  if a['type']!='text':continue
  font='DejaVu Sans'+(' Bold' if int(a['weight'])>=600 else '')+' '+str(a['size'])+'px'
  subprocess.run(['pango-view','--no-display','--margin=0','--font='+font,'--text='+a['text'],'--output='+str(root/'text.svg')],check=True)
  svg=E.parse(root/'text.svg').getroot(); defs={s.get('id'):s for s in svg.iter() if s.get('id')}; paths=[]
  for u in svg.iter(ns+'use'):
   ref=u.get('{http://www.w3.org/1999/xlink}href','')[1:]; target=defs.get(ref)
   if target is None:continue
   for p in target.iter(ns+'path'):
    paths.append('<path d="'+p.get('d')+'" transform="translate('+u.get('x','0')+' '+u.get('y','0')+')"/>')
  view=svg.get('viewBox'); markup='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+view+'" fill="'+a['color']['hex']+'">'+''.join(paths)+'</svg>'
  out.append({'text':a['text'],'x':a['x'],'y':a['y'],'w':a['w'],'h':a['h'],'svg':markup})
 (root/(name+'-vectors.json')).write_text(json.dumps(out))
 print(name,len(out))
