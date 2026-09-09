#!/usr/bin/env python3
"""Tap an accessible control on the dedicated design emulator."""
import re,subprocess,sys,xml.etree.ElementTree as E
adb=['/mnt/c/Users/bigboss/AppData/Local/Android/Sdk/platform-tools/adb.exe','-P','5038','-s','emulator-5556']
if subprocess.check_output(adb+['emu','avd','name'],text=True).splitlines()[0]!='AllChatDesignCatalog':raise SystemExit('Unexpected emulator')
subprocess.run(adb+['shell','uiautomator','dump','/sdcard/allchat-design.xml'],check=True,stdout=subprocess.DEVNULL)
root=E.fromstring(subprocess.check_output(adb+['exec-out','cat','/sdcard/allchat-design.xml']))
nodes=[n for n in root.iter('node') if n.get('content-desc')==sys.argv[1] and n.get('clickable')=='true']
if len(nodes)!=1:raise SystemExit(f'Expected one matching control, found {len(nodes)}')
x1,y1,x2,y2=map(int,re.findall(r'\d+',nodes[0].get('bounds')))
subprocess.run(adb+['shell','input','tap',str((x1+x2)//2),str((y1+y2)//2)],check=True)
