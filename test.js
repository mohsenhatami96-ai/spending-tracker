import { chromium } from 'playwright-core';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 8766;
const URL = `http://127.0.0.1:${PORT}/spending-tracker.html`;

const S = f => path.resolve('samples', f);
const SH = f => path.resolve('screenshots', f);
const clean = p => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
// searchable category picker helpers
const pickCat = async (p, trigger, name, query) => { await trigger.click(); await p.waitForSelector('#catPop'); if (query) await p.fill('#catPopInput', query); await p.locator(`#catPop .cp-opt[data-v="${name}"]`).first().click(); await p.waitForTimeout(80); };
const setCats = async (p, names) => { while (await p.locator('#fCats [data-chipx]').count()) await p.locator('#fCats [data-chipx]').first().click();
  for (const n of names) { await p.click('#fCatAdd'); await p.waitForSelector('#catPop'); await p.locator(`#catPop .cp-opt[data-v="${n}"]`).first().click(); await p.click('#catPopDone'); await p.waitForTimeout(60); } };
const A = S('example-bank-A_iso_comma.csv'), B = S('example-bank-B_dmy_semicolon_debitcredit.csv'), C = S('example-card-C_mdy_positive_purchases.csv');
(async () => {
  const srv = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (urlPath === '/') urlPath = '/spending-tracker.html';
    const file = path.join(ROOT, urlPath.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const isNoise = t => /favicon\.ico|Failed to load resource: the server responded with a status of 404/.test(t) && /favicon/i.test(t);
  const hook = p => { p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !isNoise(m.text())) errors.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', acceptDownloads: true });
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL);
  await clean(page); await page.screenshot({ path: SH('00-empty-state.png') });

  // unit checks
  const unit = await page.evaluate(() => {
    const T = window.SpendingTracker;
    return {
      csv: T.parseCSV('a,"b, c","say ""hi""\nthere"\r\n1,2,3\n', ','),
      amounts: ['1,234.56', '-12.30', '(45.00)', '1.234,56', '12,5', '$-204.51', '99.00-', '1 234,00 kr', '−7.5'].map((s, i) => T.parseAmount(s, [3, 4, 7].includes(i) ? ',' : '.')),
      dates: [['2026-09-03', 'auto'], ['03/09/2026', 'DMY'], ['09/03/2026', 'MDY'], ['20260903', 'auto'], ['3 Sep 2026', 'auto'], ['Sep 3, 2026', 'auto'], ['31/02/2026', 'DMY'], ['03.09.26', 'DMY']].map(([s, f]) => T.parseDate(s, f)),
      delims: [T.detectDelimiter('a;b;c\n1,5;2;3\n4,5;5;6'), T.detectDelimiter('a,b\n"x;y",2'), T.detectDelimiter('a\tb\tc\n1\t2\t3')],
      merchants: ['WHOLE FOODS MARKET #104 AUSTIN TX', 'PAYPAL *SPOTIFY', 'STARBUCKS STORE 0042', 'UBER *TRIP, HELP.UBER.COM', 'ICA SUPERMARKET EXEMPEL'].map(T.merchantKey)
    };
  });
  await page.evaluate(()=>{}); console.log('UNIT', JSON.stringify(unit, null, 0));

  // description cleaning + close matching (synthetic strings)
  const cl = await page.evaluate(() => { const T = window.SpendingTracker;
    const c = ['KORTKÖP 260801 PIZZERIA NAPOLI /26-08-01', 'WOLT        /26-07-24', 'HEMKOP STOCK/26-08-03', 'ST1 NORRT LJ/26-08-01', 'KFC MOS 3617/26-08-01', 'EXAMPLE ENERGI AB', 'COMVIQ ATT: KUNDRESKONTR', 'PAYPAL *SPOTIFY', 'WHOLE FOODS MARKET #104 AUSTIN TX', '46700000000'].map(T.cleanDescription);
    const f = ['KNUTEN PIZZE', 'APPLE COM BI', 'MAXIICA', 'ESPRESSOHOUSE', 'TRAN', 'COOPERATIVE THING'].map(T.fuzzyMatchRule);
    const cats = ['HEMKOP STOCK/26-08-03', 'COSTCO WAREH/26-07-25', '46700000000'].map(d => T.categorize({ desc: d, amount: -10 }));
    return { c, f, cats }; });
  console.log('CLEAN', JSON.stringify(cl));
  const want = { c: ['PIZZERIA NAPOLI', 'WOLT', 'HEMKOP', 'ST1', 'KFC', 'EXAMPLE ENERGI', 'COMVIQ', 'SPOTIFY', 'WHOLE FOODS MARKET AUSTIN TX', '46700000000'], f: ['Restaurant', 'Software/apps', 'Supermarket', 'Café', null, null], cats: ['Supermarket', 'Supermarket', 'Swish'] };
  if (JSON.stringify(cl) !== JSON.stringify(want)) { console.log('FAILED cleaning/fuzzy checks, want', JSON.stringify(want)); process.exitCode = 1; }

  // Klarna "K*" marker
  const kl = await page.evaluate(() => { const T = window.SpendingTracker;
    const ins = ['K*ZALANDO', 'K* ZALANDO.SE', 'k *H&M/26-08-01', 'KORTKÖP 260801 K*ZALANDO/26-08-01', 'PAYPAL *K*NETFLIX', 'KLARNA BANK', 'KFC MOS 3617', 'SK*TEST', 'PARK*ING'];
    return { clean: ins.map(T.cleanDescription), via: ins.map(T.isViaKlarna), cat: ['K*ZALANDO', 'K* ZALANDO.SE', 'KORTKÖP 260801 K*ZALANDO/26-08-01'].map(d => T.categorize({ desc: d, amount: -100 })),
      key: T.dedupeKey({ date: '2026-08-01', amount: -100, desc: 'K*ZALANDO' }) }; });
  console.log('KLARNA', JSON.stringify(kl));
  const wantK = { clean: ['ZALANDO', 'ZALANDO.SE', 'H&M', 'ZALANDO', 'NETFLIX', 'KLARNA BANK', 'KFC', 'SK TEST', 'PARK ING'], via: [true, true, true, true, true, false, false, false, false], cat: ['Clothing', 'Clothing', 'Clothing'], key: '2026-08-01|-10000|kzalando' };
  if (JSON.stringify(kl) !== JSON.stringify(wantK)) { console.log('FAILED klarna checks, want', JSON.stringify(wantK)); process.exitCode = 1; }
  {
    // stored data from an older version: migration re-categorizes non-manual K* rows, keeps manual ones, keys unchanged, no duplicates on re-import
    const kc = await browser.newContext(); const kp = await kc.newPage(); hook(kp);
    await kp.goto(URL);
    await kp.evaluate(() => localStorage.setItem('spendingTracker.v1', JSON.stringify({ txns: [
      { id: 'a1', date: '2026-08-01', desc: 'K*ZALANDO', amount: -499, category: 'Other', catManual: false, key: '2026-08-01|-49900|kzalando' },
      { id: 'a2', date: '2026-08-02', desc: 'K* ZALANDO.SE', amount: -299, category: 'Travel', catManual: true, key: '2026-08-02|-29900|kzalandose' } ], settings: { currency: 'SEK' } })));
    await kp.reload(); await kp.waitForTimeout(200);
    const mig = await kp.evaluate(() => window.SpendingTracker.state.txns.map(t => [t.id, t.category, t.key]));
    await kp.setInputFiles('#fileInput', { name: 'k.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount\n2026-08-01,K*ZALANDO,-499.00\n2026-08-03,K*ZALANDO,-99.00\n') });
    await kp.waitForSelector('#mapRoot table'); await kp.click('#doImport'); await kp.waitForTimeout(300);
    const after = await kp.evaluate(() => window.SpendingTracker.state.txns.map(t => t.id.length > 3 ? 'new:' + t.category : t.id));
    await kp.click('#tabs [data-view=transactions]');
    const tag = await kp.locator('#txTable tbody tr', { hasText: 'via Klarna' }).count();
    await kp.screenshot({ path: SH('20-klarna-tag.png') });
    console.log('KLARNA MIGRATION', JSON.stringify(mig), 'after reimport', JSON.stringify(after), 'tagged rows', tag);
    if (JSON.stringify(mig) !== JSON.stringify([['a1', 'Clothing', '2026-08-01|-49900|kzalando'], ['a2', 'Travel', '2026-08-02|-29900|kzalandose']]) || JSON.stringify(after) !== JSON.stringify(['a1', 'a2', 'new:Clothing']) || tag !== 3) { console.log('FAILED klarna migration/dedupe'); process.exitCode = 1; }
    await kc.close();
  }

  // import A + C via the file picker (multi-file)
  await page.setInputFiles('#fileInput', [A, C]);
  await page.waitForSelector('#mapRoot table');
  const mapA = await page.evaluate(() => ({ title: document.querySelector('#modal header span').textContent, sels: [...document.querySelectorAll('#mapRoot select')].map(s => s.dataset.k + '=' + s.options[s.selectedIndex].text), found: document.querySelectorAll('.section-title')[1].textContent }));
  console.log('MAP A', JSON.stringify(mapA));
  await clean(page); await page.screenshot({ path: SH('01-import-mapping-bankA.png') });
  await page.click('#doImport');
  await page.waitForFunction(() => document.querySelector('#modal header span')?.textContent.includes('card-C') && document.querySelector('#modalBg').classList.contains('show'));
  const mapC = await page.evaluate(() => ({ sels: [...document.querySelectorAll('#mapRoot select')].map(s => s.dataset.k + '=' + s.options[s.selectedIndex].text), inv: document.querySelector('#invChk')?.checked, found: document.querySelectorAll('.section-title')[1].textContent }));
  console.log('MAP C', JSON.stringify(mapC));
  await clean(page); await page.screenshot({ path: SH('02-import-mapping-cardC.png') });
  await page.click('#doImport');
  await page.waitForFunction(() => !document.querySelector('#modalBg').classList.contains('show'));
  await page.waitForTimeout(300);

  const st = await page.evaluate(() => { const s = window.SpendingTracker.state; const by = {}; s.txns.forEach(t => by[t.category] = (by[t.category] || 0) + 1);
    return { n: s.txns.length, by, other: s.txns.filter(t => t.category === 'Other').map(t => t.desc), sample: s.txns.filter(t => /STARBUCKS|PAYMENT THANK|ADOBE|DELTA|Bistro|GYM/.test(t.desc)).slice(0, 8).map(t => [t.date, t.desc, t.amount, t.category]),
      rec: window.SpendingTracker.detectRecurring().map(r => r.name + ' ' + r.avg + ' x' + r.months) }; });
  console.log('STATE', JSON.stringify(st, null, 1));

  // re-import A -> all duplicates
  await page.setInputFiles('#fileInput', [A]);
  await page.waitForSelector('#mapRoot table');
  await page.click('#doImport');
  await page.waitForTimeout(300);
  const toastTxt = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent));
  const n2 = await page.evaluate(() => window.SpendingTracker.state.txns.length);
  console.log('REIMPORT', n2, toastTxt);

  // budgets
  await page.click('#tabs [data-view=budgets]');
  for (const [c, v] of [['Groceries', 400], ['Dining', 150], ['Shopping', 200], ['Transport', 120]]) { await page.fill(`[data-budget="${c}"]`, String(v)); await page.dispatchEvent(`[data-budget="${c}"]`, 'change'); }
  await clean(page); await page.screenshot({ path: SH('05-budgets.png'), fullPage: true });

  await page.click('#tabs [data-view=dashboard]');
  await page.waitForTimeout(200);
  await clean(page); await page.screenshot({ path: SH('03-dashboard-light.png'), fullPage: true });

  // transactions: change category of a Mystery Vendor -> rule prompt
  await page.click('#tabs [data-view=transactions]');
  await clean(page); await page.screenshot({ path: SH('04-transactions.png'), fullPage: false });
  const row = page.locator('#txTable tr', { hasText: 'MYSTERY VENDOR' }).first();
  await pickCat(page, row.locator('[data-catsel]'), 'Entertainment');
  await page.waitForSelector('#rulePat');
  await clean(page); await page.screenshot({ path: SH('06-category-rule-prompt.png') });
  await page.click('#modal footer .primary');
  await page.waitForTimeout(200);
  // review view: group + one pick saves a rule
  await page.click('#tabs [data-view=transactions]');
  await page.click('#addTx'); await page.fill('#eDesc', 'KORTKÖP 260915 ODD SHOP/26-09-15'); await page.fill('#eAmt', '12'); await page.fill('#eDate', '2026-09-15'); await page.click('#modal footer .primary');
  await page.click('#addTx'); await page.fill('#eDesc', 'ODD SHOP STOCK/26-09-20'); await page.fill('#eAmt', '30'); await page.fill('#eDate', '2026-09-20'); await page.click('#modal footer .primary');
  await page.click('#tabs [data-view=review]');
  const rv = await page.evaluate(() => [...document.querySelectorAll('.review-row')].map(r => r.firstElementChild.firstElementChild.textContent + ' | ' + r.querySelector('.stats').textContent));
  console.log('REVIEW', JSON.stringify(rv), 'badge', await page.textContent('#reviewBadge'));
  await clean(page); await page.screenshot({ path: SH('18-review-uncategorized-sample.png') });
  await pickCat(page, page.locator('.review-row', { hasText: 'Odd Shop' }).locator('[data-revcat]'), 'Shopping');
  const after = await page.evaluate(() => ({ n: window.SpendingTracker.state.txns.filter(t => /ODD SHOP/.test(t.desc) && t.category === 'Shopping').length, rule: window.SpendingTracker.state.rules[0].pattern }));
  console.log('REVIEW APPLY', JSON.stringify(after));
  if (!(rv[0] && rv[0].startsWith('Odd Shop | 2×') && after.n === 2 && after.rule === 'odd shop')) { console.log('FAILED review checks'); process.exitCode = 1; }
  await page.click('#tabs [data-view=transactions]');
  // search + sort
  await page.fill('#txSearch', 'starbucks'); await page.waitForTimeout(400);
  const cnt = await page.locator('#txTable tbody tr').count();
  await page.click('th[data-sort=amount]');
  console.log('SEARCH starbucks rows', cnt);
  await clean(page); await page.screenshot({ path: SH('07-transactions-search.png') });
  await page.fill('#txSearch', ''); await page.waitForTimeout(400);
  // manual add
  await page.click('#addTx');
  await page.fill('#eDesc', 'Farmers market cash'); await page.fill('#eAmt', '23.5'); await page.fill('#eDate', '2026-09-29');
  await page.click('#modal footer .primary');
  const added = await page.evaluate(() => window.SpendingTracker.state.txns.find(t => t.desc === 'Farmers market cash'));
  console.log('ADDED', JSON.stringify(added));
  // export CSV + JSON download check
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#expCsv')]);
  console.log('CSV export', dl.suggestedFilename());
  await page.click('#tabs [data-view=settings]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#bExpJson')]);
  await dl2.saveAs(path.resolve('screenshots', '_backup.json'));
  await clean(page); await page.screenshot({ path: SH('08-settings.png'), fullPage: true });

  // persistence: reload
  await page.reload(); await page.waitForTimeout(300);
  console.log('AFTER RELOAD', await page.evaluate(() => window.SpendingTracker.state.txns.length));

  // dark mode
  await page.click('#themeBtn'); await page.click('#tabs [data-view=dashboard]'); await page.waitForTimeout(200);
  await clean(page); await page.screenshot({ path: SH('09-dashboard-dark.png'), fullPage: true });
  await page.click('#tabs [data-view=transactions]');
  await clean(page); await page.screenshot({ path: SH('10-transactions-dark.png') });
  await page.click('#themeBtn');

  // Salary-to-salary periods (fake data: salary on varying dates, a weekend shift, July missing, a retro top-up)
  {
    const sc = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' }); const sp = await sc.newPage(); hook(sp);
    await sp.clock.setFixedTime(new Date('2026-10-04T12:00:00'));
    await sp.goto(URL);
    await sp.setInputFiles('#fileInput', [S('example-salary-periods.csv')]);
    await sp.waitForSelector('#mapRoot table'); await sp.click('#doImport'); await sp.waitForTimeout(300);
    await sp.click('#tabs [data-view=settings]'); await sp.selectOption('#sCur', 'SEK');
    const P = () => sp.evaluate(() => { const T = window.SpendingTracker; return { periods: T.getPeriods().list.map(p => p.start + '..' + p.end + (p.salary ? '' : '*')), salaries: T.getPeriods().salaries, months: T.allMonths() }; });
    const p1 = await P();
    console.log('SALARY PERIODS', JSON.stringify(p1));
    const wantP = ['2026-01-23..2026-02-24*', '2026-02-25..2026-03-19*', '2026-03-20..2026-04-23', '2026-04-24..2026-05-24', '2026-05-25..2026-06-24', '2026-06-25..2026-07-23', '2026-07-24..2026-08-24*', '2026-08-25..2026-09-24', '2026-09-25..2026-10-22', '2026-10-23..2026-11-24*', '2026-11-25..2026-12-24*'];
    const u = await sp.evaluate(() => { const T = window.SpendingTracker; return { pd: [[2026, 2, 31], [2026, 7, 25], [2026, 10, 25], [2026, 1, 25], [2026, 9, 25]].map(a => T.paydayDate(...a)), of: ['2026-08-27', '2026-08-28', '2026-07-23', '2026-10-04'].map(T.periodOf), label: T.monthLabel('2026-09-25', true), left: T.daysLeftText('2026-09-25'), sal: ['LÖN', 'LON 2026-09', 'Salary ACME', 'PAYROLL', 'SALONG FRISÖR'].map(d => T.isSalary({ desc: d, amount: 100, category: 'Income' })) }; });
    console.log('SALARY UNIT', JSON.stringify(u));
    const wantU = { pd: ['2026-02-27', '2026-07-24', '2026-10-23', '2026-01-23', '2026-09-25'], of: ['2026-08-25', '2026-08-25', '2026-06-25', '2026-09-25'], label: 'Sep 2026 (25 Sep – 22 Oct)', left: '19 days left', sal: [true, true, true, true, false] };
    let bad = JSON.stringify(p1.periods) !== JSON.stringify(wantP) || p1.months[p1.months.length - 1] !== '2026-09-25' || p1.months[0] !== '2026-01-23' || JSON.stringify(u) !== JSON.stringify(wantU);
    await sp.click('#tabs [data-view=dashboard]'); await sp.waitForTimeout(200);
    const dash = await sp.evaluate(() => ({ head: document.querySelector('#view-dashboard .toolbar h2, .toolbar h2').textContent, sel: document.querySelector('#monthSel').selectedOptions[0].textContent, trend: document.querySelector('#trend').textContent.slice(0, 80) }));
    console.log('SALARY DASHBOARD', JSON.stringify(dash));
    if (!/25 Sep – 22 Oct/.test(dash.head) || !/19 days left/.test(dash.head) || dash.sel !== 'Sep 2026 (25 Sep – 22 Oct)') bad = true;
    await clean(sp); await sp.screenshot({ path: SH('21-salary-periods-dashboard.png'), fullPage: true });
    // previous-period comparison uses periods: prevMonth of Sep period is the Aug salary period
    const prev = await sp.evaluate(() => [window.SpendingTracker.prevMonth('2026-09-25'), window.SpendingTracker.prevMonth('2026-08-25')]);
    if (JSON.stringify(prev) !== '["2026-08-25","2026-07-24"]') { bad = true; console.log('prev', prev); }
    // transactions month filter uses the period
    await sp.click('#tabs [data-view=transactions]'); await sp.selectOption('#fMonth', '2026-07-24');
    const fr = await sp.evaluate(() => { const d = [...document.querySelectorAll('#txTable tbody td.c-date')].map(x => x.closest('tr').dataset.id).map(id => window.SpendingTracker.state.txns.find(t => t.id === id).date).sort(); return [d[0], d[d.length - 1], document.querySelectorAll('.salary-pill').length]; });
    console.log('FILTER Jul period', JSON.stringify(fr));
    if (fr[0] < '2026-07-24' || fr[1] > '2026-08-24') bad = true;
    // manual mark: Swish on 27 Jul is the real (late) July salary -> replaces the 24 Jul fallback
    await sp.selectOption('#fMonth', ''); await sp.fill('#txSearch', 'ANNA'); await sp.waitForTimeout(200);
    await sp.click('#txTable tbody tr [data-edit]'); await sp.selectOption('#eSal', 'yes'); await sp.click('#modal .btn.primary'); await sp.waitForTimeout(200);
    // manual unmark: 20 Mar salary -> March falls back to the 25th
    await sp.reload(); await sp.waitForTimeout(200);   // manual flag must persist
    await sp.click('#tabs [data-view=transactions]'); await sp.fill('#txSearch', 'LÖN EXEMPELFÖRETAG'); await sp.waitForTimeout(200);
    const rowsN = await sp.locator('#txTable tbody tr').count();
    await sp.locator('#txTable tbody tr').nth(rowsN - 1).locator('[data-edit]').click(); await sp.selectOption('#eSal', 'no'); await sp.click('#modal .btn.primary'); await sp.waitForTimeout(200);
    const p2 = await P();
    console.log('AFTER MARK/UNMARK', JSON.stringify(p2.salaries), JSON.stringify(p2.periods.slice(1, 8)));
    if (p2.salaries.includes('2026-03-20') || !p2.salaries.includes('2026-07-27') || !p2.periods.includes('2026-03-25..2026-04-23*') || !p2.periods.includes('2026-06-25..2026-07-26') || !p2.periods.includes('2026-07-27..2026-08-24')) bad = true;
    // custom salary pattern + calendar toggle
    await sp.click('#tabs [data-view=settings]'); await sp.fill('#sSalPat', 'nothing matches this'); await sp.press('#sSalPat', 'Tab'); await sp.waitForTimeout(200);
    const p3 = await P();
    if (JSON.stringify(p3.salaries) !== '["2026-07-27"]') { bad = true; console.log('pattern', p3.salaries); }
    await sp.fill('#sSalPat', ''); await sp.press('#sSalPat', 'Tab'); await sp.waitForTimeout(100);
    await sp.selectOption('#sPeriod', 'calendar'); await sp.waitForTimeout(200);
    const p4 = await P();
    if (p4.months[0] !== '2026-02' || p4.months[p4.months.length - 1] !== '2026-10' || !p4.periods.includes('2026-09-01..2026-09-30*')) { bad = true; console.log('calendar', JSON.stringify(p4.months)); }
    await sp.selectOption('#sPeriod', 'salary'); await sp.waitForTimeout(100);
    if (bad) { console.log('FAILED salary period checks', JSON.stringify(wantU)); process.exitCode = 1; } else console.log('PASS salary periods');
    await sc.close();
  }

  // mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); hook(mp);
  await mp.goto(URL);
  await mp.evaluate(s => localStorage.setItem('spendingTracker.v1', s), await page.evaluate(() => localStorage.getItem('spendingTracker.v1')));
  await mp.reload(); await mp.waitForTimeout(300);
  await clean(mp); await mp.screenshot({ path: SH('11-mobile-dashboard.png'), fullPage: true });
  await mp.click('#tabs [data-view=transactions]');
  await clean(mp); await mp.screenshot({ path: SH('12-mobile-transactions.png') });

  // Separate profile: Swedish-style semicolon file in SEK
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await c2.newPage(); hook(p2);
  await p2.goto(URL);
  await p2.setInputFiles('#fileInput', [B]);
  await p2.waitForSelector('#mapRoot table');
  const mapB = await p2.evaluate(() => ({ sels: [...document.querySelectorAll('#mapRoot select')].map(s => s.dataset.k + '=' + s.options[s.selectedIndex].text), found: document.querySelectorAll('.section-title')[1].textContent }));
  console.log('MAP B', JSON.stringify(mapB));
  await clean(p2); await p2.screenshot({ path: SH('13-import-mapping-bankB-semicolon.png') });
  await p2.click('#doImport'); await p2.waitForTimeout(300);
  await p2.click('#tabs [data-view=settings]'); await p2.selectOption('#sCur', 'SEK');
  const stB = await p2.evaluate(() => { const s = window.SpendingTracker.state; const by = {}; s.txns.forEach(t => by[t.category] = (by[t.category] || 0) + 1); return { n: s.txns.length, by, first: s.txns.slice(0, 3).map(t => [t.date, t.desc, t.amount, t.category]), other: s.txns.filter(t => t.category === 'Other').map(t => t.desc) }; });
  console.log('STATE B', JSON.stringify(stB));
  await p2.click('#tabs [data-view=dashboard]'); await p2.waitForTimeout(200);
  await clean(p2); await p2.screenshot({ path: SH('14-dashboard-sek-bankB.png'), fullPage: true });

  // ===== v2: merchant dictionary, two-level categories, accounts & card payoffs (fake data only) =====
  {
    let bad = 0; const fail = (m, x) => { bad++; console.log('FAILED', m, x === undefined ? '' : JSON.stringify(x)); };
    const vc = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' }); const vp = await vc.newPage(); hook(vp);
    const ext = []; vc.on('request', r => { if (!/^(file|data|blob|http:\/\/127\.0\.0\.1|http:\/\/localhost):/.test(r.url())) ext.push(r.url()); });
    await vp.goto(URL);
    // dictionary: spelling variants, truncation, short names
    const dm = await vp.evaluate(() => { const T = window.SpendingTracker; const f = d => { const m = T.dictMatch(d); return m ? m.category : null; };
      return { info: T.dictInfo.entries, v: ['GRÖNA LUND', 'GRONA LUND', 'GR NA LUND', 'GRNA LUND', 'HEMKOP STOCKHOLM', 'HEMK P SODERMALM', 'ESPRESSO HOU', 'KJELL & COMPA', 'SYSTEMBOLAGET AB', 'APOTEK HJARTAT', 'XYZZY QWERTY AB'].map(f) }; });
    const wantDm = ['Entertainment', 'Entertainment', 'Entertainment', 'Entertainment', 'Supermarket', 'Supermarket', 'Café', 'Electronics', 'Alcohol/Systembolaget', 'Pharmacy', null];
    console.log('DICT', dm.info, JSON.stringify(dm.v));
    if (dm.info < 3000 || JSON.stringify(dm.v) !== JSON.stringify(wantDm)) fail('dictionary matches, want', wantDm);
    // import a bank file into a new bank account named "Swedbank"
    const bank = 'Date,Description,Amount\n2026-08-25,LON ACME AB,30000.00\n2026-09-02,HEMKOP STOCKHOLM,-412.50\n2026-09-03,GR NA LUND,-395.00\n2026-09-04,SAS EUROBONUS MASTERCARD,-2000.00\n2026-09-05,ESPRESSO HOU,-49.00\n2026-09-07,SYSTEMBOLAGET AB,-289.00\n2026-09-08,BAGERI TEST,-85.00\n2026-09-06,MYSTERY GADGETS 77,-120.00\n2026-09-10,NORDICCARD BG 5555,-300.00\n2026-09-12,PLUTOPAY AB 9911,-150.00\n2026-09-28,SEB KORT,-1234.50\n';
    await vp.setInputFiles('#fileInput', { name: 'swedbank-sept.csv', mimeType: 'text/csv', buffer: Buffer.from(bank) });
    await vp.waitForSelector('#mapAcc');
    await vp.selectOption('#mapAcc', '__newbank'); await vp.fill('#mapAccName', 'Swedbank');
    await clean(vp); await vp.screenshot({ path: SH('27-import-account-select.png') });
    await vp.click('#doImport'); await vp.waitForTimeout(300);
    let st = await vp.evaluate(() => { const S = window.SpendingTracker.state; return { acc: S.accounts.map(a => a.name + ':' + a.type), tx: S.txns.map(t => [t.desc, t.category, t.catSource || '', t.account === S.accounts[0].id]) }; });
    console.log('V2 IMPORT', JSON.stringify(st));
    const cat = d => (st.tx.find(x => x[0] === d) || [])[1], srcOf = d => (st.tx.find(x => x[0] === d) || [])[2];
    if (JSON.stringify(st.acc) !== '["Swedbank:bank"]' || !st.tx.every(x => x[3])) fail('account tagging');
    if (cat('HEMKOP STOCKHOLM') !== 'Supermarket' || srcOf('HEMKOP STOCKHOLM') !== 'dict') fail('dict category/source');
    // dictionary beats generic keyword ("sas" = Flights keyword; dictionary knows the SAS card)
    if (cat('SAS EUROBONUS MASTERCARD') !== 'Credit card payment' || srcOf('SAS EUROBONUS MASTERCARD') !== 'dict') fail('dictionary > keyword', [cat('SAS EUROBONUS MASTERCARD'), srcOf('SAS EUROBONUS MASTERCARD')]);
    if (cat('SEB KORT') !== 'Credit card payment') fail('built-in issuer list');
    // "auto" pill on dictionary matches
    await vp.click('#tabs [data-view=transactions]');
    const pill = await vp.locator('#txTable tbody tr', { hasText: 'HEMK' }).locator('.auto-pill').count();
    if (pill !== 1) fail('auto pill', pill);
    // user rule beats dictionary: add rule hemkop -> Restaurant via API state and re-apply
    await vp.evaluate(() => { const S = window.SpendingTracker.state; S.rules.unshift({ id: 'ur1', pattern: 'hemkop', category: 'Restaurant', user: true }); window.SpendingTracker.invalidateRules(); });
    const prec = await vp.evaluate(() => { const T = window.SpendingTracker; const t = { desc: 'HEMKOP STOCKHOLM', amount: -10, date: '2026-09-02' }; const T2 = window.SpendingTracker; T2.state.rules = T2.state.rules.slice(); return [T.categorize(Object.assign({}, t)), (() => { const x = Object.assign({}, t); T.categorize(x); return x.catSource; })()]; });
    await vp.evaluate(() => { const S = window.SpendingTracker.state; S.rules = S.rules.filter(r => r.id !== 'ur1'); window.SpendingTracker.invalidateRules(); });
    if (JSON.stringify(prec) !== '["Restaurant","rule"]') fail('user rule > dictionary', prec);
    // correcting a dictionary match: category select -> rule prompt -> rule saved
    const row = vp.locator('#txTable tbody tr', { hasText: 'ESPRESSO' });
    await pickCat(vp, row.locator('[data-catsel]'), 'Fast food');
    await vp.waitForSelector('#rulePat'); await vp.click('#modal .btn.primary'); await vp.waitForTimeout(150);
    const corr = await vp.evaluate(() => { const S = window.SpendingTracker.state; const t = S.txns.find(x => /ESPRESSO/.test(x.desc)); return [t.category, t.catSource, S.rules.filter(r => r.user).map(r => r.pattern + '>' + r.category)]; });
    console.log('CORRECTION', JSON.stringify(corr));
    if (corr[1] !== 'manual' || !corr[2].some(r => r.startsWith('espresso') && r.endsWith('>' + corr[0]))) fail('correction creates rule', corr);
    if (await vp.locator('#txTable tbody tr', { hasText: 'ESPRESSO' }).locator('.auto-pill').count()) fail('pill removed after correction');

    // payoff counts as spending while the card is unknown/not imported
    const T = () => vp.evaluate(() => { const ST = window.SpendingTracker, S = ST.state; const p = S.txns.find(t => t.desc === 'SEB KORT'); const s = ST.summarize('all', ''); return { tr: ST.payoffTreatment(p), card: (ST.cardFor(p) || {}).name || '', spent: Math.round(s.spent * 100) / 100, payoffs: Math.round((s.byCat['Card payoffs (not itemised)'] || 0) * 100) / 100, match: ST.payoffMatch(p) }; });
    let t1 = await T(); console.log('PAYOFF before card', JSON.stringify(t1));
    if (t1.tr !== 'spending' || t1.card !== '') fail('unlinked payoff counted as spending', t1);
    // Settings > Accounts: add card with name + payoff text
    await vp.click('#tabs [data-view=settings]');
    await vp.click('#addCard');
    const lastRow = vp.locator('#accList .acc-row').last();
    await lastRow.locator('[data-aname]').fill('SEB Kort'); await lastRow.locator('[data-aname]').press('Tab'); await vp.waitForTimeout(100);
    await vp.locator('#accList .acc-row').last().locator('[data-amatch]').fill('seb kort'); await vp.locator('#accList .acc-row').last().locator('[data-amatch]').press('Tab'); await vp.waitForTimeout(150);
    t1 = await T(); console.log('PAYOFF card added', JSON.stringify(t1));
    const pay0 = t1.payoffs;
    if (t1.tr !== 'spending' || t1.card !== 'SEB Kort' || pay0 < 1234.5) fail('linked payoff, no statement yet -> spending', t1);
    // card setting off -> transfer
    await vp.locator('#accList .acc-row').last().locator('[data-acount]').uncheck(); await vp.waitForTimeout(100);
    if ((await T()).tr !== 'transfer') fail('countPayoffs off -> transfer');
    await vp.locator('#accList .acc-row').last().locator('[data-acount]').check(); await vp.waitForTimeout(100);
    await clean(vp); await vp.locator('#accCard').screenshot({ path: SH('28-settings-accounts-cards.png') });
    // import the card statement into the SEB Kort account (purchases in August, payment received line)
    const card = 'Datum;Text;Belopp\n02/08/2026;ICA NARA TEST;-234,50\n15/08/2026;STADIUM OUTLET;-600,00\n20/08/2026;FOODORA;-400,00\n29/09/2026;INBETALNING TACK;1234,50\n';
    await vp.setInputFiles('#fileInput', { name: 'sebkort-aug.csv', mimeType: 'text/csv', buffer: Buffer.from(card) });
    await vp.waitForSelector('#mapAcc');
    const sebId = await vp.evaluate(() => window.SpendingTracker.state.accounts.find(a => a.name === 'SEB Kort').id);
    await vp.selectOption('#mapAcc', sebId);
    await vp.click('#doImport'); await vp.waitForTimeout(300);
    const t2 = await T(); console.log('PAYOFF after statement', JSON.stringify(t2));
    if (t2.tr !== 'transfer' || Math.abs(t2.payoffs - (pay0 - 1234.5)) > 0.001 || !t2.match || t2.match.diff !== 0 || t2.match.total !== 1234.5) fail('payoff becomes transfer + matches statement', t2);
    const cardSide = await vp.evaluate(() => { const S = window.SpendingTracker.state; const t = S.txns.find(x => x.desc === 'INBETALNING TACK'); return [t.category, window.SpendingTracker.summarize('2026-08', '').spent >= 1234.5]; });
    if (cardSide[0] !== 'Credit card payment') fail('card-side payment line', cardSide);
    // layout remembered: another file with the same layout defaults to SEB Kort
    await vp.setInputFiles('#fileInput', { name: 'other-name.csv', mimeType: 'text/csv', buffer: Buffer.from('Datum;Text;Belopp\n03/09/2026;CLAS OHLSON;-99,00\n') });
    await vp.waitForSelector('#mapAcc');
    if (await vp.$eval('#mapAcc', s => s.value) !== sebId) fail('account remembered per layout');
    await vp.click('#doImport'); await vp.waitForTimeout(250);
    // payoff info line in Transactions
    await vp.click('#tabs [data-view=transactions]');
    const payId = await vp.evaluate(() => window.SpendingTracker.state.txns.find(t => t.desc === 'SEB KORT').id);
    const payRow = vp.locator(`#txTable tbody tr[data-id="${payId}"]`);
    const info = await payRow.locator('.payoff-info').textContent();
    console.log('PAYOFF INFO', info);
    if (!/transfer/.test(info) || !/matches SEB Kort statement of/.test(info)) fail('payoff info text', info);
    await clean(vp); await payRow.screenshot({ path: SH('29-payoff-matched.png') });
    // mark any transaction as card payment via the edit dialog (new card) -> rule + card pattern
    await vp.locator('#txTable tbody tr', { hasText: 'NORDICCARD' }).locator('[data-edit]').click();
    await pickCat(vp, vp.locator('#eCat'), 'Credit card payment', 'kreditkort'); await vp.selectOption('#eCard', '__new'); await vp.fill('#eCardName', 'Nordic Card');
    await vp.click('#modal .btn.primary'); await vp.waitForTimeout(200);
    const ed = await vp.evaluate(() => { const ST = window.SpendingTracker, S = ST.state; const t = S.txns.find(x => /NORDICCARD/.test(x.desc)); const c = S.accounts.find(a => a.name === 'Nordic Card'); return { cat: t.category, card: (ST.cardFor(t) || {}).name, match: c && c.match, rule: S.rules.some(r => r.user && r.category === 'Credit card payment' && /nordiccard/.test(r.pattern)), again: ST.categorize({ desc: 'NORDICCARD BG 5555', amount: -10, date: '2026-10-10' }) }; });
    console.log('EDIT AS PAYOFF', JSON.stringify(ed));
    if (ed.cat !== 'Credit card payment' || ed.card !== 'Nordic Card' || !/nordiccard/.test(ed.match || '') || !ed.rule || ed.again !== 'Credit card payment') fail('edit dialog marks card payment', ed);
    // Review tab: Search link + mark as card payment for an existing card
    await vp.click('#tabs [data-view=review]');
    const grp = vp.locator('.review-row', { hasText: 'PLUTOPAY' });
    const href = await grp.locator('a', { hasText: 'Search' }).getAttribute('href'), tgt = await grp.locator('a', { hasText: 'Search' }).getAttribute('target'), rel = await grp.locator('a', { hasText: 'Search' }).getAttribute('rel');
    console.log('SEARCH LINK', href, tgt, rel);
    if (!/^https:\/\/duckduckgo\.com\/\?q=PLUTOPAY%20Sverige$/i.test(href) || tgt !== '_blank' || !/noopener/.test(rel) || !/noreferrer/.test(rel)) fail('review search link', href);
    await clean(vp); await vp.screenshot({ path: SH('30-review-search-link.png') });
    await pickCat(vp, grp.locator('[data-revcat]'), 'Credit card payment');
    await vp.waitForSelector('#ccSel'); await vp.selectOption('#ccSel', { label: 'Nordic Card' }); await vp.click('#modal .btn.primary'); await vp.waitForTimeout(200);
    const rv = await vp.evaluate(() => { const ST = window.SpendingTracker, S = ST.state; const t = S.txns.find(x => /PLUTOPAY/.test(x.desc)); return { cat: t.category, card: (ST.cardFor(t) || {}).name, match: S.accounts.find(a => a.name === 'Nordic Card').match }; });
    console.log('REVIEW AS PAYOFF', JSON.stringify(rv));
    if (rv.cat !== 'Credit card payment' || rv.card !== 'Nordic Card' || !/plutopay/.test(rv.match)) fail('review marks card payment', rv);
    // dashboard: account filter + drill-down
    await vp.click('#tabs [data-view=dashboard]');
    const months = await vp.evaluate(() => window.SpendingTracker.allMonths());
    const accs = await vp.evaluate(() => window.SpendingTracker.state.accounts.map(a => a.id));
    await vp.selectOption('#accSel', accs[1]); await vp.waitForTimeout(150);
    const onlyCard = await vp.evaluate(id => { const S = window.SpendingTracker.state; return S.txns.filter(t => t.account === id).length; }, accs[1]);
    const shown = await vp.locator('.kpi').first().textContent();
    if (!onlyCard || !(await vp.$eval('#accSel', s => s.value === s.options[s.selectedIndex].value && s.selectedIndex > 0))) fail('account filter');
    await vp.selectOption('#accSel', ''); await vp.waitForTimeout(150);
    // put the whole thing in one period so the donut has several groups
    await vp.evaluate(() => { const S = window.SpendingTracker.state; S.settings.periodMode = 'calendar'; });
    await vp.click('#tabs [data-view=settings]'); await vp.click('#tabs [data-view=dashboard]');
    await vp.evaluate(() => { const sel = document.querySelector('#monthSel, [data-month-select]'); if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change')); } });
    await vp.waitForTimeout(150);
    const drillRow = vp.locator('#view-dashboard .legend [data-drill="Groceries"]');
    if (!(await drillRow.count())) { await vp.evaluate(() => { const S = window.SpendingTracker.state; }); }
    if (await drillRow.count()) {
      await drillRow.click(); await vp.waitForTimeout(150);
      const dd = await vp.evaluate(() => ({ back: !!document.querySelector('#drillBack'), legend: [...document.querySelectorAll('#view-dashboard .legend .row .nm')].map(e => e.textContent.trim()) }));
      console.log('DRILL', JSON.stringify(dd));
      if (!dd.back || !dd.legend.some(x => /Supermarket/.test(x))) fail('drill-down shows subcategories', dd);
      await clean(vp); await vp.screenshot({ path: SH('26-category-drilldown.png'), fullPage: true });
      await vp.click('#drillBack'); await vp.waitForTimeout(100);
      if (await vp.locator('#drillBack').count()) fail('drill back');
    } else fail('no drillable Groceries row on dashboard');
    // budgets per main and per sub
    await vp.click('#tabs [data-view=budgets]');
    await vp.fill('[data-budget="Groceries"]', '3000'); await vp.press('[data-budget="Groceries"]', 'Tab');
    await vp.locator('details.budget-subs[data-main="Groceries"] summary').click();
    await vp.fill('[data-budget="Supermarket"]', '1500'); await vp.press('[data-budget="Supermarket"]', 'Tab'); await vp.waitForTimeout(100);
    const bud = await vp.evaluate(() => window.SpendingTracker.state.budgets);
    if (+bud.Groceries !== 3000 || +bud.Supermarket !== 1500) fail('main/sub budgets', bud);
    await clean(vp); await vp.screenshot({ path: SH('31-budgets-main-sub.png'), fullPage: true });
    // filter by main includes subs
    await vp.click('#tabs [data-view=transactions]');
    await vp.selectOption('#fAcc', ''); await setCats(vp, ['Groceries']); await vp.waitForTimeout(100);
    const fl = await vp.locator('#txTable tbody tr').allTextContents();
    if (!fl.some(x => /hemk/i.test(x)) || !fl.some(x => /ica nara/i.test(x)) || fl.some(x => /stadium/i.test(x))) fail('filter main includes subs', fl.length);
    await setCats(vp, ['Supermarket']); await vp.waitForTimeout(100);
    const fl2 = await vp.locator('#txTable tbody tr').count();
    await setCats(vp, []); await vp.selectOption('#fAcc', accs[0]); await vp.waitForTimeout(100);
    const fl3 = await vp.locator('#txTable tbody tr').allTextContents();
    if (!fl2 || fl3.some(x => /stadium|ica nara/i.test(x)) || !fl3.some(x => /hemk/i.test(x))) fail('sub filter / account filter');
    await vp.selectOption('#fAcc', '');
    // Settings: add a subcategory under Pets and rename it
    await vp.click('#tabs [data-view=settings]');
    await vp.locator('#catList .cat-row', { has: vp.locator('[data-name][value="Pets"]') }).locator('[data-addsub]').click();
    await vp.waitForTimeout(100);
    await vp.keyboard.type('Pet sitting'); await vp.keyboard.press('Tab'); await vp.waitForTimeout(150);
    const sub = await vp.evaluate(() => { const c = window.SpendingTracker.state.categories.find(x => x.name === 'Pet sitting'); return c && [c.parent, c.type]; });
    if (JSON.stringify(sub) !== '["Pets","expense"]') fail('add subcategory', sub);
    if (ext.length) fail('network requests made', ext);
    await vc.close();

    // old v1 data: Bills & Utilities -> Utilities, manual kept, non-manual re-categorized; same via JSON restore
    const v1 = { txns: [
      { id: 'o1', date: '2026-08-01', desc: 'VATTENFALL', amount: -800, category: 'Bills & Utilities', catManual: false, key: 'o1' },
      { id: 'o2', date: '2026-08-02', desc: 'MY LANDLORD', amount: -9000, category: 'Bills & Utilities', catManual: true, key: 'o2' },
      { id: 'o3', date: '2026-08-03', desc: 'HEMKOP STOCKHOLM', amount: -300, category: 'Groceries', catManual: false, key: 'o3' },
      { id: 'o4', date: '2026-08-04', desc: 'MY CUSTOM SHOP', amount: -50, category: 'Hobby', catManual: true, key: 'o4' } ],
      categories: [{ name: 'Groceries', color: '#22aa55', type: 'expense' }, { name: 'Bills & Utilities', color: '#3366cc', type: 'expense' }, { name: 'Hobby', color: '#aa33cc', type: 'expense' }, { name: 'Income', color: '#00aa00', type: 'income' }, { name: 'Other', color: '#999999', type: 'expense' }],
      rules: [{ id: 'r1', pattern: 'my landlord', category: 'Bills & Utilities', user: true }], budgets: { 'Bills & Utilities': 1200, Groceries: 4000 }, settings: { currency: 'SEK' } };
    const wantMig = '[["o1","Electricity"],["o2","Utilities"],["o3","Supermarket"],["o4","Hobby"]]';
    const mc = await browser.newContext(); const mpg = await mc.newPage(); hook(mpg);
    await mpg.goto(URL); await mpg.evaluate(s => localStorage.setItem('spendingTracker.v1', s), JSON.stringify(v1)); await mpg.reload(); await mpg.waitForTimeout(250);
    const mg = await mpg.evaluate(() => { const S = window.SpendingTracker.state; return { tx: JSON.stringify(S.txns.map(t => [t.id, t.category])), rule: S.rules.find(r => r.id === 'r1').category, bud: S.budgets, hobby: (S.categories.find(c => c.name === 'Hobby') || {}).parent, ver: S.settings.catVersion, mains: S.categories.filter(c => !c.parent).length }; });
    console.log('V1 MIGRATION', JSON.stringify(mg));
    if (mg.tx !== wantMig || mg.rule !== 'Utilities' || +mg.bud.Utilities !== 1200 || +mg.bud.Groceries !== 4000 || mg.hobby || mg.ver !== 2) fail('v1 localStorage migration', mg);
    mpg.on('dialog', d => d.accept());
    await mpg.evaluate(() => localStorage.clear()); await mpg.reload();
    await mpg.setInputFiles('#jsonInput', { name: 'old-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) }); await mpg.waitForTimeout(300);
    const rs = await mpg.evaluate(() => JSON.stringify(window.SpendingTracker.state.txns.map(t => [t.id, t.category])));
    if (rs !== wantMig) fail('v1 JSON backup restore', rs);
    // a v2 backup round-trips with accounts
    const v2 = await mpg.evaluate(() => { const S = window.SpendingTracker.state; S.accounts.push({ id: 'acc1', name: 'Amex', type: 'card', match: 'amex', countPayoffs: false }); S.txns[0].account = 'acc1'; return JSON.stringify(S); });
    await mpg.setInputFiles('#jsonInput', { name: 'v2.json', mimeType: 'application/json', buffer: Buffer.from(v2) }); await mpg.waitForTimeout(300);
    const r2 = await mpg.evaluate(() => { const S = window.SpendingTracker.state; return [S.accounts.length, S.accounts[0].countPayoffs, S.txns[0].account]; });
    if (JSON.stringify(r2) !== '[1,false,"acc1"]') fail('v2 backup round-trip', r2);
    await mc.close();
    if (bad) { console.log(`FAILED v2 checks (${bad})`); process.exitCode = 1; } else console.log('PASS dictionary, two-level categories, accounts & payoffs, migration');
  }

  // ===== Plan tab: savings, insights, goals, investing (fake data, phone size) =====
  {
    let bad = 0; const fail = (m, x) => { bad++; console.log('FAILED plan:', m, x === undefined ? '' : JSON.stringify(x)); };
    const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', acceptDownloads: true });
    const pp = await pc.newPage(); hook(pp);
    const ext = []; pc.on('request', r => { if (!/^(file|data|blob|http:\/\/127\.0\.0\.1|http:\/\/localhost):/.test(r.url())) ext.push(r.url()); });
    pp.on('dialog', d => d.accept());
    await pp.goto(URL);
    await pp.setInputFiles('#fileInput', [S('example-plan-6-months.csv')]);
    await pp.waitForSelector('#doImport'); await pp.click('#doImport'); await pp.waitForTimeout(300);
    await pp.click('#tabs [data-view=settings]'); await pp.selectOption('#sCur', 'SEK');
    await pp.click('#tabs [data-view=plan]'); await pp.waitForTimeout(150);
    const P = () => pp.evaluate(() => { const T = window.SpendingTracker, s = T.planStats(), g = T.state.plan.goals.find(x => x.kind === 'buffer');
      return { n: s.n, income: s.income, saved: s.saved, surplus: s.surplus, fixed: s.fixed, ess: s.per.map(p => p.essential), low: s.essentialLow, buf: s.bufferTarget, sug: s.suggested, rate: s.savingsRate, goal: g && { name: g.name, target: g.target, auto: g.auto } }; });
    const q25 = a => { const x = a.slice().sort((p, q) => p - q), pos = (x.length - 1) * 0.25, lo = Math.floor(pos), hi = Math.ceil(pos); return x[lo] + (x[hi] - x[lo]) * (pos - lo); };
    let ps = await P(); console.log('PLAN STATS', JSON.stringify(ps));
    if (ps.n !== 6 || ps.income !== 32000 || ps.saved !== 2000) fail('periods/income/savings', ps);
    if (Math.abs(ps.low - q25(ps.ess)) > 0.01 || ps.buf !== Math.ceil(ps.low * 3 / 100) * 100) fail('essential lower quartile + 3-month buffer', ps);
    if (ps.sug !== Math.floor(ps.surplus * 0.75 / 100) * 100) fail('suggested saving', ps);
    if (!ps.goal || ps.goal.name !== 'Buffer: 3 months of essential expenses' || ps.goal.target !== ps.buf || !ps.goal.auto) fail('default buffer goal', ps.goal);
    // essential = bare minimum: dining/shopping/subscriptions don't count, groceries/rent/bills do
    const essCheck = await pp.evaluate(k => { const S = window.SpendingTracker.state; let e = 0; S.txns.forEach(t => { if (window.SpendingTracker.periodOf(t.date) === k && ['Mortgage/Rent', 'Electricity', 'Mobile', 'Insurance', 'Supermarket', 'Public transport', 'Fuel', 'Pharmacy'].includes(t.category)) e -= t.amount; }); return Math.round(e * 100) / 100; }, '2026-04-25');
    if (Math.abs(essCheck - ps.ess[1]) > 0.01) fail('essential categories', [essCheck, ps.ess[1]]);
    const sv = await pp.evaluate(() => ({ big: document.querySelector('#planSuggest .big-num').textContent, rule: document.querySelectorAll('.rule-row').length, buf: document.querySelector('#planBuffer').textContent }));
    if (!/10,?\d00/.test(sv.big) || sv.rule !== 3 || !/3 months of essential expenses/.test(sv.buf) || !/lower quartile/.test(sv.buf)) fail('savings view', sv);
    await clean(pp); await pp.screenshot({ path: SH('32-plan-savings-phone.png'), fullPage: true });
    // insights
    await pp.click('[data-ptab=insights]'); await pp.waitForTimeout(100);
    const ins = await pp.evaluate(() => window.SpendingTracker.planInsights().map(i => ({ id: i.id, kind: i.kind, cat: i.cat || '', impact: i.impact, title: i.title })));
    console.log('INSIGHTS', JSON.stringify(ins.map(i => [i.kind, i.cat, Math.round(i.impact)])));
    const kinds = ins.map(i => i.kind);
    if (!ins.some(i => i.kind === 'Rising' && i.cat === 'Dining') || !ins.some(i => i.kind === 'Subscriptions' && i.impact === 4644) || !ins.some(i => i.kind === 'New recurring' && /Hbo Max/i.test(i.title)) || !kinds.includes('Credit') || !ins.some(i => i.kind === 'Cut 20 %' && i.cat === 'Dining')) fail('insight kinds', kinds);
    if (ins.some(i => i.kind === 'Cut 20 %' && ['Groceries', 'Housing', 'Utilities'].includes(i.cat))) fail('cut suggestions must skip essentials');
    if (ins.some((i, k) => k && ins[k - 1].impact < i.impact)) fail('ranked by impact');
    await clean(pp); await pp.screenshot({ path: SH('33-plan-insights-phone.png'), fullPage: true });
    await pp.locator('#planBody [data-dismiss]').first().click(); await pp.waitForTimeout(100);
    await pp.reload(); await pp.waitForTimeout(200); await pp.click('#tabs [data-view=plan]'); await pp.click('[data-ptab=insights]');
    const afterDis = await pp.evaluate(() => ({ shown: document.querySelectorAll('#planBody .insight').length, dis: Object.keys(window.SpendingTracker.state.plan.dismissed) }));
    if (afterDis.shown !== ins.length - 1 || afterDis.dis[0] !== ins[0].id || !(await pp.locator('#togDismissed').count())) fail('dismiss persists', afterDis);
    await pp.click('#togDismissed'); await pp.locator('#planBody [data-undismiss]').click(); await pp.waitForTimeout(100);
    if (await pp.evaluate(() => Object.keys(window.SpendingTracker.state.plan.dismissed).length)) fail('restore dismissed');
    // over budget insight
    await pp.evaluate(() => { const S = window.SpendingTracker.state; S.budgets.Dining = 600; });
    await pp.click('[data-ptab=savings]'); await pp.click('[data-ptab=insights]');
    if (!(await pp.evaluate(() => window.SpendingTracker.planInsights().some(i => i.kind === 'Over budget' && i.cat === 'Dining')))) fail('over budget insight');
    await pp.evaluate(() => { delete window.SpendingTracker.state.budgets.Dining; });
    // goals: buffer target follows settings, then can be fixed by hand
    await pp.click('#tabs [data-view=settings]');
    await pp.fill('#pBufM', '4'); await pp.press('#pBufM', 'Tab'); await pp.waitForTimeout(150);
    await pp.click('#tabs [data-view=plan]'); await pp.click('[data-ptab=goals]');
    ps = await P();
    if (ps.goal.name !== 'Buffer: 4 months of essential expenses' || ps.goal.target !== Math.ceil(ps.low * 4 / 100) * 100) fail('buffer follows months setting', ps.goal);
    await pp.click('#tabs [data-view=settings]');
    await pp.locator('#essDetails summary').click();
    await pp.locator('#planSettings [data-ess="Groceries"][data-essmain]').uncheck(); await pp.waitForTimeout(150);
    const lowNoGroc = (await P()).low;
    if (!(lowNoGroc < ps.low - 1000)) fail('toggle essential categories', [ps.low, lowNoGroc]);
    await clean(pp); await pp.locator('#planSettings').screenshot({ path: SH('36-plan-settings-phone.png') });
    await pp.click('#essReset'); await pp.fill('#pBufM', '3'); await pp.press('#pBufM', 'Tab'); await pp.waitForTimeout(150);
    ps = await P(); if (ps.goal.target !== Math.ceil(ps.low * 3 / 100) * 100 || ps.goal.name !== 'Buffer: 3 months of essential expenses') fail('reset essentials', ps.goal);
    await pp.click('#tabs [data-view=plan]'); await pp.click('[data-ptab=goals]');
    await pp.locator('.goal', { hasText: 'Buffer' }).locator('[data-gedit]').click();
    await pp.uncheck('#gAuto'); await pp.fill('#gTarget', '50000'); await pp.click('#modal .btn.primary'); await pp.waitForTimeout(100);
    await pp.click('#tabs [data-view=settings]'); await pp.fill('#pBufM', '6'); await pp.press('#pBufM', 'Tab'); await pp.waitForTimeout(100);
    ps = await P(); if (ps.goal.target !== 50000 || ps.goal.auto) fail('manual buffer target is kept', ps.goal);
    await pp.fill('#pBufM', '3'); await pp.press('#pBufM', 'Tab');
    await pp.evaluate(() => { const g = window.SpendingTracker.state.plan.goals.find(x => x.kind === 'buffer'); g.auto = true; });
    // new goal with monthly contribution + target date; manual update; savings-linked goal
    await pp.click('#tabs [data-view=plan]'); await pp.click('[data-ptab=goals]');
    await pp.click('#addGoal'); await pp.fill('#gName', 'Trip to Japan'); await pp.fill('#gTarget', '30000'); await pp.fill('#gCur', '5000'); await pp.fill('#gMonthly', '2500');
    const inOneYear = await pp.evaluate(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); });
    await pp.fill('#gDate', inOneYear); await pp.click('#modal .btn.primary'); await pp.waitForTimeout(100);
    const gs = await pp.evaluate(() => { const T = window.SpendingTracker, g = T.state.plan.goals.find(x => x.name === 'Trip to Japan'); return T.goalStatus(g); });
    const want10 = await pp.evaluate(() => { const d = new Date(); const ym = new Date(d.getFullYear(), d.getMonth() + 10, 1); return ym.getFullYear() + '-' + String(ym.getMonth() + 1).padStart(2, '0'); });
    console.log('GOAL', JSON.stringify(gs));
    if (gs.progress !== 5000 || gs.remaining !== 25000 || gs.forecast.slice(0, 7) !== want10 || Math.abs(gs.needed - 25000 / 12) > 60 || gs.late) fail('goal forecast / needed per month', gs);
    await pp.locator('.goal', { hasText: 'Trip to Japan' }).locator('[data-gupd]').click(); await pp.fill('#gNow', '7500'); await pp.click('#modal .btn.primary'); await pp.waitForTimeout(100);
    const g2 = await pp.evaluate(() => window.SpendingTracker.state.plan.goals.find(x => x.name === 'Trip to Japan'));
    if (g2.current !== 7500 || g2.history.length < 2) fail('manual progress update', g2);
    await pp.click('#addGoal'); await pp.fill('#gName', 'Savings account'); await pp.fill('#gTarget', '20000'); await pp.check('#gLink'); await pp.click('#modal .btn.primary'); await pp.waitForTimeout(100);
    const linked = await pp.evaluate(() => { const T = window.SpendingTracker, g = T.state.plan.goals.find(x => x.name === 'Savings account'); g.start = '2026-06-01'; return T.goalStatus(g); });
    if (linked.progress !== 8000 || linked.pace !== 2000) fail('goal linked to Transfers › Savings', linked);
    await pp.evaluate(() => { const g = window.SpendingTracker.state.plan.goals.find(x => x.name === 'Savings account'); g.start = '2026-06-01'; });
    await pp.click('[data-ptab=savings]'); await pp.click('[data-ptab=goals]'); await pp.waitForTimeout(100);
    await clean(pp); await pp.screenshot({ path: SH('34-plan-goals-phone.png'), fullPage: true });
    // investing: ladder, disclaimer, calculator, scenarios, fees
    await pp.click('[data-ptab=invest]'); await pp.waitForTimeout(100);
    const inv = await pp.evaluate(() => ({ disc: document.querySelector('.disclaimer').textContent, here: [...document.querySelectorAll('.ladder-step')].findIndex(e => e.classList.contains('here')), scen: [...document.querySelectorAll('#scenTable tbody tr td:first-child')].map(e => e.textContent), fees: document.querySelectorAll('#feeTable tbody tr').length, isk: [...document.querySelectorAll('details.info')].map(d => d.textContent).join(' ') }));
    if (!/not financial advice/i.test(inv.disc) || !/not guaranteed|never guaranteed/i.test(inv.disc) || inv.here !== 0 || inv.fees < 3 || !inv.scen.some(x => /1,000/.test(x)) || !inv.scen.some(x => /5,000/.test(x))) fail('investing view', inv);
    if (!/300,000/.test(inv.isk) || !/3\.55 %/.test(inv.isk) || !/1\.065 %/.test(inv.isk) || !/2026/.test(inv.isk) || !/schablonintäkt/.test(inv.isk)) fail('ISK facts', inv.isk.slice(0, 300));
    const fv = await pp.evaluate(() => { const F = window.SpendingTracker.fvSeries; return {
      zero: F({ monthly: 1000, years: 10, ret: 0, fee: 0 }).pop().value,
      seven: F({ monthly: 1000, years: 10, ret: 7, fee: 0 }).pop().value,
      fee: F({ monthly: 1000, years: 10, ret: 7, fee: 1 }).pop().value,
      real: F({ monthly: 1000, years: 10, ret: 7, fee: 0, real: true, inflation: 2 }).pop().value,
      iskSmall: F({ monthly: 1000, years: 10, ret: 7, fee: 0, isk: true }).pop().value,
      iskBig: F({ monthly: 5000, years: 20, ret: 7, fee: 0, isk: true }).pop(), noIskBig: F({ monthly: 5000, years: 20, ret: 7, fee: 0 }).pop().value }; });
    const rm = Math.pow(1.07, 1 / 12) - 1, want7 = Math.round(1000 * (Math.pow(1 + rm, 120) - 1) / rm * 100) / 100;
    console.log('FV', JSON.stringify(fv), 'want', want7);
    if (fv.zero !== 120000 || Math.abs(fv.seven - want7) > 0.05 || !(fv.fee < fv.seven) || Math.abs(fv.real - fv.seven / Math.pow(1.02, 10)) > 0.05 || fv.iskSmall !== fv.seven || !(fv.iskBig.value < fv.noIskBig && fv.iskBig.tax > 0)) fail('compound growth maths', fv);
    await pp.fill('#cMonthly', '3000'); await pp.waitForTimeout(100);
    if (!(await pp.locator('#scenTable tbody tr', { hasText: '3,000' }).count())) fail('calculator updates scenarios');
    await clean(pp); await pp.screenshot({ path: SH('35-plan-investing-phone.png'), fullPage: true });
    // tap targets + overflow on every Plan section
    const small = [];
    for (const t of ['savings', 'insights', 'goals', 'invest']) {
      await pp.click(`[data-ptab=${t}]`); await pp.waitForTimeout(80);
      await pp.evaluate(() => document.querySelectorAll('details.info').forEach(d => d.open = true));
      small.push(...await pp.evaluate(t => [...document.querySelectorAll('#view-plan button, #view-plan a.btn, #view-plan summary, #view-plan select, #view-plan input:not([type=checkbox])')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); }).map(e => t + ':' + e.tagName + (e.id ? '#' + e.id : '') + ':' + Math.round(e.getBoundingClientRect().height)), t));
      const w = await pp.evaluate(() => document.documentElement.scrollWidth); if (w > 390) small.push(t + ':overflow ' + w);
    }
    if (small.length) fail('tap targets / overflow', small.slice(0, 10));
    // dark mode
    await pp.click('#themeBtn'); await pp.click('[data-ptab=savings]'); await pp.waitForTimeout(100);
    await clean(pp); await pp.screenshot({ path: SH('37-plan-dark-phone.png') });
    await pp.click('#themeBtn');
    // backups: plan included; old backup without plan -> defaults + buffer goal
    await pp.click('#tabs [data-view=settings]');
    const [dl] = await Promise.all([pp.waitForEvent('download'), pp.click('#bExpJson')]);
    const bk = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    if (!bk.plan || bk.plan.goals.length !== 3 || bk.plan.settings.bufferMonths !== 3 || !Array.isArray(bk.plan.settings.essential)) fail('plan in JSON backup', bk.plan && bk.plan.goals.length);
    delete bk.plan; bk.settings.catVersion = 2;
    await pp.setInputFiles('#jsonInput', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) }); await pp.waitForTimeout(300);
    const old = await pp.evaluate(() => { const p = window.SpendingTracker.state.plan; return [p.goals.map(g => g.name), p.settings.bufferMonths, p.settings.ret, p.settings.inflation, p.settings.essentialMethod]; });
    if (JSON.stringify(old) !== '[["Buffer: 3 months of essential expenses"],3,7,2,"lowq"]') fail('old backup gets plan defaults', old);
    if (ext.length) fail('network requests', ext);
    await pc.close();
    if (bad) { console.log(`FAILED plan checks (${bad})`); process.exitCode = 1; } else console.log('PASS plan tab: savings, buffer, insights, goals, investing, settings, backups');
  }

  // ===== Searchable category picker (combobox), multi-category filter, category search everywhere =====
  {
    let bad = 0; const fail = (m, x) => { bad++; console.log('FAILED picker:', m, x === undefined ? '' : JSON.stringify(x)); };
    const kc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const kp = await kc.newPage(); hook(kp);
    const ext = []; kc.on('request', r => { if (!/^(file|data|blob|http:\/\/127\.0\.0\.1|http:\/\/localhost):/.test(r.url())) ext.push(r.url()); });
    await kp.goto(URL);
    await kp.setInputFiles('#fileInput', [S('example-plan-6-months.csv')]);
    await kp.waitForSelector('#doImport'); await kp.click('#doImport'); await kp.waitForTimeout(300);
    await kp.click('#tabs [data-view=settings]'); await kp.selectOption('#sCur', 'SEK');
    await kp.click('#tabs [data-view=transactions]');
    const opts = () => kp.$$eval('#catPop .cp-opt', o => o.map(x => x.dataset.v));
    const row = kp.locator('#txTable tbody tr', { hasText: 'Circle K' }).first();
    await row.locator('[data-catsel]').click(); await kp.waitForSelector('#catPop');
    const res = {};
    for (const q of ['park', 'parkering', 'mat', 'fris', 'frisör', 'FRISOR', 'cafe', 'kaffe', 'transport', 'zzzz']) { await kp.fill('#catPopInput', q); res[q] = await opts(); }
    console.log('PICKER SEARCH', JSON.stringify(res));
    if (JSON.stringify(res.park) !== '["Parking"]' || JSON.stringify(res.parkering) !== '["Parking"]') fail('park/parkering', res.park);
    if (!['Groceries', 'Supermarket', 'Dining', 'Restaurant'].every(x => res.mat.includes(x)) || res.mat.includes('Transport')) fail('mat → Groceries/Dining', res.mat);
    if (['fris', 'frisör', 'FRISOR'].some(q => JSON.stringify(res[q]) !== '["Hair/barber"]')) fail('fris → Hair/barber (accent/case-insensitive)', [res.fris, res['frisör'], res.FRISOR]);
    if (JSON.stringify(res.cafe) !== '["Café"]' || JSON.stringify(res.kaffe) !== '["Café"]') fail('cafe/kaffe', [res.cafe, res.kaffe]);
    if (res.transport[0] !== 'Transport' || !res.transport.includes('Parking') || res.transport.length !== 8) fail('main match shows all subs', res.transport);
    if (res.zzzz.length || !(await kp.locator('#catPop .cp-empty').count())) fail('no match message');
    const heads = await (async () => { await kp.fill('#catPopInput', 'mat'); return kp.$$eval('#catPop .cp-head', h => h.map(x => x.textContent)); })();
    if (JSON.stringify(heads) !== '["Groceries","Dining"]') fail('grouped under main', heads);
    await clean(kp); await kp.screenshot({ path: SH('38-category-picker-phone.png') });
    const sizes = await kp.evaluate(() => ({ opts: [...document.querySelectorAll('#catPop .cp-opt')].map(o => Math.round(o.getBoundingClientRect().height)), inp: Math.round(document.querySelector('#catPopInput').getBoundingClientRect().height), pop: document.querySelector('#catPop').getBoundingClientRect().right }));
    if (sizes.opts.some(h => h < 44) || sizes.inp < 44 || sizes.pop > 390) fail('44px targets in picker', sizes);
    await kp.fill('#catPopInput', 'park'); await kp.locator('#catPop .cp-opt[data-v="Parking"]').tap();
    await kp.waitForSelector('#rulePat'); await kp.click('#modal .btn:not(.primary):not([data-close])'); await kp.waitForTimeout(100);
    const afterPick = await kp.evaluate(() => { const S = window.SpendingTracker.state; return [S.txns.filter(t => t.category === 'Parking').length, (S.settings.recentCats || [])[0]]; });
    if (afterPick[0] !== 1 || afterPick[1] !== 'Parking') fail('pick sets category + recent', afterPick);
    await kp.locator('#txTable tbody tr [data-catsel]').first().click(); await kp.waitForSelector('#catPop');
    const rec = await kp.$$eval('#catPop [aria-label="Recently used"] .cp-opt', o => o.map(x => x.dataset.v));
    if (rec[0] !== 'Parking') fail('recently used at the top', rec);
    await kp.click('#catPopBg', { position: { x: 20, y: 820 } }); await kp.waitForTimeout(50);
    if (await kp.locator('#catPop').count()) fail('tap outside closes picker');
    // main search box matches category names (accent-insensitive)
    const search = async q => { await kp.fill('#txSearch', q); await kp.waitForTimeout(300); return kp.$$eval('#txTable tbody tr .tx-desc', r => r.map(x => x.textContent.trim())); };
    let r1 = await search('parking');
    if (r1.length !== 1 || !/Circle K/i.test(r1[0])) fail('search "parking" shows Parking transactions', r1);
    r1 = await search('public transport'); if (!r1.length || !r1.every(x => /SL Access/i.test(x))) fail('search sub name', r1.slice(0, 3));
    r1 = await search('cafe'); if (!r1.length || !r1.every(x => /Espresso/i.test(x))) fail('search accent-insensitive category', r1.slice(0, 3));
    await search('');
    // multi-category filter with chips; a main includes its subs
    await setCats(kp, ['Transport', 'Dining']);
    let fl = await kp.$$eval('#txTable tbody tr .tx-desc', r => r.map(x => x.textContent.trim()));
    const chips = await kp.$$eval('#fCats [data-chipx]', c => c.map(x => x.dataset.chipx));
    if (JSON.stringify(chips) !== '["Transport","Dining"]' || !fl.some(x => /SL Access/i.test(x)) || !fl.some(x => /Pizzeria/i.test(x)) || fl.some(x => /ICA/i.test(x))) fail('multi filter with chips', [chips, fl.length]);
    await clean(kp); await kp.screenshot({ path: SH('39-activity-category-chips-phone.png') });
    await kp.click('#fCatAdd'); await kp.waitForSelector('#catPop');
    const implied = await kp.$$eval('#catPop .cp-opt.implied', o => o.map(x => x.dataset.v));
    if (!implied.includes('Fuel') || !implied.includes('Restaurant')) fail('subs shown as included', implied);
    await kp.locator('#catPop .cp-opt[data-v="Fuel"]').click(); await kp.click('#catPopDone'); await kp.waitForTimeout(80);
    const c2 = await kp.evaluate(() => window.SpendingTracker.state && document.querySelectorAll('#fCats [data-chipx]').length);
    fl = await kp.$$eval('#txTable tbody tr .tx-desc', r => r.map(x => x.textContent.trim()));
    if (fl.filter(x => /Circle K/i.test(x)).length !== 1 || !fl.some(x => /SL Access/i.test(x)) || c2 !== 7) fail('unticking a sub of a selected main', [c2, fl.length]);
    await kp.click('#clrF'); await kp.waitForTimeout(80);
    // Settings: categories editor search, rules filter, essential checklist search
    await kp.click('#tabs [data-view=settings]');
    const visCats = () => kp.$$eval('#catList .cat-row', r => r.filter(x => !x.hidden).map(x => x.dataset.cname));
    await kp.fill('#catQ', 'fris'); let vc = await visCats();
    if (JSON.stringify(vc) !== '["Personal care","Hair/barber"]') fail('settings category search fris', vc);
    await kp.fill('#catQ', 'transport'); vc = await visCats(); if (vc.length !== 8 || vc[0] !== 'Transport') fail('settings search main expands subs', vc);
    await kp.fill('#catQ', 'mat'); vc = await visCats(); if (!vc.includes('Groceries') || !vc.includes('Dining') || vc.includes('Transport')) fail('settings search mat', vc);
    await clean(kp); await kp.locator('#catList').scrollIntoViewIfNeeded(); await kp.screenshot({ path: SH('40-settings-category-search-phone.png') });
    await kp.fill('#catQ', ''); vc = await visCats(); if (vc.length < 70) fail('clearing search shows all', vc.length);
    await kp.fill('#ruleQ', 'parkering'); await kp.waitForTimeout(400);
    const rl = await kp.evaluate(() => { const S = window.SpendingTracker.state; return [...document.querySelectorAll('.rules-list tr[data-ri]')].map(tr => S.rules[+tr.dataset.ri]).map(r => r.category + ':' + r.pattern); });
    if (!rl.length || !rl.every(x => x.startsWith('Parking:') || /parkering/i.test(x))) fail('rules filter by category synonym', rl.slice(0, 5));
    await kp.fill('#ruleQ', 'transport'); await kp.waitForTimeout(400);
    const rl2 = await kp.evaluate(() => { const S = window.SpendingTracker.state; return [...new Set([...document.querySelectorAll('.rules-list tr[data-ri]')].map(tr => S.rules[+tr.dataset.ri].category))]; });
    if (!rl2.includes('Fuel') || !rl2.includes('Taxi')) fail('rules filter by main category', rl2);
    await kp.fill('#ruleQ', ''); await kp.waitForTimeout(400);
    await kp.locator('#essDetails summary').click(); await kp.fill('#essQ', 'park');
    const ess = await kp.evaluate(() => ({ mains: [...document.querySelectorAll('#planSettings .ess-main')].filter(x => !x.hidden).map(x => x.dataset.cname), subs: [...document.querySelectorAll('#planSettings .ess-subs [data-cname]')].filter(x => !x.hidden && !x.closest('[hidden]')).map(x => x.dataset.cname) }));
    if (JSON.stringify(ess) !== '{"mains":["Transport"],"subs":["Parking"]}') fail('essential checklist search', ess);
    // rule editor picker
    await kp.fill('#ruleQ', 'netflix'); await kp.waitForTimeout(400);
    await pickCat(kp, kp.locator('.rules-list [data-rcat]').first(), 'Software/apps', 'apps');
    if (!(await kp.evaluate(() => window.SpendingTracker.state.rules.some(r => r.pattern === 'netflix' && r.category === 'Software/apps' && r.user)))) fail('rule editor picker');
    // budgets: find a category
    await kp.click('#tabs [data-view=budgets]');
    await pickCat(kp, kp.locator('#bFind'), 'Parking', 'park'); await kp.waitForTimeout(100);
    const bf = await kp.evaluate(() => ({ focus: document.activeElement && document.activeElement.dataset.budget, open: document.querySelector('details.budget-subs[data-main="Transport"]').open }));
    if (bf.focus !== 'Parking' || !bf.open) fail('budget find category', bf);
    // review picker excludes Other; edit dialog has Auto
    await kp.evaluate(() => { const S = window.SpendingTracker.state; S.txns[0].category = 'Other'; S.txns[0].catManual = false; });
    await kp.click('#tabs [data-view=review]'); await kp.locator('[data-revcat]').first().click(); await kp.waitForSelector('#catPop');
    const ro = await opts(); if (ro.includes('Other') || !ro.includes('Parking')) fail('review picker', ro.length);
    await kp.click('#catPopDone'); await kp.waitForTimeout(50);
    await kc.close();
    // desktop keyboard: type-to-open, arrows, Enter, Escape inside a dialog
    const dc = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const dp = await dc.newPage(); hook(dp);
    await dp.goto(URL); await dp.setInputFiles('#fileInput', [S('example-plan-6-months.csv')]); await dp.waitForSelector('#doImport'); await dp.click('#doImport'); await dp.waitForTimeout(300);
    await dp.click('#tabs [data-view=transactions]');
    const trg = dp.locator('#txTable tbody tr [data-catsel]').first(); await trg.focus(); await dp.keyboard.press('ArrowDown');
    if (!(await dp.locator('#catPop').count())) fail('ArrowDown opens picker');
    const pos = await dp.evaluate(() => { const a = document.querySelector('#catPop').getBoundingClientRect(), b = document.activeElement.closest('#catPop') ? document.querySelector('[aria-expanded=true].cat-pick').getBoundingClientRect() : null; return b && Math.abs(a.top - b.bottom) < 10; });
    if (!pos) fail('desktop dropdown anchored under the field');
    await dp.keyboard.press('Escape'); await dp.waitForTimeout(50);
    if ((await dp.locator('#catPop').count()) || !(await dp.evaluate(() => document.activeElement.matches('[data-catsel]')))) fail('Escape closes and refocuses');
    await dp.keyboard.type('fris'); await dp.waitForTimeout(80);
    if (await dp.inputValue('#catPopInput') !== 'fris') fail('type-to-open', await dp.inputValue('#catPopInput'));
    await dp.keyboard.press('Enter'); await dp.waitForSelector('#rulePat'); await dp.keyboard.press('Escape'); await dp.waitForTimeout(80);
    if (!(await dp.evaluate(() => window.SpendingTracker.state.txns.some(t => t.category === 'Hair/barber')))) fail('Enter picks the first match');
    await dp.locator('#txTable tbody tr [data-edit]').nth(2).click();
    await dp.click('#eCat'); await dp.waitForSelector('#catPop');
    const eo = await dp.$$eval('#catPop .cp-opt', o => o.map(x => x.dataset.v)); if (eo[0] !== '__auto') fail('edit dialog Auto option', eo.slice(0, 2));
    await dp.keyboard.type('mat'); await dp.keyboard.press('ArrowDown'); await dp.keyboard.press('ArrowDown');
    const act = await dp.$eval('#catPop .cp-opt.active', o => o.dataset.v); await dp.keyboard.press('Escape'); await dp.waitForTimeout(50);
    if (act !== 'Ethnic/specialty store' || !(await dp.locator('#modalBg.show').count())) fail('arrows + Escape keeps the dialog open', act);
    await dp.click('#eCat'); await dp.fill('#catPopInput', 'bageri'); await dp.keyboard.press('Enter');
    if (await dp.$eval('#eCat', b => b.value) !== 'Bakery') fail('edit dialog picker value');
    await dp.click('#modal .btn.primary'); await dp.waitForTimeout(100);
    await dc.close();
    if (ext.length) fail('network requests', ext);
    if (bad) { console.log(`FAILED picker checks (${bad})`); process.exitCode = 1; } else console.log('PASS searchable category picker, multi-category filter, category search in settings/rules/essentials');
  }

  console.log('CONSOLE ERRORS/WARNINGS:', errors.length ? errors : 'none');
  await browser.close();
  srv.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
