#!/usr/bin/env python3
"""Reconcile source surfaces with authored evidence without treating drafts as coverage passes."""
import json
from pathlib import Path
root=Path(__file__).resolve().parent
repo=root.parent.parent
read=lambda name:json.loads((root/name).read_text())
coverage=read('coverage.json')['items']
links={i['id']:[] for i in coverage}
for m in read('web-source-mappings.json'):
    links[m['surfaceId']].append({'boardId':m['boardId'],'reference':m['capture'],'scope':m['routeState'],'status':'draft'})
desktop_map={
 'sign-in':'desktop-022','register':'desktop-022','account-recovery':'desktop-022',
 'community-home':'desktop-024','text-channel':'desktop-024','member-presence-menu':'desktop-024','community-menu':'desktop-024','conversation-notification-menu':'desktop-024',
 'settings-my-account':'desktop-024','settings-my-account-scroll-1':'desktop-024','settings-sessions':'desktop-024',
 'settings-safety':'desktop-041','settings-ringtone':'desktop-038','settings-notifications':'desktop-037','settings-notifications-scroll-1':'desktop-037',
 'admin-general':'desktop-032','admin-dashboard':'desktop-036','admin-channels':'desktop-032','admin-roles':'desktop-032','admin-invitations':'desktop-032','admin-soundboard':'desktop-032'}
for draft in read('desktop-native-progress.json'):
    name=draft['name'];surface='desktop-039' if name.startswith('settings-voice-video') else desktop_map.get(name)
    if surface:links[surface].append({'boardId':draft['boardId'],'reference':f'populated/desktop-reference/{name}.png','scope':name,'status':'draft'})
for draft in read('catalog-penpot.json')['editableScreenDrafts']:
    links['desktop-022'].append({'boardId':draft['boardId'],'reference':'populated/desktop-reference/add-instance.png','scope':'add-instance','status':'draft'})
for draft in read('mobile-native-progress.json')['boards']:
    links['mobile-057'].append({'boardId':draft['boardId'],'reference':f'mobile-reference/{"pinned-messages" if draft["mode"]=="pins" else "search-messages"}-dark.png','scope':draft['mode']+' empty dark','status':'draft'})
for draft in read('sketchboard-native-progress.json'):
    links['web-063'].append({'boardId':draft['boardId'],'reference':f'sketchboard-reference/{draft["name"]}.png','scope':draft['name'],'status':'draft'})
onboarding=read('mobile-onboarding-result.json')
links['mobile-042'].append({'boardId':onboarding['boardId'],'reference':'mobile-reference/add-instance-dark.png','scope':'empty dark onboarding','status':'draft'})
notifications=read('mobile-notifications-result.json')
links['mobile-061'].append({'boardId':notifications['mainId'],'reference':'mobile-reference/conversation-notifications-dark.png','scope':'channel notification card default dark','status':'draft'})
for draft in read('desktop-message-native-progress.json'):
    surface='desktop-031' if draft['name'].startswith('image-viewer') else 'desktop-026' if draft['name'].startswith('reaction-picker') else 'desktop-027'
    links[surface].append({'boardId':draft['boardId'],'reference':f'populated/desktop-message-reference/{draft["name"]}.png','scope':draft['name'],'status':'draft'})
for draft in read('mobile-call-banners.json'):
    links['mobile-045'].append({'boardId':draft['mainId'],'reference':None,'scope':draft['state']+' banner','status':'source-derived draft; runtime capture pending'})
for draft in read('mobile-volume-components.json'):
    links['mobile-048'].append({'boardId':draft['mainId'],'reference':None,'scope':str(draft['value']*100)+' percent volume','status':'source-derived draft; runtime capture pending'})
actions=read('mobile-message-actions.json')
links['mobile-056'].append({'boardId':actions['mainId'],'reference':'mobile-reference/own-message-actions-light.png','scope':'own non-deleted unpinned message, light','status':'draft'})
members=read('mobile-members-result.json')
links['mobile-058'].append({'boardId':members['boardId'],'reference':'mobile-reference/members-panel-light.png','scope':'cached owner and offline members, light','status':'draft'})
rows=[]
for item in coverage:
    source=repo/item['source'];lines=source.read_text().splitlines() if source.exists() else []
    found=[n+1 for n,line in enumerate(lines) if item['anchor'] in line]
    evidence=links[item['id']]
    rows.append({'id':item['id'],'platform':item['platform'],'name':item['name'],'source':item['source'],'anchor':item['anchor'],'currentAnchorLines':found,'sourceVerified':len(found)==1,'designEvidence':evidence,'referencesExist':all(bool(e['reference']) and (root/e['reference']).exists() for e in evidence),'coverage':'partial draft evidence' if evidence else 'no mapped editable design','visualVerification':'pending','allStatesReviewed':False})
result={'status':'INCOMPLETE: evidence reconciliation only; no surface is fully verified','surfaces':rows,'extraSurfaceInventory':'desktop-os-surfaces.json','candidateInventory':'inventory-candidates.json','gates':{'allSourceCandidatesReviewed':False,'allImplementedStatesMapped':False,'allControlsHaveReusableDesigns':False,'visualFidelityVerified':False,'tokenPropagationVerified':False,'nativeExportReimportVerified':False}}
(root/'coverage-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
md=['# Coverage evidence audit','','This audit links drafts to source surfaces. A link does not prove that every child widget or state is designed. All visual and completeness gates remain open.','','| Platform | Source surfaces | With mapped drafts | Without mapped drafts | Fully verified |','| --- | ---: | ---: | ---: | ---: |']
for p in ['web','desktop','mobile']:
    group=[r for r in rows if r['platform']==p];mapped=sum(bool(r['designEvidence']) for r in group);md.append(f'| {p} | {len(group)} | {mapped} | {len(group)-mapped} | 0 |')
md+=['','## Surfaces without mapped editable designs','']
md += [f'- {r["id"]}: {r["name"]} — `{r["source"]}`' for r in rows if not r['designEvidence']]
md+=['','Additional desktop OS surfaces are listed in `desktop-os-surfaces.json`. The 853 discovery candidates remain unreviewed; this initial surface list is not exhaustive.','']
(root/'coverage-evidence.md').write_text('\n'.join(md))
print(f'{len(rows)} source surfaces; {sum(bool(r["designEvidence"]) for r in rows)} with partial draft evidence; {sum(not r["sourceVerified"] for r in rows)} unresolved source anchors; zero fully verified.')
