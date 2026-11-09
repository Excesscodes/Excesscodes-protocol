import { caValue } from './register.js';
import { el, Cell, copyButton, logoNode, fmt } from './ui.js';
import { DASH } from './fmt.js';

const OWN_LOGO = '/assets/logo-192.png';
const BRAND_LOGO = '/assets/excess-logo.png';
const NUMCOLS = [['c-prc', 'Spot'], ['c-chg', '24h'], ['c-vol', 'Volume'], ['c-liq', 'Liquidity']];

function buildRow(rank, d, own) {
  const row = el('div', 'brow' + (own ? ' brow-own' : ''), { role: 'row', 'data-spot': '', 'data-addr': d.address });
  const rk = el('span', 'rank', { role: 'cell' }); rk.textContent = String(rank);
  const who = d.url
    ? el('a', 'who', { role: 'cell', href: d.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': d.symbol + ' on DexScreener' })
    : el('span', 'who', { role: 'cell' });
  const t = el('span', 'who-t'); const b = el('b'); b.textContent = d.symbol;
  const s = el('small'); s.textContent = d.name || ''; t.append(b, s);
  who.append(logoNode(d.image, d.symbol, own ? OWN_LOGO : ''), t);
  row.append(rk, who);
  const c = {};
  const fm = { 'c-prc': fmt.usdPrice, 'c-chg': fmt.pct, 'c-vol': fmt.usdCompact, 'c-liq': fmt.usdCompact };
  for (const [cls, l] of NUMCOLS) {
    const n = el('span', 'cell num ' + cls, { role: 'cell', 'data-l': l });
    row.append(n); c[cls] = { n, c: new Cell(n, fm[cls]) };
  }
  const cp = el('span', 'c-cp', { role: 'cell' }); cp.append(copyButton(d.address, d.symbol)); row.append(cp);
  return { row, c, rank: rk };
}

function apply(h, d) {
  h.c['c-prc'].c.set(d.price);
  h.c['c-chg'].c.set(d.change);
  h.c['c-chg'].n.classList.toggle('up', d.change > 0);
  h.c['c-chg'].n.classList.toggle('down', d.change < 0);
  h.c['c-vol'].c.set(d.volume);
  h.c['c-liq'].c.set(d.liquidity);
  const label = d.liquidityLabel || 'Liquidity';
  const ln = h.c['c-liq'].n;
  ln.setAttribute('data-l', label);
  if (label !== 'Liquidity') ln.setAttribute('title', label); else ln.removeAttribute('title');
}

function skeletonRow(i) {
  const r = el('div', 'brow brow-skel', { 'aria-hidden': 'true', 'data-skel': '' });
  r.append(el('span', 'skel', { style: 'width:14px' }));
  const w = el('span', 'who'); w.append(el('span', 'skel logo-s'), el('span', 'skel', { style: 'width:96px' })); r.append(w);
  for (let k = 0; k < 4; k++) r.append(el('span', 'skel', { style: 'width:70%;margin-left:auto' }));
  r.append(el('span'));
  r.style.setProperty('--i', String(i));
  return r;
}

function dashRow(rank) {
  const r = el('div', 'brow', { role: 'row', 'data-dash': '' });
  const rk = el('span', 'rank', { role: 'cell' }); rk.textContent = String(rank);
  const w = el('span', 'who', { role: 'cell' });
  const tile = el('span', 'tile', { 'aria-hidden': 'true' }); tile.textContent = DASH;
  const t = el('b'); t.textContent = DASH; w.append(tile, t);
  r.append(rk, w);
  for (const [cls, l] of NUMCOLS) { const n = el('span', 'cell num ' + cls, { role: 'cell', 'data-l': l }); n.textContent = DASH; r.append(n); }
  r.append(el('span', 'c-cp', { role: 'cell' }));
  return r;
}

function placeholderOwn() {
  const r = el('div', 'brow brow-own is-placeholder', { role: 'row', 'data-own': 'placeholder', 'data-spot': '' });
  const rk = el('span', 'rank', { role: 'cell' }); rk.textContent = '1';
  const w = el('span', 'who', { role: 'cell' });
  const img = el('img', 'logo logo-brand', { src: BRAND_LOGO, width: '36', height: '36', alt: '' });
  const t = el('span', 'who-t'); const b = el('b'); b.textContent = 'EXCESS';
  const s = el('small'); s.textContent = 'pending'; t.append(b, s);
  w.append(img, t); r.append(rk, w);
  const dots = '· · · · ·';
  const vals = { 'c-prc': '$0.00', 'c-chg': dots, 'c-vol': dots, 'c-liq': dots };
  for (const [cls, l] of NUMCOLS) { const n = el('span', 'cell num ' + cls, { role: 'cell', 'data-l': l }); n.textContent = vals[cls]; r.append(n); }
  const cp = el('span', 'c-cp', { role: 'cell' }); const none = el('span', 'cp-none', { 'aria-hidden': 'true' }); none.textContent = '·'; cp.append(none); r.append(cp);
  return r;
}

const live = new Map(); // address -> handle
let ownHandle = null, ownCa = '', kind = '';

export function render(state) {
  const host = document.getElementById('board-body');
  const ca = caValue();
  const t = state.trending;
  const trending = t.rows.filter((r) => r.address !== ca).slice(0, 9); // dedup: own token leaves the trending set
  const ownRow = ca ? state.own.row : null;

  // row 1
  const wantLive = !!(ca && ownRow);
  const curOwn = host.querySelector('[data-own]');
  if (wantLive) {
    if (!ownHandle || ownCa !== ca) {
      curOwn && curOwn.remove();
      ownHandle = buildRow(1, ownRow, true);
      ownHandle.row.setAttribute('data-own', 'live');
      ownHandle.row.classList.add('brow-in');
      ownHandle.row.style.setProperty('--i', '0');
      ownCa = ca;
      host.prepend(ownHandle.row);
    }
    apply(ownHandle, ownRow);
  } else if (!curOwn || curOwn.getAttribute('data-own') !== 'placeholder') {
    curOwn && curOwn.remove();
    ownHandle = null; ownCa = '';
    host.prepend(placeholderOwn());
  }

  // rows 2 to 10
  const want = t.hasData ? 'data' : t.status === 'down' ? 'dash' : 'skel';
  const rest = () => [...host.children].filter((c) => !c.hasAttribute('data-own'));
  if (want !== kind) {
    kind = want;
    rest().forEach((c) => c.remove());
    live.clear();
    if (want === 'skel') for (let i = 0; i < 9; i++) host.append(skeletonRow(i + 1));
    if (want === 'dash') for (let i = 0; i < 9; i++) host.append(dashRow(i + 2));
  }
  if (want === 'data') {
    const keep = new Set(trending.map((r) => r.address));
    for (const [a, h] of live) if (!keep.has(a)) { h.row.remove(); live.delete(a); }
    trending.forEach((d, i) => {
      let h = live.get(d.address);
      if (!h) {
        h = buildRow(i + 2, d, false);
        h.row.classList.add('brow-in');
        h.row.style.setProperty('--i', String(i + 1));
        live.set(d.address, h);
      }
      h.rank.textContent = String(i + 2);
      apply(h, d);
      const at = host.children[i + 1] || null;
      if (h.row !== at) host.insertBefore(h.row, at); // move only when rank changed, so entry animation never replays
    });
  }
  return { shown: (wantLive ? 1 : 0) + (want === 'data' ? trending.length : 0), trending, ownRow: wantLive ? ownRow : null };
}
