const fs = require('fs');
const path = require('path');

const filename = path.join(__dirname, 'scenarios.json');
const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
const allowedTiers = new Set(['pr', 'full', 'nightly']);
const allowedSessions = new Set(['voice_room', 'direct_call']);
const seen = new Set();

if (manifest.schema !== 'allchat.media.scenarios/v1' || !Array.isArray(manifest.scenarios)) {
  throw new Error('media scenario manifest has an unsupported schema');
}
for (const scenario of manifest.scenarios) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario.id || '')) throw new Error(`invalid scenario id: ${scenario.id}`);
  if (seen.has(scenario.id)) throw new Error(`duplicate scenario id: ${scenario.id}`);
  seen.add(scenario.id);
  if (!scenario.tiers?.length || scenario.tiers.some(tier => !allowedTiers.has(tier))) throw new Error(`${scenario.id}: invalid tiers`);
  if (!scenario.sessions?.length || scenario.sessions.some(session => !allowedSessions.has(session))) throw new Error(`${scenario.id}: invalid sessions`);
  if (!scenario.tiers.includes('nightly')) throw new Error(`${scenario.id}: every scenario must run nightly`);
}
process.stdout.write(`validated ${seen.size} media scenarios\n`);
