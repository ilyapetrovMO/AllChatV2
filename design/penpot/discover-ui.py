#!/usr/bin/env python3
"""Source discovery only: candidates require human/agent review and runtime evidence."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
roots = ['internal/instance', 'desktop/src', 'mobile/src', 'mobile/App.tsx', 'mobile/android/app/src/main', 'mobile/ios']
paths = subprocess.check_output(['rg', '--files', *roots], cwd=ROOT, text=True).splitlines()
patterns = [
    ('component', r'\bfunction\s+([A-Z]\w*)\s*\('),
    ('web-template', r'template\.New\("([^"\n]+)"\)'),
    ('accessible-control', r'(?:aria-label|accessibilityLabel)\s*=\s*["\']([^"\']+)["\']'),
    ('html-control', r'<(button|input|select|textarea|dialog|summary)\b[^>]*>'),
    ('native-control', r'<(TouchableOpacity|Pressable|TextInput|Switch|Modal|ActivityIndicator)\b'),
]
items = []
for relative in sorted(set(paths)):
    p = ROOT / relative
    if p.suffix not in {'.tsx', '.ts', '.go', '.html', '.js', '.xml', '.kt', '.java', '.swift', '.m', '.mm'} or re.search(r'(?:\.test\.|_test\.go$|/__tests__/)', relative):
        continue
    source = p.read_text()
    platform = 'web' if relative.startswith('internal/') else relative.split('/')[0]
    for kind, pattern in patterns:
        for match in re.finditer(pattern, source):
            value = match.group(1)
            evidence = match.group(0)
            # Keep long one-line Go templates readable without dropping control identity.
            if kind == 'html-control':
                attributes = dict(re.findall(r'([\w-]+)="([^"]*)"', evidence))
                value = attributes.get('aria-label') or attributes.get('name') or attributes.get('id') or value
            line = source.count('\n', 0, match.start()) + 1
            identity = f'{relative}:{kind}:{match.start()}'
            items.append({'id': hashlib.sha256(identity.encode()).hexdigest()[:12], 'platform': platform, 'kind': kind, 'name': value, 'source': relative, 'line': line, 'offset': match.start(), 'evidence': evidence, 'status': 'candidate', 'penpot': None})
result = {'status': 'Unreviewed source discovery, not proof of complete coverage', 'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'limitations': ['Dynamic JSX expressions and generated controls require manual review.', 'Candidates can overlap; deduplicate into semantic inventory entries.', 'Native system surfaces and interaction states require runtime inspection.'], 'items': items}
(ROOT / 'design/penpot/inventory-candidates.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'candidates': len(items), 'byPlatform': {platform: sum(item['platform'] == platform for item in items) for platform in ['web', 'desktop', 'mobile']}}))
