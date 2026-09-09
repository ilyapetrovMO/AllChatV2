#!/usr/bin/env python3
"""Index observed Android controls; captures are evidence, not exhaustive coverage."""
import json
import xml.etree.ElementTree as E
from pathlib import Path
root=Path(__file__).resolve().parent
capture=root/'mobile-reference'
manifest=json.loads((capture/'manifest.json').read_text())
surfaces=[]
for item in manifest['items']:
    nodes=E.parse(capture/item['hierarchy']).iter('node')
    controls=[]
    for node in nodes:
        if node.get('clickable')!='true' and node.get('class')!='android.widget.EditText':continue
        label=node.get('content-desc') or node.get('text') or ' '.join(n.get('text','') for n in node.iter('node') if n is not node).strip()
        controls.append({'label':label,'class':node.get('class'),'bounds':node.get('bounds'),'enabled':node.get('enabled')=='true','selected':node.get('selected')=='true','editable':node.get('class')=='android.widget.EditText'})
    surfaces.append({'name':item['name'],'reference':item['screenshot'],'controls':controls,'status':'observed native controls; offscreen and other states pending'})
(capture/'controls.json').write_text(json.dumps(surfaces,indent=2)+'\n')
print(f'Indexed {sum(len(s["controls"]) for s in surfaces)} controls across {len(surfaces)} native captures')
