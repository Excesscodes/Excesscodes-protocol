const SUB = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];
const subs = (n) => String(n).split('').map((d) => SUB[+d]).join('');
export const DASH = '—';

export function usdPrice(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n === 0) return '$0.00';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  const s = n.toFixed(20).replace(/0+$/, '');
  const frac = s.split('.')[1] || '';
  const z = frac.match(/^0*/)[0].length;
  const digits = frac.slice(z, z + 4);
  if (z < 3) return '$0.' + frac.slice(0, z + 4);
  return '$0.0' + subs(z) + digits;
}

export function usdCompact(n) {
  if (!Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

export function pct(n) {
  if (!Number.isFinite(n)) return DASH;
  const arrow = n > 0 ? '▲ ' : n < 0 ? '▼ ' : '';
  return arrow + Math.abs(n).toFixed(2) + '%';
}

export const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '');
