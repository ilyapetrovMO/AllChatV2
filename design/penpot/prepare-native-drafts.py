#!/usr/bin/env python3
"""Prepare captured desktop SVGs for native Penpot text conversion; no network writes."""
from pathlib import Path
import json
import sys
import xml.etree.ElementTree as E

root=Path(__file__).resolve().parent
platform=sys.argv[1] if len(sys.argv)>1 else 'desktop'
if platform not in ('desktop','web','sketchboard','desktop-message'):raise SystemExit('Use desktop or web')
source=root/f'populated/{platform}-reference' if platform!='sketchboard' else root/'sketchboard-reference'
ns='{http://www.w3.org/2000/svg}'
E.register_namespace('',ns[1:-1])
drafts=[]
for item in json.loads((source/'manifest.json').read_text())['items']:
    if platform=='desktop-message' and item['name'] not in ['image-viewer-default','image-viewer-zoomed','reaction-picker-empty','reaction-picker-custom','pending-file']:continue
    tree=E.parse(source/item['vector']).getroot()
    texts=[]
    images=[]
    display_name=item['name']
    if platform=='web' and item['name'].startswith('channels-'):
        metadata=json.loads((source/item['controls']).read_text())
        display_name=('Voice channel — ' if metadata.get('title','').endswith('AllChat Voice') else 'Conversation — ')+metadata.get('heading',item['name'])
    for parent in list(tree.iter()):
        for node in list(parent):
            if node.tag==ns+'text':
                marker=f'#fe{len(texts):04x}'
                texts.append(dict(node.attrib,text=''.join(node.itertext()),marker=marker))
                position=list(parent).index(node)
                parent.remove(node)
                parent.insert(position,E.Element(ns+'rect',{'x':node.get('x','0'),'y':node.get('y','0'),'width':'1','height':'1','fill':marker}))
            elif node.tag==ns+'image':
                marker=f'#fd{len(images):04x}'
                images.append(dict(node.attrib,marker=marker))
                position=list(parent).index(node);parent.remove(node)
                parent.insert(position,E.Element(ns+'rect',{'x':node.get('x','0'),'y':node.get('y','0'),'width':node.get('width','1'),'height':node.get('height','1'),'fill':marker}))
            elif node.tag==ns+'svg':
                x=float(node.get('x','0'));y=float(node.get('y','0'))
                vb=[float(v) for v in node.get('viewBox','0 0 24 24').split()]
                sx=float(node.get('width','24'))/vb[2];sy=float(node.get('height','24'))/vb[3]
                node.tag=ns+'g'
                node.set('transform',f'translate({x},{y}) scale({sx},{sy}) translate({-vb[0]},{-vb[1]})')
                for key in ['x','y','width','height','viewBox']:node.attrib.pop(key,None)
    drafts.append({'name':item['name'],'displayName':display_name,'svg':E.tostring(tree,encoding='unicode'),'texts':texts,'images':images,'width':float(tree.get('width','1280')),'height':float(tree.get('height','720')),'reference':(f'populated/{platform}-reference/' if platform!='sketchboard' else 'sketchboard-reference/')+item['screenshot'],'status':'draft; clipping, images, fonts and component extraction require verification'})
(root/f'{platform}-native-drafts.json').write_text(json.dumps(drafts,indent=2)+'\n')
print(f'Prepared {len(drafts)} native draft payloads.')
