import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const directory = path.dirname(new URL(import.meta.url).pathname);
const source = fs.readFileSync(path.join(directory, "parity.md"), "utf8");
const sourceHash = crypto.createHash("sha256").update(source).digest("hex");

const escape = value => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const inline = value => escape(value)
  .replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/`([^`]+)`/g, "<code>$1</code>");

function renderMarkdown(markdown) {
  const lines = markdown.trim().split("\n");
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) {
      const level = heading[1].length;
      const id = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      output.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        rows.push(lines[index].split("|").slice(1, -1).map(cell => cell.trim()));
        index += 1;
      }
      const [head, separator, ...body] = rows;
      if (!separator?.every(cell => /^:?-+:?$/.test(cell))) throw new Error("Malformed Markdown table");
      output.push(`<div class="table-scroll"><table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (line.startsWith("- ")) {
      const items = [];
      while (index < lines.length && lines[index].startsWith("- ")) {
        items.push(`<li>${inline(lines[index].slice(2))}</li>`);
        index += 1;
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}) |^\| |^- /.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return output.join("\n");
}

const body = renderMarkdown(source);
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="parity-source-sha256" content="${sourceHash}">
  <title>Web → Electron Parity</title>
  <style>
    :root { color-scheme: dark; --bg:#18191e; --panel:#202127; --line:#34363e; --text:#f2f3f5; --muted:#a8acb8; --brand:#5865f2; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 Inter, ui-sans-serif, system-ui, sans-serif; }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:40px 0 80px; }
    h1 { margin:0 0 8px; font-size:clamp(1.9rem,4vw,3rem); }
    h2 { margin:38px 0 14px; padding-top:10px; border-top:1px solid var(--line); }
    h3 { margin:26px 0 8px; }
    p, li { color:var(--muted); }
    a { color:#aeb4ff; }
    code { padding:2px 5px; border-radius:4px; background:var(--panel); }
    .table-scroll { overflow:auto; margin:16px 0 22px; border:1px solid var(--line); border-radius:8px; }
    table { width:100%; border-collapse:collapse; background:var(--panel); }
    th, td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
    th { position:sticky; top:0; background:#26282f; color:var(--text); }
    tr:last-child td { border-bottom:0; }
    td:not(:first-child) { text-align:center; }
    ul { padding-left:22px; }
    footer { margin-top:48px; color:#747987; font-size:.8rem; }
  </style>
</head>
<body><main>${body}<footer>Generated from <code>ui-parity/parity.md</code>. Source SHA-256: ${sourceHash.slice(0, 12)}</footer></main></body>
</html>
`;

fs.writeFileSync(path.join(directory, "report.html"), html);
console.log(`Generated ui-parity/report.html from parity.md (${sourceHash.slice(0, 12)}).`);
