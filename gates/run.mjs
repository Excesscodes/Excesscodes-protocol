// npm run gates: static checks plus a headless browser run of both register branches.
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import puppeteer from 'puppeteer-core';
import { serve } from '../scripts/serve.mjs';
import * as fx from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const R = (...a) => path.join(root, ...a);

const results = [];
let group = '';
const ck = (id, name, ok, detail = '') => {
  results.push({ id, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${name}${ok || !detail ? '' : '\n        -> ' + detail}`);
};
const section = (s) => { group = s; console.log('\n== ' + s); };

async function walk(dir, skip = []) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, skip))); else out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
const textExt = /\.(html|css|js|mjs|json|svg|md|txt|py)$/i;

// ------------------------------------------------------------------ build first
console.log('building');
execFileSync(process.execPath, [R('scripts/build.mjs')], { stdio: 'inherit' });

const distFiles = await walk(dist);
const distText = {};
for (const f of distFiles) if (textExt.test(f) || path.basename(f) === '_headers') distText[rel(f)] = await readFile(f, 'utf8');

const regSrc = JSON.parse(await readFile(R('register/register.json'), 'utf8'));
const pal = JSON.parse(await readFile(R('tokens/palette.json'), 'utf8'));

// ================================================================== STATIC
section('static: structure and hygiene');
ck('S01', 'dist/ holds index, favicon, tokens, logos', ['dist/index.html', 'dist/favicon.svg', 'dist/css/tokens.css', 'dist/assets/excess-logo.png', 'dist/assets/logo-192.png'].every((f) => existsSync(R(f))));
ck('S02', 'repo files live in root, not in dist', ['README.md', 'docs/whitepaper.md', 'LICENSE'].every((f) => existsSync(R(f))) && !distFiles.some((f) => /README|whitepaper|LICENSE/i.test(path.basename(f))));
const lic = existsSync(R('LICENSE')) ? await readFile(R('LICENSE'), 'utf8') : '';
ck('S03', 'LICENSE is MIT, copyright EXCESS, 2026', /MIT License/.test(lic) && /Copyright \(c\) 2026 EXCESS/.test(lic));

const BAD = new RegExp(['cla' + 'ude', 'anthr' + 'opic', '\bA\.?I\b', 'generated ' + 'with', 'co-' + 'authored', 'co' + 'pilot', 'chat' + 'gpt', 'language ' + 'model'].join('|'), 'i');
const repoFiles = (await walk(root, ['node_modules', 'brand', 'reference', '.git', 'package-lock.json'])).filter((f) => textExt.test(f) || /LICENSE$/.test(f));
const dirty = [];
for (const f of repoFiles) { if (rel(f) === 'gates/reference-copy.txt') continue; const t = await readFile(f, 'utf8'); const m = BAD.exec(t); if (m) dirty.push(rel(f) + ':' + m[0]); }
ck('S04', 'no AI attribution anywhere in the repo text', dirty.length === 0, dirty.join(', '));
ck('S05', 'no assistant config file and no assistant config folder', !existsSync(R('CLA' + 'UDE.md')) && !existsSync(R('.cla' + 'ude')) && !existsSync(R('dist/CLA' + 'UDE.md')));

section('static: palette and colour literals');
const hexRe = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{3}\b(?![\w-])/g;
const fnRe = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const hexHits = [];
for (const [f, t] of Object.entries(distText)) {
  if (f === 'dist/css/tokens.css' || f === 'dist/favicon.svg') continue;
  if (f === 'dist/_headers') continue;
  const stripped = t.replace(/href="#[\w-]+"/g, '').replace(/id="[^"]*"/g, '');
  const m = stripped.match(hexRe); if (m) hexHits.push(f + ':' + m[0]);
  if (fnRe.test(t)) hexHits.push(f + ':fn()');
}
ck('S06', 'colour literals only in tokens.css (favicon asset excepted)', hexHits.length === 0, hexHits.join(', '));
const tokensCss = distText['dist/css/tokens.css'];
ck('S07', 'tokens.css carries provenance for every token', pal.tokens.every((t) => tokensCss.includes(t.hex) && tokensCss.includes(t.file) && tokensCss.includes(`x${t.x},y${t.y}`)) && /k-means/.test(tokensCss));

let pixelOk = true, pxDetail = '';
for (const t of pal.tokens) {
  const { data, info } = await sharp(R(t.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (t.y * info.width + t.x) * 3;
  const got = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (got !== t.hex) { pixelOk = false; pxDetail += `${t.name} ${t.hex} != ${got}; `; }
}
ck('S08', 'every token equals the real pixel at its recorded coordinate', pixelOk, pxDetail);
ck('S09', 'favicon colours are palette tokens', (() => { const f = distText['dist/favicon.svg']; const hs = f.match(/#[0-9a-f]{6}/gi) || []; return hs.length >= 2 && hs.every((h) => pal.tokens.some((t) => t.hex === h)); })());

section('static: assets');
const srcMeta = await sharp(R('brand/LOGO EXCESS PNG...png')).metadata();
const srcRaw = await sharp(R('brand/LOGO EXCESS PNG...png')).ensureAlpha().raw().toBuffer();
let blackTransparent = 0; for (let i = 0; i < srcRaw.length; i += 4) if (srcRaw[i + 3] === 0 && srcRaw[i] + srcRaw[i + 1] + srcRaw[i + 2] === 0) blackTransparent++;
ck('S10', 'logo source is colour type 6 with pure-black transparent regions (premultiplied path required)', srcMeta.channels === 4 && blackTransparent > 1e6, `channels ${srcMeta.channels} blackTransparent ${blackTransparent}`);
{
  const { data, info } = await sharp(R('dist/assets/excess-logo.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cream = pal.tokens.find((t) => t.name === 'cream').hex; const c = [1, 3, 5].map((i) => parseInt(cream.slice(i, i + 2), 16));
  let edge = 0, worst = 0;
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3]; if (a >= 24 && a <= 231) { edge++; worst = Math.max(worst, Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2])); } }
  ck('S11', 'resized logo has no dark fringe on partial alpha', info.channels === 4 && edge > 200 && worst <= 20, `edgePx ${edge} worstDelta ${worst}`);
}
const fav = distText['dist/favicon.svg'] || '';
ck('S12', 'favicon is SVG 32x32 with no XML comment and no double hyphen', /width="32"/.test(fav) && /height="32"/.test(fav) && /viewBox="0 0 32 32"/.test(fav) && !fav.includes('--') && !fav.includes('<!--'));
ck('S13', 'favicon is traced vector with holes, not an embedded raster', /fill-rule="evenodd"/.test(fav) && !/<image|data:image/.test(fav) && (fav.match(/M /g) || []).length >= 4);

section('static: register rules');
const recs = regSrc.records;
const inertBad = Object.entries(recs).filter(([, r]) => r.state !== 'stated' && ('value' in r || 'url' in r)).map(([k]) => k);
ck('S14', 'inert records carry no value and no url', inertBad.length === 0, inertBad.join(','));
ck('S15', 'every record has a legal state', Object.values(recs).every((r) => ['stated', 'absent', 'unconfirmed'].includes(r.state)));
const html = distText['dist/index.html'];
const inline = JSON.parse(/id="register-data">([\s\S]*?)<\/script>/.exec(html)[1]);
ck('S16', 'inline register holds no dates and no recorded field', !JSON.stringify(inline).includes('recorded') && !/\d{4}-\d{2}-\d{2}/.test(JSON.stringify(inline)));
ck('S17', 'inline register inert records also stripped of everything but label, kind, state', Object.values(inline.records).filter((r) => r.state !== 'stated').every((r) => Object.keys(r).every((k) => ['label', 'kind', 'state'].includes(k))));
ck('S18', 'dates stay in register.json as data', Object.values(recs).every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.recorded || '')));
ck('S19', 'chain record states Solana, publicnode rpc, client statement, batch-level', recs.chain.value === 'Solana' && recs.chain.rpc === 'https://solana-rpc.publicnode.com' && recs.chain.source === 'client statement' && recs.chain.scope === 'batch-level');

section('static: dates, units, cadence');
const DATE_RES = [/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/, /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, /\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/i, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\blast (updated|checked|seen)\b/i, /(?<![\d.,₀-₉])(19|20)\d{2}(?![\d.,])/];
const dateHits = [];
for (const [f, t] of Object.entries(distText)) {
  if (!/\.(html|js|css)$/.test(f)) continue;
  const scan = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  for (const re of DATE_RES.slice(0, 5)) { const m = scan.match(re); if (m) dateHits.push(f + ':' + m[0]); }
}
const htmlVisible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '');
for (const re of DATE_RES) { const m = htmlVisible.match(re); if (m) dateHits.push('html-text:' + m[0]); }
ck('S20', 'no date, timestamp or clock string in shipped files', dateHits.length === 0, dateHits.join(', '));
ck('S21', 'no ch units in css', !/\d(\.\d+)?ch\b/.test(distText['dist/css/app.css']));
ck('S22', 'poll interval is 60 s and backoff is exponential', /interval = 60000/.test(distText['dist/js/poller.js']) && /2 \*\* \(failures - 1\)/.test(distText['dist/js/poller.js']) && /visibilitychange/.test(distText['dist/js/poller.js']));
ck('S23', 'reduced-motion block present and kills animation and transition', /prefers-reduced-motion:reduce[\s\S]*animation:none!important[\s\S]*transition:none!important/.test(distText['dist/css/app.css']));
ck('S24', 'own row keyframes named ownPulse, 2s ease-in-out infinite, mint left border', /\.brow-own\{border-left:2px solid var\(--color-mint\);animation:ownPulse 2s ease-in-out infinite\}/.test(distText['dist/css/app.css']));
ck('S25', 'own row never reads the dexscreener cdn logo', !/image\s*=\s*.*imageUrl/.test(distText['dist/js/market.js'].split('async function pullOwn')[1] || '') && /image_uri/.test(distText['dist/js/market.js']));

// address scanner (rule 3): match address-shaped strings against stated registry, CA exempt
function scanAddresses(files, register) {
  const stated = Object.values(register.records).filter((r) => r.state === 'stated' && typeof r.value === 'string').map((r) => r.value.toLowerCase());
  const ca = register.records.ca && register.records.ca.state === 'stated' ? String(register.records.ca.value).toLowerCase() : null;
  const bad = [];
  for (const [f, t] of Object.entries(files)) {
    if (!/\.(html|js|css|json)$/.test(f)) continue;
    const found = t.match(/0x[0-9a-fA-F]{40}\b|(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g) || [];
    for (const a of found) { const l = a.toLowerCase(); if (l === ca) continue; if (!stated.includes(l)) bad.push(f + ':' + a); }
  }
  return bad;
}
ck('S26', 'address scanner: dist has no address-shaped string outside the stated registry', scanAddresses(distText, inline).length === 0, scanAddresses(distText, inline).join(','));
{
  const evm = '0x' + 'ab'.repeat(20);
  const reg = (st) => ({ records: { evm: { state: st, value: st === 'stated' ? evm : undefined } } });
  ck('S27', 'address scanner passes a 0x address when the registry states it', scanAddresses({ 'x.js': 'const a="' + evm + '"' }, reg('stated')).length === 0);
  ck('S28', 'address scanner rejects the same 0x address when not stated', scanAddresses({ 'x.js': 'const a="' + evm + '"' }, reg('absent')).length === 1);
  const regCa = { records: { ca: { state: 'stated', value: fx.OWN_CA } } };
  ck('S29', 'address scanner exempts the contract address itself', scanAddresses({ 'x.js': fx.OWN_CA }, regCa).length === 0);
  ck('S30', 'address scanner flags a stray base58 address', scanAddresses({ 'x.js': fx.TREND[0] }, regCa).length === 1);
}

// ================================================================== COPY
section('copy: zero shared 2-grams with the reference');
const refText = await readFile(R('gates/reference-copy.txt'), 'utf8');
const STOP = new Set('a an the of in on at to for from by with and or but if as is are was were be been it its this that these those you your we our us they them their he she his her not no so than then there here into out up down over under about after before between per via what which who whom how when where why can will do does did has have had just only also more most very'.split(' '));
const words = (s) => (s.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) || []);
const units = (s) => s.split(/[\n.!?;:·|—]+/).map(words).filter((w) => w.length);
const bigrams = (us) => { const o = new Set(); for (const u of us) for (let i = 0; i + 1 < u.length; i++) o.add(u[i] + ' ' + u[i + 1]); return o; };
const refBi = bigrams(units(refText));
const refVocab = new Set(words(refText));
const ALLOWED_SHARED = new Set(['solana', 'codes']); // solana: chain name; codes: part of our own domain name

// ================================================================== BROWSER
await mkdir(R('reports'), { recursive: true });
section('browser: harness');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!EDGE) { ck('B00', 'a Chromium browser is installed for the browser gates', false, 'none found'); finish(); }
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

// generic, state-independent mutation: toggles whatever the record currently is
function flip(rec, id) {
  if (rec.state === 'stated') { return { label: rec.label, ...(rec.kind ? { kind: rec.kind } : {}), state: 'absent' }; }
  const synth = { ca: { value: fx.OWN_CA }, x: { url: 'https://x.com/excess_test' }, github: { url: 'https://github.com/excess-test' }, 'market-source': { value: 'DexScreener', boosts: 'https://api.dexscreener.com/token-boosts/top/v1', pairs: 'https://api.dexscreener.com/tokens/v1/solana/' }, 'own-source': { value: 'x', pairs: 'https://api.dexscreener.com/latest/dex/tokens/', logo: 'https://frontend-api.pump.fun/coins/' }, chain: { value: 'Solana' } }[id] || {};
  return { ...rec, state: 'stated', ...synth };
}
const mutator = (ids) => (reg) => { for (const id of ids) reg.records[id] = flip(reg.records[id], id); return reg; };

let port = 4300;
async function open({ ids = [], vp = [1440, 900], reduced = false, api = {}, label = '' }) {
  const p = port++;
  const server = await serve(p, async (u, body) => {
    if (u !== '/index.html' || !ids.length) return body;
    const s = body.toString('utf8');
    return s.replace(/(id="register-data">)([\s\S]*?)(<\/script>)/, (_, a, j, c) => a + JSON.stringify(mutator(ids)(JSON.parse(j))).replace(/</g, '\\u003c') + c);
  });
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(`http://127.0.0.1:${p}`, ['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const st = { reqs: [], logs: [], hosts: new Set(), api: { boosts: 'ok', pairs: 'ok', own: 'ok', pump: 'ok', delay: 0, liquidityUsd: 0, ...api } };
  await page.setViewport({ width: vp[0], height: vp[1], deviceScaleFactor: 1, isMobile: vp[0] < 500, hasTouch: vp[0] < 500 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setRequestInterception(true);
  page.on('console', (m) => st.logs.push(m.text()));
  page.on('pageerror', (e) => st.logs.push('PAGEERROR ' + e.message));
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return req.continue();
    st.hosts.add(u.hostname); st.reqs.push(req.url());
    const cors = { 'access-control-allow-origin': '*' };
    const json = (o, status = 200) => req.respond({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (st.api.delay) await new Promise((r) => setTimeout(r, st.api.delay));
    if (u.hostname === 'api.dexscreener.com') {
      if (u.pathname === '/token-boosts/top/v1') return st.api.boosts === 'ok' ? json(fx.boosts()) : json({ e: 1 }, 500);
      if (u.pathname.startsWith('/tokens/v1/solana/')) return st.api.pairs === 'ok' ? json(fx.pairsFor(decodeURIComponent(u.pathname.split('/').pop()).split(','))) : json({ e: 1 }, 500);
      if (u.pathname.startsWith('/latest/dex/tokens/')) return st.api.own === 'ok' ? json({ pairs: fx.ownPairs({ liquidityUsd: st.api.liquidityUsd }) }) : json({ e: 1 }, 500);
    }
    if (u.hostname === 'frontend-api.pump.fun') return st.api.pump === 'ok' ? json(fx.PUMP) : req.respond({ status: 404, headers: cors, body: 'no' });
    if (u.hostname === 'fixture-img.test') return u.pathname.includes('broken') ? req.respond({ status: 404, body: '' }) : req.respond({ status: 200, headers: cors, contentType: 'image/png', body: fx.PNG });
    return req.abort();
  });
  await page.goto(`http://127.0.0.1:${p}/`, { waitUntil: 'domcontentloaded' });
  return { page, st, label, origin: `http://127.0.0.1:${p}`, close: async () => { await ctx.close(); await new Promise((r) => server.close(r)); } };
}

const readReg = (page) => page.evaluate(() => JSON.parse(document.getElementById('register-data').textContent));
const waitRows = (page, n = 1) => page.waitForFunction((k) => document.querySelectorAll('#board-body [data-addr]').length >= k, { timeout: 15000 }, n);
const settle = (page, ms = 1300) => new Promise((r) => setTimeout(r, ms));
const domText = (page) => page.evaluate(() => {
  const out = [];
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,svg').forEach((n) => n.remove());
  clone.querySelectorAll('*').forEach((n) => n.append(document.createTextNode('\n')));
  out.push(clone.textContent);
  document.querySelectorAll('*').forEach((e) => { for (const a of e.attributes) if (/^(aria-label|title|alt|placeholder|content|data-l|value)$/.test(a.name)) out.push(a.value); });
  out.push(document.title);
  document.querySelectorAll('meta').forEach((m) => out.push(m.content || ''));
  return out.join('\n');
});
const copyCorpus = [];

// ---------------------------------------------------------------- scenario runner
async function branchChecks(tag, s, expectDedup) {
  const { page, st } = s;
  const reg = await readReg(page);
  const ca = reg.records.ca, xr = reg.records.x, gh = reg.records.github;
  const caOn = ca.state === 'stated';
  await waitRows(page, 5);
  await settle(page, 1600);
  const T = (id, name, ok, d) => ck(`${id}[${tag}]`, name, ok, d);

  // CA slot
  const slot = await page.evaluate(() => { const e = document.querySelector('#ca-slot'); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e.querySelector('.ca-addr, .ca-pending')); return { top: r.top, w: r.width, text: e.innerText, btn: !!e.querySelector('button'), fs: parseFloat(cs.fontSize), sticky: getComputedStyle(document.querySelector('header.top')).position, href: e.querySelector('[href]') ? 1 : 0 }; });
  T('B01', 'CA slot sits at the top of the page, large font, sticky header', slot.top < 160 && slot.fs >= 15 && slot.sticky === 'sticky', JSON.stringify(slot));
  if (caOn) {
    T('B02', 'CA stated: the full address is on screen as one string', slot.text.includes(ca.value) && slot.btn, slot.text);
    await page.click('#ca-slot .ca-copy');
    await page.waitForFunction(() => document.querySelector('#ca-slot .ca-fb').textContent === 'Clipped', { timeout: 3000 }).catch(() => {});
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR'));
    const fb = await page.evaluate(() => document.querySelector('#ca-slot .ca-fb').textContent);
    T('B03', 'CA click copies the address and shows Clipped', clip === ca.value && fb === 'Clipped', `${clip} / ${fb}`);
  } else {
    T('B02', 'CA absent: slot is inert, label plus pending, no address, no button', /pending/i.test(slot.text) && !slot.btn && !slot.href && !new RegExp('[1-9A-HJ-NP-Za-km-z]{32,44}').test(slot.text), slot.text);
    T('B03', 'CA absent: nothing to copy and no clipboard write attempted', await page.evaluate(() => !document.querySelector('#ca-slot button, #ca-slot [href]')));
  }

  // social
  const soc = await page.evaluate(() => [...document.querySelectorAll('#social .soc')].map((a) => { const r = a.getBoundingClientRect(); return { id: a.dataset.social, href: a.getAttribute('href'), aria: a.getAttribute('aria-label'), dis: a.getAttribute('aria-disabled'), svg: !!a.querySelector('svg'), w: r.width, h: r.height, right: r.right, top: r.top, text: a.textContent.trim() }; }));
  T('B04', 'both social icons render, icon only', soc.length === 2 && soc.every((x) => x.svg && x.text === '') && soc.map((x) => x.id).join() === 'x,github');
  for (const [rec, id] of [[xr, 'x'], [gh, 'github']]) {
    const e = soc.find((x) => x.id === id);
    if (rec.state === 'stated') T(`B05${id === 'x' ? 'a' : 'b'}`, `${id} stated: link equals the stored url, label carries the derived handle`, e.href === rec.url && /@/.test(e.aria || ''), JSON.stringify(e));
    else T(`B05${id === 'x' ? 'a' : 'b'}`, `${id} absent: icon inert, no href at all`, e.href === null && e.dis === 'true', JSON.stringify(e));
  }
  const vw = page.viewport().width;
  T('B06', 'icons sit top-right', soc.every((x) => x.right > vw * 0.6 && x.top < 120 && x.right <= vw), JSON.stringify(soc.map((x) => [x.right, x.top])));

  // board rows
  const rows = await page.evaluate(() => [...document.querySelectorAll('#board-body > .brow')].map((r) => ({ own: r.dataset.own || '', addr: r.dataset.addr || '', text: r.innerText.replace(/\s+/g, ' '), tag: r.tagName, tiles: r.querySelectorAll('.tile').length, tileText: [...r.querySelectorAll('.tile')].map((t) => t.textContent), img: r.querySelector('img') ? r.querySelector('img').getAttribute('src') : null, cp: r.querySelector('.cp') ? r.querySelector('.cp').getAttribute('aria-label') : null, anchor: !!r.querySelector('a.who'), anim: getComputedStyle(r).animationName, border: getComputedStyle(r).borderLeftWidth + ' ' + getComputedStyle(r).borderLeftColor, titleLiq: (r.querySelector('.c-liq') || {}).title || '', liqLabel: (r.querySelector('.c-liq') || {}).dataset ? r.querySelector('.c-liq').dataset.l : '' })));
  T('B07', 'ten rows on the board: own first plus nine trending', rows.length === 10, String(rows.length));
  const first = rows[0];
  const mintRaw = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--color-mint)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  if (caOn) {
    T('B08', 'CA stated: row 1 is the live own row pinned first', first.own === 'live' && first.addr === ca.value, JSON.stringify(first));
    T('B09', 'own row data: price, change, volume from the best-volume pair', /XSS/.test(first.text) && /\$/.test(first.text) && /8\.80M/.test(first.text), first.text);
    T('B10', 'own row logo comes from pump.fun image_uri when present', st.api.pump === 'ok' ? first.img === fx.PUMP.image_uri : first.img === '/assets/logo-192.png', String(first.img));
    T('B11', 'own row never uses a dexscreener cdn logo', !/dexscreener/i.test(first.img || '') && !st.reqs.some((u) => /dd\.dexscreener\.com/.test(u)));
    if (st.api.liquidityUsd > 0) T('B12', 'own row liquidity uses pair.liquidity.usd when above zero', /Liquidity/.test(first.liqLabel) && first.titleLiq === '' && /\$/.test(first.text.split('8.80M')[1] || ''), JSON.stringify([first.liqLabel, first.titleLiq]));
    else T('B12', 'own row liquidity falls back to market cap with a Mkt Cap title', first.liqLabel === 'Mkt Cap' && first.titleLiq === 'Mkt Cap' && /123\.5K|123\.46K/.test(first.text), first.text + ' | ' + first.titleLiq);
    T('B13', 'own row has copy button for the CA', first.cp && /XSS/.test(first.cp) && first.anchor);
    T('B14', 'own row: 2px mint left border and pulse animation', first.border.startsWith('2px') && first.anim.includes('ownPulse'), first.border + ' ' + first.anim);
    T('B15', 'console carries both own-token diagnostics', st.logs.some((l) => l.includes('[excess] own token raw response')) && st.logs.some((l) => l.includes('[excess] own liquidity candidates')));
    T('B16', 'dedup: own address is removed from trending rows 2 to 10', rows.slice(1).every((r) => r.addr !== ca.value));
    T('B17', 'own fetch used both endpoints in parallel', st.reqs.some((u) => u.includes('/latest/dex/tokens/' + ca.value)) && st.reqs.some((u) => u.includes('frontend-api.pump.fun/coins/' + ca.value)));
  } else {
    T('B08', 'CA absent: row 1 is the brand placeholder, not clickable', first.own === 'placeholder' && !first.anchor && first.tag === 'DIV', JSON.stringify(first));
    T('B09', 'placeholder data: dots and $0.00', /\$0\.00/.test(first.text) && first.text.includes('· · · · ·'), first.text);
    T('B10', 'placeholder uses the real brand logo file, not a tile', /excess-logo\.png$/.test(first.img || '') && first.tiles === 0, JSON.stringify([first.img, first.tiles]));
    T('B11', 'placeholder has no copy button and no link', first.cp === null && !first.anchor);
    T('B12', 'placeholder row has no data attribute address', first.addr === '');
    T('B14', 'placeholder keeps the pulse and the mint left border', first.border.startsWith('2px') && first.anim.includes('ownPulse'), first.border + ' ' + first.anim);
    T('B15', 'CA absent: no own-token request was made', !st.reqs.some((u) => u.includes('/latest/dex/tokens/') || u.includes('frontend-api.pump.fun')));
  }
  void mintRaw;

  // trending
  const trend = rows.slice(1);
  const expected = fx.expectedTrending().filter((r) => !expectDedup(caOn ? ca.value : '', r.address)).slice(0, 9).map((r) => r.address);
  T('B18', 'trending rows are Solana only, de-duplicated, ranked by 24h volume', JSON.stringify(trend.map((r) => r.addr)) === JSON.stringify(expected), JSON.stringify(trend.map((r) => r.addr.slice(0, 5))) + ' vs ' + JSON.stringify(expected.map((a) => a.slice(0, 5))));
  T('B19', 'each trending row carries a copy button labelled with its symbol', trend.every((r) => r.cp && /^Clip address for /.test(r.cp)));
  const tiles = trend.filter((r) => r.tiles > 0);
  T('B20', 'letter tiles appear for missing or broken images, at least two, two characters each', tiles.length >= 2 && tiles.every((r) => r.tileText.every((t) => t.length >= 2)), JSON.stringify(tiles.map((r) => r.tileText)));
  T('B21', 'rows with a good image show the image', trend.filter((r) => r.img && r.tiles === 0).length >= 3);
  const note = await page.evaluate(() => document.querySelector('#board-note').textContent);
  T('B22', 'healthy feed shows no error line', note === '');
  const pill = await page.evaluate(() => document.querySelector('#board-pill').dataset.state);
  T('B23', 'status pill reads live with a pulsing dot', pill === 'live' && await page.evaluate(() => getComputedStyle(document.querySelector('#board-pill .dot')).animationName === 'livePulse'));
  const ticker = await page.evaluate(() => ({ n: document.querySelectorAll('#ticker-track .tk').length, anim: getComputedStyle(document.querySelector('#ticker-track')).animationName, text: document.querySelector('#ticker-track').textContent }));
  T('B24', 'ticker runs on the same live data and moves', ticker.n >= 10 && ticker.anim === 'tape' && /▲|▼/.test(ticker.text), JSON.stringify([ticker.n, ticker.anim]));
  const counted = await page.evaluate(() => [...document.querySelectorAll('#board-body .cell')].some((c) => /^[$▲▼]/.test(c.textContent)));
  T('B25', 'count-up finished into formatted values', counted);

  // dates and corpus
  const dtext = await domText(page);
  copyCorpus.push(dtext);
  const hits = DATE_RES.map((re) => re.exec(dtext)).filter(Boolean).map((m) => m[0]);
  T('B26', 'no date, timestamp or clock string in text, aria-labels, titles or meta', hits.length === 0, hits.join(','));
  const addrScan = dtext.match(/(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g) || [];
  T('B27', 'rendered text shows no address except the contract address', addrScan.every((a) => caOn && a === ca.value), addrScan.join(','));
  T('B28', 'no unexpected hosts contacted', [...st.hosts].every((h) => ['api.dexscreener.com', 'frontend-api.pump.fun', 'fixture-img.test'].includes(h)), [...st.hosts].join(','));
  T('B29', 'no page errors', !st.logs.some((l) => l.startsWith('PAGEERROR')), st.logs.filter((l) => l.startsWith('PAGEERROR')).join('|'));
  return { reg, caOn, trendAddrs: trend.map((r) => r.addr), marketReqs: st.reqs.filter((u) => /token-boosts|tokens\/v1\/solana/.test(u)).sort() };
}

section('browser: branch A, register as built');
let A, B, C;
{
  const s = await open({ ids: [], label: 'asBuilt' });
  A = await branchChecks('asBuilt', s, (ca, a) => a === ca);
  await s.close();
}
section('browser: branch B, ca x github toggled from whatever they are');
{
  const s = await open({ ids: ['ca', 'x', 'github'], label: 'toggled' });
  B = await branchChecks('toggled', s, (ca, a) => a === ca);
  await s.close();
}
ck('B30', 'branches differ: the two runs exercised opposite CA states', A.caOn !== B.caOn);
ck('B31', 'market requests are identical in both CA states', JSON.stringify(A.marketReqs) === JSON.stringify(B.marketReqs));
ck('B32', 'market follows its register record only: both trending lists agree once the own token is set aside', (() => { const own = fx.OWN_CA; const x = A.trendAddrs.filter((q) => q !== own), y = B.trendAddrs.filter((q) => q !== own); const n = Math.min(x.length, y.length); return n >= 8 && JSON.stringify(x.slice(0, n)) === JSON.stringify(y.slice(0, n)); })());

section('browser: branch C, toggled with liquidity present and pump.fun failing');
{
  const s = await open({ ids: ['ca', 'x', 'github'], api: { pump: 'fail', liquidityUsd: 750000 }, label: 'toggled-alt' });
  C = await branchChecks('toggled-alt', s, (ca, a) => a === ca);
  await s.close();
}

section('browser: failure handling');
{
  const s = await open({ ids: [], api: { boosts: 'fail' } });
  await s.page.waitForSelector('#board-body [data-dash]', { timeout: 15000 });
  await settle(s.page, 400);
  const d = await s.page.evaluate(() => ({ dash: document.querySelectorAll('#board-body [data-dash]').length, note: document.querySelector('#board-note').textContent, pill: document.querySelector('#board-pill').dataset.state, cells: [...document.querySelectorAll('#board-body [data-dash] .cell')].every((c) => c.textContent === '—'), skel: document.querySelectorAll('.brow-skel').length }));
  ck('F01', 'source failure: dash rows, error line, down pill, no skeleton left', d.dash === 9 && d.cells && /did not answer/.test(d.note) && d.pill === 'down' && d.skel === 0, JSON.stringify(d));
  const before = s.st.reqs.filter((u) => u.includes('token-boosts')).length;
  s.st.api.boosts = 'ok';
  await waitRows(s.page, 9);
  const after = s.st.reqs.filter((u) => u.includes('token-boosts')).length;
  ck('F02', 'backoff retry recovers on its own without a reload', after > before);
  await settle(s.page, 800);
  const rowsGood = await s.page.evaluate(() => [...document.querySelectorAll('#board-body [data-addr]')].map((r) => r.dataset.addr));
  s.st.api.boosts = 'fail';
  await s.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenReqs = s.st.reqs.length; await settle(s.page, 2600);
  ck('F03', 'no request fires while the tab is hidden', s.st.reqs.length === hiddenReqs, `${s.st.reqs.length} vs ${hiddenReqs}`);
  await s.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await settle(s.page, 900);
  const keep = await s.page.evaluate(() => ({ rows: [...document.querySelectorAll('#board-body [data-addr]')].map((r) => r.dataset.addr), pill: document.querySelector('#board-pill').dataset.state, note: document.querySelector('#board-note').textContent }));
  ck('F04', 'becoming visible fetches immediately', s.st.reqs.length > hiddenReqs);
  ck('F05', 'refresh failure keeps the last good rows, flags retry', JSON.stringify(keep.rows) === JSON.stringify(rowsGood) && keep.pill === 'retry' && /last good/.test(keep.note), JSON.stringify(keep.pill) + keep.note);
  await s.close();
}
{
  const s = await open({ ids: [], api: { delay: 900 } });
  await s.page.waitForSelector('#board-body .brow-skel', { timeout: 5000 });
  const sk = await s.page.evaluate(() => ({ n: document.querySelectorAll('#board-body .brow-skel').length, anim: getComputedStyle(document.querySelector('.skel')).animationName }));
  ck('F06', 'nine skeleton rows show while loading and shimmer', sk.n === 9 && sk.anim === 'shimmer', JSON.stringify(sk));
  await waitRows(s.page, 9);
  const st = await s.page.evaluate(() => ({ skel: document.querySelectorAll('.brow-skel').length, delays: [...document.querySelectorAll('#board-body [data-addr]')].slice(0, 4).map((r) => getComputedStyle(r).animationDelay), name: getComputedStyle(document.querySelector('#board-body [data-addr]')).animationName }));
  ck('F07', 'skeleton gives way to real rows with a 70ms stagger fade', st.skel === 0 && st.name.includes('rowIn') && new Set(st.delays).size >= 3, JSON.stringify(st));
  await s.close();
}
{
  const s = await open({ ids: ['market-source'] });
  const reg = await readReg(s.page);
  await settle(s.page, 1800);
  const off = reg.records['market-source'].state !== 'stated';
  const d = await s.page.evaluate(() => ({ dash: document.querySelectorAll('#board-body [data-dash]').length, real: document.querySelectorAll('#board-body [data-addr]').length }));
  const boostsHit = s.st.reqs.some((u) => u.includes('token-boosts'));
  ck('F08', 'toggling only the market-source record flips the market, nothing else', off ? (d.dash === 9 && !boostsHit) : (d.real >= 9 && boostsHit), JSON.stringify([off, d, boostsHit]));
  const ownRow = await s.page.evaluate(() => document.querySelector('#board-body > .brow').dataset.own);
  const ca = reg.records.ca.state === 'stated';
  ck('F09', 'market toggle leaves row 1 following the CA state alone', ca ? ownRow === 'live' || ownRow === 'placeholder' : ownRow === 'placeholder', ownRow);
  await s.close();
}

section('browser: reduced motion');
{
  const s = await open({ ids: ['ca', 'x', 'github'], reduced: true });
  await waitRows(s.page, 9); await settle(s.page, 600);
  const m = await s.page.evaluate(() => {
    const names = ['.pill .dot', '.brow-own', '.mesh i', '#ticker-track', '.skel', '.hero-hex'].map((q) => [q, document.querySelector(q) ? getComputedStyle(document.querySelector(q)).animationName : 'missing']);
    const trans = [...document.querySelectorAll('.soc, .cp, .tablist button, .stamp')].map((e) => getComputedStyle(e).transitionDuration);
    const hidden = [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1').length;
    return { names, trans: [...new Set(trans)], hidden, tx: getComputedStyle(document.querySelector('.hero-hex')).transform };
  });
  ck('R01', 'reduced motion: every animation name resolves to none', m.names.every(([, n]) => n === 'none' || n === 'missing'), JSON.stringify(m.names));
  ck('R02', 'reduced motion: every transition duration is zero', m.trans.every((t) => parseFloat(t) === 0), JSON.stringify(m.trans));
  ck('R03', 'reduced motion: reveal targets are fully visible at once', m.hidden === 0, String(m.hidden));
  const px = await s.page.evaluate(() => { dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 })); return getComputedStyle(document.querySelector('.hero-hex')).getPropertyValue('--px'); });
  ck('R04', 'reduced motion: parallax never engages', px === '');
  await s.close();
}

section('browser: interaction');
{
  const s = await open({ ids: [] });
  await waitRows(s.page, 9);
  const tabs = await s.page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-selected')));
  await s.page.focus('#tab-token'); await s.page.keyboard.press('ArrowRight');
  const after = await s.page.evaluate(() => ({ sel: [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-selected')), hid: [...document.querySelectorAll('[role=tabpanel]')].map((t) => t.hidden), focus: document.activeElement.id }));
  ck('I01', 'tabs: arrow key moves selection and swaps the panel', tabs.join() === 'true,false,false' && after.sel.join() === 'false,true,false' && after.hid.join() === 'true,false,true' && after.focus === 'tab-network', JSON.stringify(after));
  const panes = await s.page.evaluate(() => [...document.querySelectorAll('#pane-token .fact')].map((f) => f.innerText.replace(/\s+/g, ' ')));
  const reg = await readReg(s.page);
  ck('I02', 'fact sheet: every unstated record reads label plus pending, nothing more', ['ca', 'x', 'github'].filter((id) => reg.records[id].state !== 'stated').every((id) => panes.some((p) => p.startsWith(reg.records[id].label) && /pending$/.test(p) && p.split(' ').length <= reg.records[id].label.split(' ').length + 1)), JSON.stringify(panes));
  await s.page.mouse.move(300, 700);
  await s.page.evaluate(() => scrollTo(0, 99999));
  await settle(s.page, 400);
  const pr = await s.page.evaluate(() => document.querySelector('.progress i').style.transform);
  ck('I03', 'scroll progress bar reaches full width at the page end', /scaleX\(1\)/.test(pr), pr);
  await s.page.evaluate(() => scrollTo(0, 0));
  await s.page.mouse.move(200, 400); await settle(s.page, 300);
  const par = await s.page.evaluate(() => document.querySelector('.hero-hex').style.getPropertyValue('--px'));
  ck('I04', 'pointer parallax moves the hero layers', par !== '' && par !== '0.00px', par);
  await s.page.evaluate(() => scrollTo(0, 99999)); await settle(s.page, 200);
  await s.page.evaluate(() => scrollTo(0, document.querySelector('#board').offsetTop - 100)); await settle(s.page, 400);
  const row = await s.page.$('#board-body [data-addr]');
  const bb = await row.boundingBox(); await s.page.mouse.move(bb.x + 80, bb.y + 20); await settle(s.page, 300);
  const spot = await s.page.evaluate(() => { const r = document.querySelector('#board-body [data-addr]'); return [r.style.getPropertyValue('--mx'), getComputedStyle(r, '::before').opacity]; });
  ck('I05', 'spotlight follows the pointer on rows', spot[0] !== '' && parseFloat(spot[1]) > 0.9, JSON.stringify(spot));
  const copyAddr = await s.page.evaluate(() => document.querySelector('#board-body [data-addr]').dataset.addr);
  await s.page.click('#board-body [data-addr] .cp');
  const ok = await s.page.waitForSelector('#board-body [data-addr] .cp[data-ok]', { timeout: 3000 }).then(() => true).catch(() => false);
  const clip = await s.page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR'));
  ck('I06', 'row copy button copies that row address and confirms', clip === copyAddr && ok, `clip ${clip} want ${copyAddr} ok ${ok}`);
  await s.close();
}

// ---------------------------------------------------------------- breakpoints
section('browser: five breakpoints, measured');
const measure = [];
for (const [w, h] of [[360, 780], [390, 844], [430, 932], [1366, 768], [1440, 900]]) {
  for (const ids of [[], ['ca', 'x', 'github']]) {
    const s = await open({ ids, vp: [w, h] });
    const reg = await readReg(s.page);
    await waitRows(s.page, 9); await settle(s.page, 1700);
    const m = await s.page.evaluate(() => {
      const q = (sel) => [...document.querySelectorAll(sel)];
      const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]'); };
      const targets = q('a[href], button, [role=tab], .soc, .ca-copy').filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { n: (e.className || e.tagName) + (e.getAttribute('aria-label') ? ':' + e.getAttribute('aria-label').slice(0, 24) : ''), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; });
      const hdr = document.querySelector('header.top').getBoundingClientRect();
      const slot = document.querySelector('#ca-slot'); const inner = slot.querySelector('.ca-addr, .ca-pending');
      const ir = inner.getBoundingClientRect(), sr = slot.getBoundingClientRect();
      const soc = q('#social .soc').map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height, vis: vis(e) }; });
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, targets, hdrH: Math.round(hdr.height), caFont: parseFloat(getComputedStyle(inner).fontSize), caFits: ir.left >= sr.left - 1 && ir.right <= sr.right + 1, caTop: Math.round(sr.top), soc, rows: q('#board-body [data-addr]').length, h1: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize), rowH: Math.round(document.querySelector('#board-body > .brow').getBoundingClientRect().height), cellClip: q('#board-body .cell').some((c) => c.scrollWidth > c.clientWidth + 1) };
    });
    const tag = `${w}${ids.length ? 'T' : 'A'}`;
    const small = m.targets.filter((t) => t.w < 43.5 || t.h < 43.5);
    measure.push({ w, ca: reg.records.ca.state, ...m, targets: m.targets.length, small: small.length });
    ck(`M${tag}a`, `${w}px: no horizontal overflow`, m.sw <= m.iw, `${m.sw} > ${m.iw}`);
    ck(`M${tag}b`, `${w}px: every tap target is at least 44x44 (${m.targets.length} measured)`, small.length === 0, JSON.stringify(small));
    ck(`M${tag}c`, `${w}px: both social icons visible, top-right, 44x44`, m.soc.length === 2 && m.soc.every((x) => x.vis && x.w >= 44 && x.h >= 44 && x.x + x.w <= w && x.x > w * 0.5 && x.y < 140), JSON.stringify(m.soc));
    ck(`M${tag}d`, `${w}px: CA slot at the top and its text fits the slot`, m.caTop < 140 && m.caFits && m.caFont >= 14, JSON.stringify([m.caTop, m.caFits, m.caFont]));
    ck(`M${tag}e`, `${w}px: nine trending rows rendered, no clipped number cells`, m.rows >= 9 && !m.cellClip, JSON.stringify([m.rows, m.cellClip]));
    if (ids.length === 0 || w === 360) { await s.page.screenshot({ path: R('reports', `shot-${w}-${ids.length ? 'toggled' : 'asbuilt'}.png`).replace(/\\/g, '/'), fullPage: false }).catch(() => {}); }
    await s.close();
  }
}
await mkdir(R('reports'), { recursive: true });
await writeFile(R('reports/measure.json'), JSON.stringify(measure, null, 1));
copyCorpus.push((await readFile(R('dist/index.html'), 'utf8')).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<[^>]+>/g, '\n'));
await browser.close();

// ---------------------------------------------------------------- copy gate, now that the DOM is in hand
section('copy: results');
{
  const ours = units(copyCorpus.join('\n'));
  const shared = new Set();
  for (const u of ours) for (let i = 0; i + 1 < u.length; i++) { const b = u[i] + ' ' + u[i + 1]; if (refBi.has(b) && !(STOP.has(u[i]) && STOP.has(u[i + 1]))) shared.add(b); }
  const strict = new Set();
  for (const u of ours) for (let i = 0; i + 1 < u.length; i++) { const b = u[i] + ' ' + u[i + 1]; if (refBi.has(b)) strict.add(b); }
  ck('C01', 'no shared 2-gram that contains a content word', shared.size === 0, [...shared].join(' | '));
  console.log(`        (function-word-only 2-grams shared, informational: ${[...strict].filter((b) => !shared.has(b)).join(' | ') || 'none'})`);
  const ow = new Set(); for (const u of ours) for (const w of u) if (!STOP.has(w) && refVocab.has(w) && w.length > 1 && !ALLOWED_SHARED.has(w) && !/^\d+$/.test(w)) ow.add(w);
  ck('C02', 'no content word shared with the reference vocabulary (chain name excepted)', ow.size === 0, [...ow].join(', '));
}

finish();
function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) console.log('failed: ' + failed.map((f) => f.id).join(', '));
  process.exit(failed.length ? 1 : 0);
}
