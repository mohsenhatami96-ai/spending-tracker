export const $ = (s, el) => (el || document).querySelector(s);
export const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function toast(msg, isErr) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3200);
}

let modalOnClose = null;
export function openModal(title, bodyHTML, buttons, opts) {
  opts = opts || {};
  const m = $('#modal');
  m.className = 'modal' + (opts.wide ? ' wide' : '');
  m.innerHTML = `<header><span>${esc(title)}</span><button class="btn icon" data-close aria-label="Close">✕</button></header><div class="body">${bodyHTML}</div><footer></footer>`;
  const f = $('footer', m);
  (buttons || []).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls || '');
    btn.textContent = b.label;
    if (b.id) btn.id = b.id;
    btn.onclick = () => { if (b.onClick && b.onClick() === false) return; if (!b.keepOpen) closeModal(!!b.cancel); };
    f.appendChild(btn);
  });
  $('[data-close]', m).onclick = () => closeModal(true);
  modalOnClose = opts.onClose || null;
  $('#modalBg').classList.add('show');
  const first = $('input,select,textarea', m); if (first && !opts.noFocus) setTimeout(() => first.focus(), 30);
  return m;
}
export function closeModal(cancelled) {
  if (!$('#modalBg').classList.contains('show')) return;
  $('#modalBg').classList.remove('show');
  const cb = modalOnClose; modalOnClose = null;
  if (cb) cb(!!cancelled);
}

let modalGlobalsInstalled = false;
export function installModalGlobals() {
  if (modalGlobalsInstalled) return;
  modalGlobalsInstalled = true;
  $('#modalBg').addEventListener('mousedown', e => { if (e.target.id === 'modalBg') closeModal(true); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modalBg').classList.contains('show')) closeModal(true); });
}
