import { reduced, tween } from './fx.js';
import { usdPrice, usdCompact, pct, DASH } from './fmt.js';

export const el = (tag, cls, attrs = {}) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    try {
      const t = el('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (__) { return false; }
  }
}

const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

export function copyButton(address, label) {
  const b = el('button', 'cp', { type: 'button', 'aria-label': 'Clip address for ' + label });
  b.innerHTML = COPY_SVG;
  b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (await copyText(address)) {
      b.setAttribute('data-ok', ''); b.innerHTML = CHECK_SVG; b.setAttribute('aria-label', 'Address clipped');
      setTimeout(() => { b.removeAttribute('data-ok'); b.innerHTML = COPY_SVG; b.setAttribute('aria-label', 'Clip address for ' + label); }, 1500);
    }
  });
  return b;
}

// Number cell: counts up on first value, tweens and flashes on change.
export class Cell {
  constructor(node, fmt) { this.node = node; this.fmt = fmt; this.cur = null; this.stop = null; }
  set(v) {
    const n = this.node;
    if (!Number.isFinite(v)) { this.stop && this.stop(); n.textContent = DASH; this.cur = null; return; }
    if (this.cur === v) return;
    const first = this.cur === null;
    const from = first ? 0 : this.cur;
    const dir = v > from ? 'up' : 'down';
    this.stop && this.stop();
    this.stop = tween(from, v, first ? 900 : 600, (x) => { n.textContent = this.fmt(x); });
    if (!first && !reduced) {
      n.classList.remove('flash-up', 'flash-down'); void n.offsetWidth;
      n.classList.add('flash-' + dir);
    }
    this.cur = v;
  }
}

// Letter tile shows two characters, so the fallback always reads as a mark.
export const tileText = (sym) => {
  const s = (sym || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
  return s.length >= 2 ? s : (s + 'XX').slice(0, 2);
};

export function logoNode(image, sym, fallbackSrc) {
  const tile = () => { const t = el('span', 'tile', { 'aria-hidden': 'true', 'data-tile': '' }); t.textContent = tileText(sym); return t; };
  if (!image && !fallbackSrc) return tile();
  const img = el('img', 'logo', { width: '36', height: '36', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.src = image || fallbackSrc;
  img.addEventListener('error', () => {
    if (fallbackSrc && !img.src.endsWith(fallbackSrc)) { img.src = fallbackSrc; return; }
    img.replaceWith(tile());
  });
  return img;
}

export function initTabs(root) {
  const tabs = [...root.querySelectorAll('[role=tab]')];
  const pick = (t, focus) => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t));
    t.addEventListener('keydown', (e) => {
      const map = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in map)) return;
      e.preventDefault(); pick(tabs[(map[e.key] + tabs.length) % tabs.length], true);
    });
  });
}

export const fmt = { usdPrice, usdCompact, pct };
