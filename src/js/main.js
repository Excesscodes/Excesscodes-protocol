import { record, isStated, handleOf, caValue } from './register.js';
import { initReveal, initProgress, initParallax, initSpotlight } from './fx.js';
import { el, copyText, initTabs } from './ui.js';
import { subscribe, start } from './market.js';
import { render } from './board.js';
import { renderTicker } from './ticker.js';
import { short } from './fmt.js';

const $ = (id) => document.getElementById(id);

const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const GH_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch (_) { return ''; } };

/* contract slot */
function renderCA() {
  const slot = $('ca-slot');
  const ca = caValue();
  const body = slot.querySelector('.ca-body');
  body.textContent = '';
  if (!ca) {
    slot.setAttribute('data-state', record('ca').state === 'unconfirmed' ? 'unconfirmed' : 'absent');
    const p = el('span', 'ca-pending'); p.textContent = 'pending'; body.append(p);
    return;
  }
  slot.setAttribute('data-state', 'stated');
  const b = el('button', 'ca-copy', { type: 'button', 'aria-label': 'Clip the address' });
  const a = el('span', 'ca-addr'); a.textContent = ca;
  const fb = el('span', 'ca-fb', { 'aria-live': 'polite' }); fb.textContent = 'Clip';
  b.append(a, fb); body.append(b);
  let tm = 0;
  b.addEventListener('click', async () => {
    if (!(await copyText(ca))) { fb.textContent = 'Failed'; return; }
    slot.setAttribute('data-copied', ''); fb.textContent = 'Clipped';
    clearTimeout(tm); tm = setTimeout(() => { slot.removeAttribute('data-copied'); fb.textContent = 'Clip'; }, 1600);
  });
}

/* social icons, both always rendered, inert unless the record is stated */
function renderSocial() {
  const nav = $('social');
  nav.textContent = '';
  for (const [id, svg] of [['x', X_SVG], ['github', GH_SVG]]) {
    const r = record(id);
    const url = isStated(r) ? safeUrl(r.url) : '';
    const a = el('a', 'soc', { 'data-social': id });
    if (url) {
      const h = handleOf(url);
      a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
      a.setAttribute('aria-label', r.label + (h ? ', ' + h : ''));
      a.setAttribute('title', r.label + (h ? ' ' + h : ''));
    } else {
      a.setAttribute('role', 'link'); a.setAttribute('aria-disabled', 'true'); a.setAttribute('data-inert', '');
      a.setAttribute('aria-label', r.label + ', pending'); a.setAttribute('title', r.label + ' · pending');
    }
    a.innerHTML = svg;
    nav.append(a);
  }
}

/* fact sheet */
const fact = (dl, label, content) => {
  const row = el('div', 'fact'); const dt = el('dt'); dt.textContent = label; const dd = el('dd');
  if (content instanceof Node) dd.append(content); else dd.textContent = content;
  row.append(dt, dd); dl.append(row); return dd;
};
const pendingChip = () => { const c = el('span', 'chip'); c.textContent = 'pending'; return c; };

function recordFact(dl, id) {
  const r = record(id);
  if (!isStated(r)) { fact(dl, r.label || id, pendingChip()); return; }
  if (r.kind === 'social') {
    const url = safeUrl(r.url);
    if (!url) { fact(dl, r.label, pendingChip()); return; }
    const a = el('a', 'chip', { href: url, target: '_blank', rel: 'noopener noreferrer' }); a.textContent = handleOf(url);
    fact(dl, r.label, a); return;
  }
  const dd = fact(dl, r.label, r.value || '');
  if (r.kind === 'address') dd.classList.add('mono');
}

function renderFacts() {
  const mk = (id) => { const p = $(id); p.textContent = ''; const dl = el('dl', 'facts'); p.append(dl); return dl; };
  const a = mk('pane-token');
  ['ca', 'x', 'github'].forEach((id) => recordFact(a, id));

  const n = mk('pane-network');
  const chain = record('chain');
  if (isStated(chain)) {
    fact(n, chain.label, chain.value);
    if (chain.source) fact(n, 'Provenance', chain.source.charAt(0).toUpperCase() + chain.source.slice(1));
    try { fact(n, 'Node host', new URL(chain.rpc).hostname); } catch (_) { /* no rpc stated */ }
  } else recordFact(n, 'chain');

  const f = mk('pane-feed');
  ['market-source', 'own-source'].forEach((id) => recordFact(f, id));
  if (isStated(record('market-source'))) fact(f, 'Refresh', 'Re-pulled at a 60 second rhythm whenever this tab is showing');
}

/* status wiring */
const LABEL = { idle: 'Connecting', live: 'Live', retry: 'Retrying', down: 'Feed down' };
function setStatus(status) {
  for (const id of ['hero-pill', 'board-pill']) {
    const p = $(id); p.setAttribute('data-state', status); p.querySelector('.pill-text').textContent = LABEL[status] || LABEL.idle;
  }
  const feed = $('fig-feed'); feed.textContent = status === 'live' ? 'Live' : status === 'retry' ? 'Retrying' : status === 'down' ? 'Down' : '—';
}

function renderFigures(shown) {
  const chain = record('chain');
  $('fig-chain').textContent = isStated(chain) ? chain.value : 'pending';
  const ca = caValue();
  const fc = $('fig-ca');
  if (ca) { fc.textContent = short(ca); fc.removeAttribute('data-dim'); } else { fc.textContent = 'pending'; fc.setAttribute('data-dim', ''); }
  $('fig-rows').textContent = shown > 0 ? String(shown) : '—';
}

function onState(state) {
  const t = state.trending;
  const { shown, trending, ownRow } = render(state);
  setStatus(t.status === 'idle' ? 'idle' : t.status);
  renderFigures(shown);
  renderTicker(t.hasData ? t.rows.filter((r) => r.address !== caValue()) : [], ownRow, t.status);
  const note = $('board-note');
  if (t.status === 'down') { note.setAttribute('data-err', ''); note.textContent = 'The market source did not answer. Dashes mark the gaps while we retry.'; }
  else if (t.status === 'retry') { note.setAttribute('data-err', ''); note.textContent = 'Source hiccup. Showing the last good data while we retry.'; }
  else { note.removeAttribute('data-err'); note.textContent = ''; }
  void trending;
}

function boot() {
  const meta = el('meta', '', { name: 'theme-color' });
  meta.content = getComputedStyle(document.documentElement).getPropertyValue('--color-ground-deep').trim();
  document.head.append(meta);

  renderCA(); renderSocial(); renderFacts(); renderFigures(0);
  initTabs(document.querySelector('.tabs'));
  initReveal(); initProgress(); initParallax(); initSpotlight();
  subscribe(onState);
  start();
}
boot();
