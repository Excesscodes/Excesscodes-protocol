import { el, logoNode } from './ui.js';
import { pct, usdPrice, DASH } from './fmt.js';
import { reduced } from './fx.js';

const track = () => document.getElementById('ticker-track');
let sig = '';

function item(d, own) {
  const n = el('span', 'tk', { 'data-a': d.address });
  const logo = logoNode(own ? d.image : d.image, d.symbol, own ? '/assets/logo-192.png' : '');
  logo.classList.add('tk-logo'); logo.style.width = '22px'; logo.style.height = '22px';
  const b = el('b'); b.textContent = d.symbol;
  const px = el('span', 'tk-px'); const ch = el('span', 'tk-ch');
  n.append(logo, b, px, ch);
  return n;
}

function paint(n, d) {
  n.querySelector('.tk-px').textContent = usdPrice(d.price);
  const c = n.querySelector('.tk-ch');
  c.textContent = pct(d.change);
  c.className = 'tk-ch ' + (d.change > 0 ? 'up' : d.change < 0 ? 'down' : '');
}

export function renderTicker(rows, own, status) {
  const t = track();
  if (!rows.length && !own) {
    if (status === 'down') { t.textContent = ''; const s = el('span', 'tk'); s.textContent = DASH; t.append(s); sig = 'dash'; return; }
    if (sig !== 'skel') { t.textContent = ''; for (let i = 0; i < 6; i++) t.append(el('span', 'skel tk-skel')); sig = 'skel'; t.style.animation = 'none'; }
    return;
  }
  const list = [...(own ? [{ ...own, __own: true }] : []), ...rows];
  const next = list.map((d) => d.address).join(',');
  if (next !== sig) {
    sig = next; t.textContent = ''; t.style.animation = '';
    const once = list.map((d) => item(d, !!d.__own));
    once.forEach((n, i) => { n.setAttribute('data-i', String(i)); t.append(n); });
    if (!reduced) list.forEach((d, i) => { const c = once[i].cloneNode(true); c.setAttribute('data-clone', ''); t.append(c); });
    if (!reduced) {
      requestAnimationFrame(() => {
        const half = t.scrollWidth / 2;
        t.style.setProperty('--tape-d', Math.max(24, half / 55).toFixed(1) + 's');
      });
    }
  }
  const nodes = [...t.children];
  for (const d of list) for (const n of nodes) if (n.getAttribute('data-a') === d.address) paint(n, d);
}
