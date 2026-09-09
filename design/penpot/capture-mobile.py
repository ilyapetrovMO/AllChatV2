#!/usr/bin/env python3
"""Capture only the dedicated catalog emulator; never choose a personal device."""
import argparse,json,re,struct,subprocess
from pathlib import Path
import xml.etree.ElementTree as E
p=argparse.ArgumentParser();p.add_argument('name');p.add_argument('--theme',choices=['light','dark']);args=p.parse_args()
if not re.fullmatch(r'[a-z0-9-]+',args.name):raise SystemExit('Use a lowercase capture name')
adb=['/mnt/c/Users/bigboss/AppData/Local/Android/Sdk/platform-tools/adb.exe','-P','5038','-s','emulator-5556']
name=subprocess.check_output(adb+['emu','avd','name'],text=True).strip().splitlines()[0]
if name!='AllChatDesignCatalog':raise SystemExit('Refusing to capture an unexpected device')
if args.theme:subprocess.run(adb+['shell','cmd','uimode','night','yes' if args.theme=='dark' else 'no'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(adb+['shell','uiautomator','dump','/sdcard/allchat-design.xml'],check=True,stdout=subprocess.DEVNULL)
xml=E.fromstring(subprocess.check_output(adb+['exec-out','cat','/sdcard/allchat-design.xml']))
for node in xml.iter('node'):
 if node.get('password')=='true':node.set('text','[redacted]')
output=Path(__file__).resolve().parent/'mobile-reference';output.mkdir(exist_ok=True)
E.ElementTree(xml).write(output/f'{args.name}.xml',encoding='utf-8',xml_declaration=True)
image=subprocess.check_output(adb+['exec-out','screencap','-p']);(output/f'{args.name}.png').write_bytes(image)
width,height=struct.unpack('>II',image[16:24])
manifest=output/'manifest.json';data=json.loads(manifest.read_text()) if manifest.exists() else {'platform':'Android 35 Pixel 7 emulator','items':[]}
data['items']=[x for x in data['items'] if x['name']!=args.name]
data['items'].append({'name':args.name,'theme':args.theme,'screenshot':args.name+'.png','hierarchy':args.name+'.xml','pixels':{'width':width,'height':height},'status':'native capture; design comparison pending'})
manifest.write_text(json.dumps(data,indent=2)+'\n');print(f'Captured {args.name}: {width}×{height}')
