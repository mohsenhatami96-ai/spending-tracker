import { chromium } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 8767;
const URL = `http://127.0.0.1:${PORT}/spending-tracker.html`;
const D = path.resolve('samples/example-bank-D_real-dates.xlsx'), E = path.resolve('samples/example-bank-E_text-dates_debit-credit.xlsx');
const SH = f => path.resolve('screenshots', f);
const b64 = f => fs.readFileSync(f).toString('base64');
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
(async () => {
  const srv = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (urlPath === '/') urlPath = '/spending-tracker.html';
    const file = path.join(ROOT, urlPath.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const isNoise = t => /favicon/i.test(t) && /404/.test(t);
  const hook = p => { p.on('console', m => { if (['error', 'warning'].includes(m.type()) && !isNoise(m.text())) errors.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); hook(page);
  await page.goto(URL);
  check(await page.getAttribute('#fileInput', 'accept').then(a => a.includes('.xlsx')), 'file picker accepts .xlsx');

  // low-level parser checks (native DecompressionStream vs pure-JS inflate fallback)
  const low = await page.evaluate(async ([d, e]) => {
    const T = window.SpendingTracker;
    const buf = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
    const res = {};
    for (const [k, s] of [['D', d], ['E', e]]) {
      const nat = await T.parseXlsx(buf(s));
      const fb = await T.parseXlsx(buf(s), { forceFallback: true });
      res[k] = { same: JSON.stringify(nat) === JSON.stringify(fb), date1904: nat.date1904, sheets: nat.sheets.map(x => [x.name, x.rows.length]), head: nat.sheets.map(x => x.rows.slice(0, 5)) };
    }
    res.serial = [T.excelSerialToISO(46174, false), T.excelSerialToISO(44712, true), T.excelSerialToISO(1, false), T.excelSerialToISO(61, false)];
    res.fmts = ['yyyy-mm-dd', 'd mmm yyyy', '[$-409]mmmm d, yyyy', 'h:mm AM/PM', '#,##0.00;[Red]-#,##0.00', '0.00E+00', '"kr" #,##0.00', 'General', '[Red]0.00'].map(T.isDateFormatCode);
    return res;
  }, [b64(D), b64(E)]);
  console.log(JSON.stringify(low, null, 0));
  check(low.D.same && low.E.same, 'native DecompressionStream and JS inflate fallback give identical output');
  check(low.E.date1904 === true && low.D.date1904 === false, 'date system detection (1900 vs 1904)');
  check(JSON.stringify(low.serial) === JSON.stringify(['2026-06-01', '2026-06-01', '1900-01-01', '1900-03-01']), 'serial date conversion');
  check(JSON.stringify(low.fmts) === JSON.stringify([true, true, true, true, false, false, false, false, false]), 'date number-format detection');
  check(low.D.head[0][0][0] === 'EXAMPLE BANK D — fake statement for testing', 'shared rich-text string (phonetic run ignored)');
  check(low.E.head[0][0][0] === 'Exempelbanken AB - Kontoutdrag (FAKE DATA)', 'inline rich-text string');
  const dRow = low.D.head[1][1];
  check(dRow[0] === '2026-06-01' && dRow[1] === '2026-06-02' && dRow[3] === '3900' && /TRUE|FALSE/.test(dRow[4]), 'D: date cells, custom date fmt, numbers, booleans: ' + JSON.stringify(dRow));
  check(low.D.head[1].some(r => r.length === 7 && r[5] === '') , 'D: sparse cells keep column positions');
  const eRow = low.E.head[0][3];
  check(eRow[0] === '03.06.2026' && eRow[4] === '2026-06-05', 'E: text date kept, 1904 date cell converted: ' + JSON.stringify(eRow));

  // UI flow: picker with both workbooks
  await page.setInputFiles('#fileInput', [D, E]);
  await page.waitForSelector('#mapRoot table');
  const mapD = await page.evaluate(() => ({ sels: [...document.querySelectorAll('#mapRoot select')].map(s => s.dataset.k + '=' + s.options[s.selectedIndex].text), found: document.querySelectorAll('.section-title')[1].textContent, hint: document.querySelector('#mapRoot .hint').textContent }));
  console.log('MAP D', JSON.stringify(mapD));
  check(mapD.sels.includes('sheet=Transactions (34 rows)') && mapD.sels.includes('colDate=A: Booking date') && mapD.sels.includes('colAmount=D: Amount') && mapD.sels.includes('colDesc=C: Description') && /33 transactions/.test(mapD.found), 'D mapping: defaults to the data sheet, columns detected, 33 rows');
  await page.screenshot({ path: SH('15-xlsx-mapping-real-dates.png') });
  // switch to the info sheet and back
  await page.selectOption('#mapRoot select[data-k=sheet]', '0');
  const f0 = await page.evaluate(() => document.querySelectorAll('.section-title')[1].textContent);
  await page.selectOption('#mapRoot select[data-k=sheet]', '1');
  const f1 = await page.evaluate(() => document.querySelectorAll('.section-title')[1].textContent);
  check(/0 transactions/.test(f0) && /33 transactions/.test(f1), 'sheet picker switches sheets (' + f0 + ' / ' + f1 + ')');
  await page.click('#doImport');
  await page.waitForFunction(() => document.querySelector('#modal header span')?.textContent.includes('example-bank-E'));
  const mapE = await page.evaluate(() => ({ sels: [...document.querySelectorAll('#mapRoot select')].map(s => s.dataset.k + '=' + s.options[s.selectedIndex].text), found: document.querySelectorAll('.section-title')[1].textContent, preview: [...document.querySelectorAll('.mini-table')[1].querySelectorAll('tbody tr')].slice(0, 3).map(r => r.innerText.replace(/\t/g, ' | ')) }));
  console.log('MAP E', JSON.stringify(mapE));
  check(mapE.sels.some(s => s.startsWith('headerRow=Row 4: Transaction date')) && mapE.sels.includes('colDate=A: Transaction date') && mapE.sels.includes('dateFmt=DD/MM/YYYY') && mapE.sels.includes('amountMode=Separate debit / credit columns') && mapE.sels.includes('colDebit=C: Debit') && mapE.sels.includes('colCredit=D: Credit') && /28 transactions/.test(mapE.found), 'E mapping: junk title skipped, text dates DMY, debit/credit split, 28 rows');
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); await page.evaluate(() => document.querySelector('#modalBg').scrollTo(0, 0)); await page.screenshot({ path: SH('16-xlsx-mapping-text-dates-debit-credit.png') });
  await page.click('#doImport');
  await page.waitForFunction(() => !document.querySelector('#modalBg').classList.contains('show'));
  const st = await page.evaluate(() => { const s = window.SpendingTracker.state; const by = {}; s.txns.forEach(t => by[t.category] = (by[t.category] || 0) + 1);
    return { n: s.txns.length, by, other: s.txns.filter(t => t.category === 'Other').map(t => t.desc), ex: s.txns.filter(t => /REFUND|LÖN|HEMKÖP|TELIA/.test(t.desc)).map(t => [t.date, t.desc, t.amount, t.category]), rec: window.SpendingTracker.detectRecurring().map(r => r.name) }; });
  console.log('STATE', JSON.stringify(st));
  check(st.n === 61, 'imported 33 + 28 = 61 transactions');
  check(st.ex.some(x => x[1] === 'REFUND AMAZON MARKETPLACE' && x[2] === 25) && st.ex.some(x => x[1] === 'LÖN EXEMPEL AB' && x[2] === 31000 && x[3] === 'Salary') && st.ex.some(x => x[1] === 'HEMKÖP EXEMPEL' && x[2] < 0 && x[3] === 'Supermarket') && st.ex.some(x => x[1] === 'TELIA MOBIL' && x[3] === 'Mobile'), 'amount signs + categories');
  // re-import D -> duplicates
  await page.setInputFiles('#fileInput', [D]);
  await page.waitForSelector('#mapRoot table'); await page.click('#doImport'); await page.waitForTimeout(300);
  const t = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.textContent).pop());
  check(/imported 0 transactions, skipped 33 duplicates/.test(t) && (await page.evaluate(() => window.SpendingTracker.state.txns.length)) === 61, 're-import dedupe: ' + t);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await page.screenshot({ path: SH('17-dashboard-after-xlsx.png'), fullPage: true });

  // drag-and-drop path with an .xlsx (fresh profile)
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await c2.newPage(); hook(p2);
  await p2.goto(URL);
  await p2.evaluate(async s => {
    const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dropped.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64(E));
  await p2.waitForSelector('#mapRoot table');
  const dropFound = await p2.evaluate(() => document.querySelectorAll('.section-title')[1].textContent);
  check(/28 transactions/.test(dropFound), 'drag-and-drop .xlsx opens mapping (' + dropFound + ')');
  // .xls (legacy) rejected with a helpful message
  await p2.click('#modal footer .btn'); 
  await p2.setInputFiles('#fileInput', { name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('xx') });
  await p2.waitForTimeout(200);
  check(await p2.evaluate(() => [...document.querySelectorAll('.toast')].some(t => /Save it as \.xlsx or CSV/.test(t.textContent))), 'legacy .xls rejected with guidance');

  console.log('CONSOLE ERRORS/WARNINGS:', errors.length ? errors : 'none');
  if (errors.length) fail++;
  console.log(fail ? `${fail} CHECK(S) FAILED` : 'ALL XLSX CHECKS PASSED');
  await browser.close();
  srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
