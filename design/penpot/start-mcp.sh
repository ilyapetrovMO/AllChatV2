#!/usr/bin/env bash
# Official bridge source is installed outside node_modules so pnpm discovers its workspace.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME="$ROOT/.dev/penpot-mcp"
VERSION=2.15.4
mkdir -p "$RUNTIME"
if [[ ! -f "$RUNTIME/package.json" ]]; then
  ARCHIVE="$(npm pack "@penpot/mcp@$VERSION" --pack-destination "$RUNTIME" --silent)"
  tar -xzf "$RUNTIME/$ARCHIVE" -C "$RUNTIME" --strip-components=1
  rm "$RUNTIME/$ARCHIVE"
fi
node -e 'const p=require(process.argv[1]); if(p.version!==process.argv[2]) throw Error("Unexpected bridge version; inspect runtime before replacing it")' "$RUNTIME/package.json" "$VERSION"
if [[ ! -f "$RUNTIME/packages/server/dist/index.js" || ! -d "$RUNTIME/node_modules" ]]; then
  npm exec --yes --package=pnpm@10.31.0 -- pnpm --dir "$RUNTIME" install --no-frozen-lockfile
  npm exec --yes --package=pnpm@10.31.0 -- pnpm --dir "$RUNTIME" run build
fi
exec npm exec --yes --package=pnpm@10.31.0 -- pnpm --dir "$RUNTIME" run start
