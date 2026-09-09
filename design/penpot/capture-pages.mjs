import fs from 'node:fs/promises';
import path from 'node:path';
import {captureVector} from './capture-vector.mjs';

// Only call with the disposable fixture context created by capture.mjs.
export async function capturePages(context, directory) {
  const output = path.join(directory, 'web-reference');
  await fs.mkdir(output, {recursive: true});
  const routes = ['/', '/profile', '/sessions', '/voice-video', '/ringtone', '/admin/settings', '/admin/channels', '/admin/roles', '/admin/invitations', '/admin/soundboard', '/admin/activities', '/activities', '/dms', '/search'];
  const manifest = [];
  const discovery = await context.newPage();
  try {
    await discovery.goto('/');
    const channels = await discovery.locator('a[href^="/channels/"]').evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('href')))]);
    routes.push('/admin/dashboard', ...channels);
  } finally {await discovery.close();}
  let page = await context.newPage();
  let guest;
  const baseURL = (await context.request.get('/login')).url().split('/login')[0];
  try {
    for (const route of [...routes, '/login', '/recover', '/join']) {
      if (route === '/login') {
        await page.close();
        guest = await context.browser().newContext({baseURL, viewport:{width:1280,height:720},locale:'en-US',reducedMotion:'reduce'});
        page = await guest.newPage();
      }
      const response = await page.goto(route);
      if (!response?.ok() || new URL(page.url()).pathname !== route) throw new Error(`Unexpected response or redirect for ${route}`);
      if (route === '/admin/dashboard') await page.locator('[data-dashboard-stats] .dashboard-stat').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
      const name = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
      const data = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('button,input:not([type=hidden]),select,textarea,a,summary,[role=button]')].map(element => {
          const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
          return {tag: element.tagName.toLowerCase(), id: element.id, name: element.getAttribute('name'), type: element.getAttribute('type'), label: element.getAttribute('aria-label') || element.textContent.trim() || element.getAttribute('placeholder') || element.labels?.[0]?.textContent.trim() || '', disabled: Boolean(element.disabled), visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden', x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: style.color, background: style.backgroundColor, fontSize: style.fontSize, radius: style.borderRadius};
        });
        return {title: document.title, heading: document.querySelector('h1')?.textContent.trim(), controls};
      });
      await page.screenshot({path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled'});
      await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
      const visual = await captureVector(page, {fullPage:true});
      await fs.writeFile(path.join(output, `${name}.svg`), visual.svg);
      manifest.push({name, vector: `${name}.svg`, width:visual.width, height:visual.height, route, screenshot: `${name}.png`, controls: `${name}.json`, status: 'captured-unreviewed', viewport: {width: 1280, height: 720}, fullPage: true});
    }
  } finally { await page.close(); await guest?.close(); }
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({fixture: 'disposable owner and signed-out contexts; current default and empty states only', items: manifest}, null, 2) + '\n');
  console.log(`Captured ${manifest.length} web pages and rendered control inventories.`);
}
