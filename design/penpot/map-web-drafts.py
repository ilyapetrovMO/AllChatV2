#!/usr/bin/env python3
"""Link authored default web states to source surfaces without asserting full coverage."""
import json
from pathlib import Path
root=Path(__file__).resolve().parent
coverage=json.loads((root/'coverage.json').read_text())
progress=json.loads((root/'web-native-progress.json').read_text())
by_name={item['name']:item for item in progress}
extra={'auth':'login','recovery':'recover','join':'join','admin-dashboard':'admin-dashboard'}
mappings=[]
for item in coverage['items']:
    if item['platform']!='web':continue
    name=extra.get(item['name']) or Path(item.get('reference',{}).get('path','')).stem
    draft=by_name.get(name)
    if not draft:continue
    mappings.append({'surfaceId':item['id'],'source':item['source'],'line':item['line'],'anchor':item['anchor'],'boardId':draft['boardId'],'capture':f'populated/web-reference/{name}.png','routeState':name,'status':'editable default-state draft; other states and visual fidelity pending'})
for name,draft in by_name.items():
    if not name.startswith('channels-'):continue
    data=json.loads((root/f'populated/web-reference/{name}.json').read_text())
    surface=next(i for i in coverage['items'] if i['platform']=='web' and i['name']==('voice-room' if data.get('title','').endswith('AllChat Voice') else 'channel'))
    mappings.append({'surfaceId':surface['id'],'source':surface['source'],'line':surface['line'],'anchor':surface['anchor'],'boardId':draft['boardId'],'capture':f'populated/web-reference/{name}.png','routeState':name,'status':'editable captured-state draft; media interactions and visual fidelity pending'})
(root/'web-source-mappings.json').write_text(json.dumps(mappings,indent=2)+'\n')
print(f'Mapped {len(mappings)} web draft boards to source surfaces')
