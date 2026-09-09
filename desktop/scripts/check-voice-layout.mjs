import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const fixture = `<!doctype html><div id="root"></div><script type="module">
import React from 'react';
import ReactDOMClient from 'react-dom/client';
import ReactDOM from 'react-dom';
import { VoiceParticipantGrid } from '/src/renderer/voice-grid.tsx';
import { CallParticipantCell } from '/src/renderer/call-participant-cell.tsx';
import '/src/renderer/styles.css';
const { useState } = React;
const { flushSync } = ReactDOM;
const root = ReactDOMClient.createRoot(document.getElementById('root'));
function Room({count}) {
  const [focused, setFocused] = useState(null);
  return React.createElement('section', {className:'media-stage voice-room-stage', style:{width:'calc(100vw - 312px)', height:'calc(100vh - 76px)', marginLeft:312, marginTop:76}},
    React.createElement(VoiceParticipantGrid, {count}, count ? Array.from({length:count}, (_, i) =>
      React.createElement(CallParticipantCell, {key:i, name:'Alex', onAction:async()=>undefined, className:'speaking'+(focused===i?' expanded':''), onClick:()=>setFocused(focused===i?null:i)},
        React.createElement('strong', null, i?'Sam':'A member with a very long display name'),
        i===2 && React.createElement('span', null, 'Sharing screen')))
      : React.createElement('p', {className:'media-stage-empty'}, 'No one is connected')));
}
window.renderParticipants = count => flushSync(()=>root.render(React.createElement(Room,{count})));
window.renderParticipants(0);
</script>`;

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react(), {
    name: 'voice-grid-fixture',
    configureServer(server) {
      server.middlewares.use('/voice-grid-check', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/voice-grid-check', fixture));
      });
    },
  }],
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-dom'] },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}voice-grid-check`);
  await page.waitForFunction(() => typeof window.renderParticipants === 'function');
  for (const [width, height] of [[960,640], [1120,800], [1280,800], [1600,900]]) {
    await page.setViewportSize({ width, height });
    for (const count of [0,1,2,3,4,5,6,7,8,12]) {
      await page.evaluate(count => window.renderParticipants(count), count);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const result = await page.evaluate(() => {
        const box = e => {const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};};
        return {grid:box(document.querySelector('.voice-participant-grid')), tiles:[...document.querySelectorAll('.voice-grid-cell')].map(cell=>({
          ...box(cell), contents:[...cell.querySelectorAll('.media-stage-avatar, strong, article > span')].map(box),
        }))};
      });
      const {grid, tiles} = result;
      assert.equal(tiles.length,count);
      if (!count) continue;
      const optimum = Math.max(...Array.from({length:count},(_,i)=>Math.min((grid.w-i*12)/(i+1), (grid.h-(Math.ceil(count/(i+1))-1)*12)/Math.ceil(count/(i+1))*16/9)));
      const rows = new Map();
      for (const tile of tiles) {
        assert.ok(Math.abs(tile.w-optimum)<.1, `Non-optimal cell at ${width}x${height}, count=${count}`);
        assert.ok(Math.abs(tile.w-tile.h*16/9)<.1, 'Cells must remain 16:9');
        assert.ok(tile.x>=grid.x-.1 && tile.y>=grid.y-.1 && tile.x+tile.w<=grid.x+grid.w+.1 && tile.y+tile.h<=grid.y+grid.h+.1, 'Grid must fit above controls');
        for (const c of tile.contents) assert.ok(c.x>=tile.x+4 && c.y>=tile.y+4 && c.x+c.w<=tile.x+tile.w-4 && c.y+c.h<=tile.y+tile.h-4, `Contents overflow at ${width}x${height}, count=${count}: ${JSON.stringify({tile,c})}`);
        const rowKey = Math.round(tile.y*10);
        rows.set(rowKey,[...(rows.get(rowKey)||[]),tile]);
      }
      for (const row of rows.values()) {
        assert.ok(Math.abs((row[0].x+row.at(-1).x+row.at(-1).w)/2-(grid.x+grid.w/2))<.1,'Each row must be centered');
        for(let i=1;i<row.length;i++) assert.ok(Math.abs(row[i].x-row[i-1].x-row[i-1].w-12)<.1,'Consistent gaps');
      }
    }
  }
  await page.evaluate(()=>window.renderParticipants(7));
  const before = await page.locator('.voice-grid-cell').evaluateAll(cells=>cells.map(c=>({x:c.offsetLeft,y:c.offsetTop})));
  await page.locator('.participant-tile').first().click();
  assert.equal(await page.locator('.participant-tile.expanded').count(),1);
  assert.deepEqual(await page.locator('.voice-grid-cell').evaluateAll(cells=>cells.map(c=>({x:c.offsetLeft,y:c.offsetTop}))),before,'Focusing must preserve other cells');
  await page.locator('.participant-tile.expanded').click();
  assert.equal(await page.locator('.participant-tile.expanded').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Voice grids pass: 0–12 participants, 960–1600px, resizing, 16:9 maximum size, centered rows, containment, and focus.');
} finally {
  await browser.close();
  await server.close();
}
