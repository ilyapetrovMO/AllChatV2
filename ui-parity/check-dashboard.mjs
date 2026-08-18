import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = fs.readFileSync(path.join(root, "ui-parity", "manifest.yaml"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "ui-parity", "parity.md"), "utf8");
const statusIcon = { verified: "✅", partial: "⚠️", missing: "❌", intentional: "➖" };

const screensSource = manifest.match(/\nscreens:\n([\s\S]*?)\nflows:\n/)?.[1];
if (!screensSource) throw new Error("manifest.yaml has no screens section");

const blocks = [...screensSource.matchAll(/^  ([a-z0-9-]+):\n([\s\S]*?)(?=^  [a-z0-9-]+:\n|(?![\s\S]))/gm)];
if (!blocks.length) throw new Error("manifest.yaml has no screen entries");

for (const [, id, block] of blocks) {
  const name = block.match(/^    dashboard_name: (.+)$/m)?.[1];
  const overall = block.match(/^    overall: (verified|partial|missing|intentional)$/m)?.[1];
  if (!name || !overall) throw new Error(`Screen ${id} is missing dashboard_name or overall`);
  const row = dashboard.split("\n").find(line => line.startsWith(`| ${name} |`));
  if (!row) throw new Error(`parity.md has no summary row for ${name}`);
  if (!row.trim().endsWith(`| ${statusIcon[overall]} |`)) {
    throw new Error(`${name} overall status does not match manifest (${overall})`);
  }
}

const flowsSource = manifest.match(/\nflows:\n([\s\S]*?)\nintentional_differences:\n/)?.[1];
if (!flowsSource) throw new Error("manifest.yaml has no flows section");
const flows = [...flowsSource.matchAll(/^  - id: ([a-z0-9-]+)\n([\s\S]*?)(?=^  - id: |(?![\s\S]))/gm)];
for (const [, id, block] of flows) {
  const name = block.match(/^    dashboard_name: (.+)$/m)?.[1];
  const status = block.match(/^    status: (verified|partial|missing|intentional)$/m)?.[1];
  if (!name || !status) throw new Error(`Flow ${id} is missing dashboard_name or status`);
  const row = dashboard.split("\n").find(line => line.startsWith(`| ${name} |`));
  if (!row || !row.trim().endsWith(`| ${statusIcon[status]} |`)) {
    throw new Error(`Critical flow ${name} does not match manifest (${status})`);
  }
}
if (!flows.length) throw new Error("manifest.yaml has no flows");

console.log(`Parity dashboard is synchronized: ${blocks.length} screens, ${flows.length} critical flows.`);
