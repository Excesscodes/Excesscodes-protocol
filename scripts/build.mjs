// Static build. Output goes to dist/ and nowhere else.
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import potrace from 'potrace';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const p = (...a) => path.join(root, ...a);

// ---- tokens.css: the only file allowed to hold colour literals --------------
async function buildTokens() {
  const pal = JSON.parse(await readFile(p('tokens/palette.json'), 'utf8'));
  const lines = [
    '/* Palette provenance: ' + pal.method + '.',
    ...pal.tokens.map(
      (t) => `   ${t.name.padEnd(12)} ${t.hex}  ${t.file} @ x${t.x},y${t.y}  centroid ${t.centroid.join('/')}  share ${t.share}`
    ),
    '   Every literal below was read from a real pixel of the named asset. */',
    ':root{',
    ...pal.tokens.map((t) => `  --color-${t.name}: ${t.hex};`),
    '}',
  ];
  return { css: lines.join('\n') + '\n', pal };
}

// ---- logo assets: premultiplied resize, alpha-bbox crop ----------------------
async function alphaBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// Pure-black fully transparent pixels exist in the source, so colour is bled
// from the nearest opaque pixel before any filter touches it, then sharp's
// premultiplied resize runs. No dark fringe results (checked in gates).
async function bleedColour(buf, tint) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // The mark is one flat ink. Any pixel that is not fully opaque carries colour that was
  // matted against black, so it is reset to the ink before the premultiplied resize.
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 255) { data[i] = tint[0]; data[i + 1] = tint[1]; data[i + 2] = tint[2]; }
  }
  return sharp(data, { raw: info });
}

async function buildLogos(pal) {
  const src = await readFile(p('brand/LOGO EXCESS PNG...png'));
  const cream = pal.tokens.find((t) => t.name === 'cream').hex;
  const tint = [1, 3, 5].map((i) => parseInt(cream.slice(i, i + 2), 16));
  const box = await alphaBox(src);
  const side = Math.max(box.width, box.height);
  const pad = Math.round(side * 0.12);
  const cropped = await sharp(src).extract(box).png().toBuffer();
  const square = await (await bleedColour(cropped, tint))
    .extend({
      top: pad + Math.floor((side - box.height) / 2), bottom: pad + Math.ceil((side - box.height) / 2),
      left: pad + Math.floor((side - box.width) / 2), right: pad + Math.ceil((side - box.width) / 2),
      background: { r: tint[0], g: tint[1], b: tint[2], alpha: 0 },
    })
    .png().toBuffer();
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  for (const [name, size] of [['excess-logo.png', 512], ['logo-192.png', 192]]) {
    await sharp(square).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 })
      .toFile(path.join(dist, 'assets', name));
  }
  return { square, box, pad };
}

// ---- favicon: traced from the real pixel grid of the logo --------------------
async function buildFavicon(square, pal) {
  const grid = 256;
  const bw = await sharp(square)
    .resize(grid, grid, { kernel: 'lanczos3' })
    .ensureAlpha().extractChannel(3).threshold(128).negate().png().toBuffer(); // mark = black on white
  const svg = await new Promise((res, rej) =>
    potrace.trace(bw, { threshold: 128, turdSize: 4, optTolerance: 0.4, blackOnWhite: true }, (e, s) => (e ? rej(e) : res(s)))
  );
  const d = /<path[^>]*\sd="([^"]+)"/.exec(svg)[1].replace(/(\d+\.\d{2})\d+/g, '$1');
  const g = (n) => pal.tokens.find((t) => t.name === n).hex;
  const scale = (22 / grid).toFixed(5);
  const out =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    `<rect width="32" height="32" rx="7" fill="${g('ground')}"/>` +
    `<path transform="translate(5 5) scale(${scale})" fill="${g('cream')}" fill-rule="evenodd" d="${d}"/>` +
    '</svg>\n';
  if (out.includes('--')) throw new Error('favicon contains a double hyphen');
  await writeFile(path.join(dist, 'favicon.svg'), out);
}

// ---- register: strip data-only fields, inline into the page ------------------
function runtimeRegister(reg) {
  const out = { schema: reg.schema, records: {} };
  for (const [id, rec] of Object.entries(reg.records)) {
    const r = { ...rec };
    delete r.recorded;
    if (r.state !== 'stated') {
      for (const k of Object.keys(r)) if (!['label', 'kind', 'state'].includes(k)) delete r[k];
    }
    out.records[id] = r;
  }
  return out;
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(p('src'), dist, { recursive: true });

  const { css, pal } = await buildTokens();
  await mkdir(path.join(dist, 'css'), { recursive: true });
  await writeFile(path.join(dist, 'css/tokens.css'), css);

  const { square } = await buildLogos(pal);
  await buildFavicon(square, pal);

  const reg = JSON.parse(await readFile(p('register/register.json'), 'utf8'));
  const rt = JSON.stringify(runtimeRegister(reg)).replace(/</g, '\\u003c');
  let html = await readFile(path.join(dist, 'index.html'), 'utf8');
  html = html.replace('/*REGISTER*/', rt);
  await writeFile(path.join(dist, 'index.html'), html);

  await writeFile(path.join(dist, '_headers'),
    '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');

  const count = async (d) => (await readdir(d, { withFileTypes: true })).reduce(async (a, e) =>
    (await a) + (e.isDirectory() ? await count(path.join(d, e.name)) : 1), Promise.resolve(0));
  console.log('build ok: dist/ with', await count(dist), 'files');
}

main().catch((e) => { console.error(e); process.exit(1); });
