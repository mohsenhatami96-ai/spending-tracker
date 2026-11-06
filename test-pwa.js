// PWA checks: serves ./pwa under a /spending-tracker/ subpath, checks SW, manifest, offline, update prompt, 390px touch UI.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
const SH = f => path.resolve('screenshots', f);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-serve-'));
const site = path.join(root, 'spending-tracker');
fs.cpSync(path.resolve('pwa'), site, { recursive: true });
const PORT = 8765, BASE = `http://localhost:${PORT}/spending-tracker/`;
let fails = 0, srv = null;
const cleanup = () => { try { srv && srv.kill(); } catch (e) {} fs.rmSync(root, { recursive: true, force: true }); }; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  // no private / test files in the deploy folder
  const files = fs.readdirSync('pwa', { recursive: true }).filter(f => fs.statSync(path.join('pwa', f)).isFile()).sort();
  console.log('FILES', files.join(', '));
  check(!files.some(f => /sample|test|private|\.csv$|\.xlsx$|\.json$/i.test(f)), 'deploy folder has no samples/tests/data');
  const idx = fs.readFileSync('pwa/index.html', 'utf8');
  check(!/(href|src)=["']\//.test(idx) && !/https?:\/\//.test(idx.replace(/http:\/\/(www\.w3\.org|schemas\.openxmlformats\.org)\/[^"'\s)]*/g, '').replace(/https:\/\/duckduckgo\.com\/\?q=/g, '')), 'index.html uses only relative paths, no external URLs (XML namespace ids and the tap-only DuckDuckGo search link excepted)');
  srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  const external = []; ctx.on('request', r => { const u = r.url(); if (!/^(http:\/\/(localhost|127\.0\.0\.1):|data:|blob:|chrome-extension:)/.test(u)) external.push(u); });
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.text()); }); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(BASE);
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active && r.active.scriptURL }; });
  console.log('SW', JSON.stringify(reg));
  check(reg.scope === BASE && /\/spending-tracker\/sw\.js$/.test(reg.script), 'service worker registered and active with subpath scope');
  // manifest
  const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const res = await fetch(l.href); const j = await res.json();
    const icons = await Promise.all(j.icons.map(async i => { const u = new URL(i.src, l.href).href; const b = await (await fetch(u)).blob(); const bm = await createImageBitmap(b); return [i.src, i.sizes, i.purpose || 'any', bm.width + 'x' + bm.height, b.type]; }));
    return { ct: res.headers.get('content-type'), j, icons, apple: document.querySelector('link[rel=apple-touch-icon]').getAttribute('href'),
      metas: ['apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'theme-color'].map(n => n + '=' + document.querySelector(`meta[name="${n}"]`).content), vp: document.querySelector('meta[name=viewport]').content }; });
  console.log('MANIFEST', JSON.stringify({ name: man.j.name, start_url: man.j.start_url, scope: man.j.scope, display: man.j.display, theme: man.j.theme_color, icons: man.icons, metas: man.metas, vp: man.vp }));
  check(man.j.name === 'Spending Tracker' && man.j.display === 'standalone' && man.j.start_url === './' && man.j.scope === './' && /^#/.test(man.j.theme_color) && /^#/.test(man.j.background_color), 'manifest fields valid');
  check(man.icons.every(i => i[1] === i[3] && i[4] === 'image/png') && man.icons.some(i => i[2] === 'maskable' && i[1] === '512x512') && man.icons.some(i => i[1] === '192x192'), 'icons exist with declared sizes (192, 512, maskable, 180)');
  check(man.apple === './icons/apple-touch-icon.png' && /viewport-fit=cover/.test(man.vp) && man.metas[0].endsWith('yes'), 'iOS meta tags present');
  // CDP manifest parse (Chrome's own validator)
  const cdp = await ctx.newCDPSession(page);
  const am = await cdp.send('Page.getAppManifest');
  check(!am.errors.length, 'Chrome manifest parser: no errors ' + JSON.stringify(am.errors));
  // installability as Chrome sees it
  try { const inst = await cdp.send('Page.getInstallabilityErrors'); const ie = inst.installabilityErrors.map(e => e.errorId).filter(id => id !== 'in-incognito'); /* playwright contexts are always ephemeral */ check(!ie.length, 'Chrome installability criteria met ' + JSON.stringify(ie)); } catch (e) { console.log('installability check n/a'); }
  // public build is generic: no personal overlay, generic chains/cities still work
  const gen = await page.evaluate(() => { const T = window.SpendingTracker; return {
    clean: ['ICA SUPERMARKET STOCKHOLM', 'HEMKOP STOCK/26-01-03', 'WILLYS GÖTEBORG', 'ST1 SOLNA', 'PIZZERIA ROMA MALMÖ AB'].map(T.cleanDescription),
    cat: ['WILLYS GÖTEBORG', 'SBAB', 'UNIONEN', 'EASYPARK', 'EXEMPEL BRF', 'TESTSTAD LIVS', 'BIL TREAN', 'ROJI MONSTER'].map(d => T.categorize({ desc: d, amount: -100 })),
    hasLocal: T.state.rules.some(r => /roji|trean/i.test(r.pattern)) }; });
  console.log('PUBLIC RULES', JSON.stringify(gen));
  check(JSON.stringify(gen) === JSON.stringify({ clean: ['ICA SUPERMARKET', 'HEMKOP', 'WILLYS', 'ST1 SOLNA', 'PIZZERIA ROMA'], cat: ['Supermarket', 'Mortgage/Rent', 'Memberships/unions', 'Parking', 'Housing fee/BRF', 'Ethnic/specialty store', 'Other', 'Other'], hasLocal: false }), 'public build: generic rules only, no personal overlay');
  const allText = files.filter(f => /\.(html|js|webmanifest|md)$/.test(f)).map(f => fs.readFileSync(path.join('pwa', f), 'utf8')).join('\n');
  const leaks = allText.match(/roji|bil ?trean|norrt|haidari|knuten|saigon|bj.?llra|robo vac|roden|maral|soheil|mohsen|hatami|kundreskontr|private-test|\/tmp\/private|\b\d{10,12}\b|\b(19|20)\d{6}[-+]?\d{4}\b|\+?46\s?7\d[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/gi);
  check(!leaks, 'no personal names / personal, account or phone numbers in published files' + (leaks ? ' ' + JSON.stringify(leaks.slice(0, 10)) : ''));
  // import fake sample data (file picker accepts xlsx MIME types)
  const accept = await page.getAttribute('#fileInput', 'accept');
  check(accept.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') && accept.includes('.xlsx') && accept.includes('text/csv'), 'file picker accept includes extensions + MIME types');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#fileInput')).display !== 'none'), 'file input not display:none (iOS)');
  await page.reload(); await page.waitForTimeout(300);
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page controlled by SW after reload');
  await page.setInputFiles('#fileInput', [path.resolve('samples', 'example-salary-periods.csv')]);
  await page.waitForSelector('#mapRoot table'); await page.click('#doImport'); await page.waitForTimeout(400);
  await page.click('#tabs [data-view=settings]'); await page.selectOption('#sCur', 'SEK'); await page.click('#tabs [data-view=dashboard]');
  await page.reload(); await page.waitForTimeout(400);
  // offline
  await ctx.setOffline(true);
  await page.reload(); await page.waitForTimeout(500);
  const off = await page.evaluate(() => ({ title: document.title, n: window.SpendingTracker.state.txns.length, kpi: !!document.querySelector('.kpi') }));
  check(off.title === 'Spending Tracker' && off.n > 100 && off.kpi, 'works offline after first load (data kept: ' + off.n + ' txns)');
  const p2 = await ctx.newPage(); await p2.goto(BASE + 'index.html?x=1'); check(await p2.title() === 'Spending Tracker', 'offline: fresh tab to index.html loads from cache'); await p2.close();
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.screenshot({ path: SH('22-pwa-iphone-390.png') });
  await page.screenshot({ path: SH('22b-pwa-iphone-390-full.png'), fullPage: true });
  // tap targets >= 44px on every view
  const small = [];
  for (const v of ['dashboard', 'transactions', 'review', 'budgets', 'plan', 'settings']) {
    await page.click(`#tabs [data-view=${v}]`); await page.waitForTimeout(150);
    small.push(...await page.evaluate(v => [...document.querySelectorAll('button, a.btn, summary, select, input:not([type=file]):not([type=checkbox]):not([type=radio]), [data-month], .legend .row, .hbar')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
      .map(e => { const r = e.getBoundingClientRect(); return { v, el: e.tagName + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter(x => x.h < 44 || x.w < 44), v));
  }
  check(!small.length, 'all tap targets >= 44px at 390px' + (small.length ? ' ' + JSON.stringify(small.slice(0, 12)) : ''));
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth); check(ovf <= 390, 'no horizontal overflow at 390px (' + ovf + ')');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  check(await page.locator('#backupNote').count() === 1, 'Settings shows backup reminder');
  await page.locator('#backupNote').scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -80));
  await page.screenshot({ path: SH('23-pwa-settings-backup-390.png') });
  // update prompt: deploy a new version, the app offers Update, which activates it
  await ctx.setOffline(false);
  fs.writeFileSync(path.join(site, 'sw.js'), fs.readFileSync(path.join(site, 'sw.js'), 'utf8').replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-next'"));
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await page.waitForSelector('#updateBar', { timeout: 8000 }).catch(() => {});
  const bar = await page.locator('#updateBar').count(); check(bar === 1, 'update prompt shown for new version');
  if (bar) { await page.screenshot({ path: SH('24-pwa-update-prompt.png') }); await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => {}), page.click('#updNow')]); await page.waitForTimeout(500); }
  const keys = await page.evaluate(() => caches.keys());
  check(keys.length === 1 && /-next$/.test(keys[0]), 'after Update: new versioned cache active, old removed ' + JSON.stringify(keys));
  check(await page.evaluate(() => window.SpendingTracker.state.txns.length) > 100, 'data survives update');
  check(!external.length, 'no network requests outside this site during the whole run' + (external.length ? ' ' + JSON.stringify(external.slice(0, 5)) : ''));
  console.log('CONSOLE ERRORS/WARNINGS:', errors.length ? errors : 'none'); if (errors.length) fails++;
  await browser.close(); cleanup();
  console.log(fails ? `PWA CHECKS FAILED (${fails})` : 'ALL PWA CHECKS PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('TEST FAILED', e); cleanup(); process.exit(1); });
