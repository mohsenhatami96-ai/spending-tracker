// Builds the deployable PWA folder ./pwa from the modular source (no samples, tests or personal data).
// Usage: node build-pwa.js   -> then publish the contents of ./pwa (e.g. GitHub Pages). All paths are relative.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chromium } from 'playwright-core';

const OUT = path.resolve('pwa');
const THEME = '#4f6bed', BG = '#f4f6fb';

const glyph = (cx, cy, r, sw) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${sw}"/><path d="M${cx} ${cy}V${cy - r + sw * 0.8}A${r - sw * 0.8} ${r - sw * 0.8} 0 0 1 ${cx + r - sw * 0.8} ${cy}Z" fill="#fff"/>`;
const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${THEME}"/><stop offset="1" stop-color="#a66cff"/></linearGradient></defs>`;
const svgIcon = kind => {
  const tile = kind === 'any' ? '<rect x="16" y="16" width="480" height="480" rx="110" fill="url(#g)"/>' : '<rect width="512" height="512" fill="url(#g)"/>';
  const g = kind === 'maskable' ? glyph(256, 256, 118, 30) : glyph(256, 256, 150, 38);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${grad}${tile}${g}</svg>`;
};
const ICONS = [['apple-touch-icon.png', 180, 'full'], ['icon-192.png', 192, 'any'], ['icon-512.png', 512, 'any'], ['icon-maskable-192.png', 192, 'maskable'], ['icon-maskable-512.png', 512, 'maskable'], ['favicon-32.png', 32, 'any']];

function walkJs(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walkJs(p, base));
    else if (name.endsWith('.js')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  for (const [name, size, kind] of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svgIcon(kind).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, 'icons', name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();

  // Slim HTML shell + PWA head tags
  let html = fs.readFileSync('spending-tracker.html', 'utf8');
  const head = `<meta name="theme-color" content="${THEME}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171b24" media="(prefers-color-scheme: dark)">
<meta name="description" content="Private, offline spending tracker. Your data stays on this device.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Spending">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="./icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="./icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="./icons/icon-192.png">
`;
  if (!html.includes('viewport-fit=cover')) throw new Error('viewport-fit=cover missing');
  html = html.replace('<title>Spending Tracker</title>', head + '<title>Spending Tracker</title>');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  // Copy modular assets
  fs.copyFileSync('styles.css', path.join(OUT, 'styles.css'));
  fs.copyFileSync('app.js', path.join(OUT, 'app.js'));
  copyDir('domain', path.join(OUT, 'domain'));
  copyDir('storage', path.join(OUT, 'storage'));
  copyDir('ui', path.join(OUT, 'ui'));

  // Strip private local rules from published domain/local.js
  const PRIV = /\/\* @private-begin[\s\S]*?@private-end \*\//;
  let localJs = fs.readFileSync(path.join(OUT, 'domain', 'local.js'), 'utf8');
  if (!PRIV.test(localJs)) throw new Error('private block not found in domain/local.js');
  localJs = localJs.replace(PRIV, '/* Generic build: no local/personal rules. */\nexport const LOCAL_RULES = {};\nexport const LOCAL_CITIES = [];\nexport const LOCAL_LOC_ABBR = [];\n');
  fs.writeFileSync(path.join(OUT, 'domain', 'local.js'), localJs);

  const DENY = /roji|bil ?trean|norrt|haidari|knuten|saigon|bj.?llra|robo vac|roden|kundreskontr|'mos'|'sw'|solna|åkersberga|@private/i;
  const pubFiles = [];
  function collect(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) collect(p);
      else if (/\.(js|html|css|webmanifest|md)$/.test(name)) pubFiles.push(p);
    }
  }
  collect(OUT);
  for (const f of pubFiles) {
    const hit = fs.readFileSync(f, 'utf8').match(DENY);
    if (hit) throw new Error('personal term left in public build: ' + hit[0] + ' in ' + f);
  }

  const manifest = {
    id: './', name: 'Spending Tracker', short_name: 'Spending', description: 'Private, offline spending tracker. Your data stays on this device.',
    start_url: './', scope: './', display: 'standalone', orientation: 'any', background_color: BG, theme_color: THEME, lang: 'en', categories: ['finance', 'productivity'],
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' } ]
  };
  fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

  const modules = [
    './styles.css', './app.js',
    ...walkJs(path.join(OUT, 'domain')).map(f => './domain/' + f),
    ...walkJs(path.join(OUT, 'storage')).map(f => './storage/' + f),
    ...walkJs(path.join(OUT, 'ui')).map(f => './ui/' + f)
  ];
  const shell = ['./', './index.html', './manifest.webmanifest']
    .concat(ICONS.map(i => './icons/' + i[0]))
    .concat(modules);

  const h = crypto.createHash('sha256');
  shell.slice(1).forEach(f => h.update(fs.readFileSync(path.join(OUT, f))));
  const version = h.digest('hex').slice(0, 10);
  fs.writeFileSync(path.join(OUT, 'sw.js'), `/* Spending Tracker service worker: caches the app shell for full offline use. Data is never sent anywhere. */
const VERSION = '${version}';
const CACHE = 'spending-tracker-' + VERSION;
const SHELL = ${JSON.stringify(shell)};
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('spending-tracker-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
`);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Spending Tracker (installable web app)

Static files only; publish this folder as-is (for example GitHub Pages: Settings → Pages → deploy from a branch, folder with these files).
All paths are relative, so it works at \`https://<user>.github.io/<repo-name>/\`.

On iPhone: open the URL in Safari → Share → **Add to Home Screen**. After the first load it works fully offline.
Your data is stored only on the device (localStorage of the installed app); nothing is uploaded. iOS can clear website data
for apps that aren't used for a while, and removing the Home Screen icon removes its data: export a JSON backup from Settings regularly.

Merchant dictionary (built in, offline): about 5,700 Swedish merchant names mapped to categories, compiled from
the [name-suggestion-index](https://github.com/osmlab/name-suggestion-index) (BSD-3-Clause; brand names © OpenStreetMap contributors, ODbL),
[Wikidata](https://www.wikidata.org) (CC0) and a hand-compiled list of Swedish chains. Your own rules always win over the dictionary.

Rebuild after changing the modular source: \`node build-pwa.js\` (the cache version changes and installed apps show an "Update" prompt).
`);
  console.log('built', OUT, 'version', version, 'modules', modules.length);
})().catch(e => { console.error(e); process.exit(1); });
