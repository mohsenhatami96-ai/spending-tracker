/* ---------------- CSV parsing (hand-written, RFC4180-style, tolerant) ---------------- */
export function parseCSV(text, delim) {
  const rows = []; let row = [], field = '', inQ = false, i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { inQ = true; field = ''; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; i++; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map(r => r.map(f => f.trim())).filter(r => r.some(f => f !== ''));
}
export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 40).join('\n');
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const rows = parseCSV(sample, d);
    if (!rows.length) continue;
    const counts = {}; rows.forEach(r => counts[r.length] = (counts[r.length] || 0) + 1);
    const mode = +Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b - a)[0];
    if (mode < 2) continue;
    const score = counts[mode] / rows.length * 100 + Math.min(mode, 20) * 0.5;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}


