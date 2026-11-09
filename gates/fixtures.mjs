// Test-only market fixtures. Nothing here ships in dist/.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function addr(seed, tail = '') {
  const r = rng(seed); let a = '';
  while (a.length < 44 - tail.length) a += B58[Math.floor(r() * B58.length)];
  return a + tail;
}

export const OWN_CA = addr(9001, 'pump');
export const TREND = Array.from({ length: 13 }, (_, i) => addr(100 + i));
// vol order is deliberately not the boost order
const VOL = [5e5, 9e6, 2.2e6, 7.5e5, 4e7, 3e5, 1.2e6, 6e6, 8e4, 2.5e7, 9.9e5, 3.1e6, 1.5e5];

export function boosts({ withOwn = true } = {}) {
  const list = TREND.map((a) => ({ chainId: 'solana', tokenAddress: a, amount: 10, totalAmount: 20 }));
  list.splice(3, 0, { chainId: 'ethereum', tokenAddress: '0x' + 'ab'.repeat(20), amount: 5, totalAmount: 5 });
  list.push({ chainId: 'solana', tokenAddress: TREND[2], amount: 1, totalAmount: 2 }); // duplicate
  if (withOwn) list.splice(5, 0, { chainId: 'solana', tokenAddress: OWN_CA, amount: 9, totalAmount: 9 });
  return list;
}

const pair = (token, sym, vol, extra = {}) => ({
  chainId: 'solana', dexId: 'raydium', url: 'https://dexscreener.com/solana/' + token.slice(0, 8),
  baseToken: { address: token, name: sym + ' Coin', symbol: sym },
  quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
  priceUsd: String(0.00001234 * (1 + vol / 1e7)),
  priceChange: { h24: (vol % 7 === 0 ? -1 : 1) * (vol / 1e5) % 90 },
  volume: { h24: vol }, liquidity: { usd: vol / 3 },
  info: extra.noImage ? undefined : { imageUrl: extra.broken ? 'https://fixture-img.test/broken.png' : 'https://fixture-img.test/ok.png' },
  ...extra.over,
});

export function pairsFor(addresses) {
  const out = [];
  for (const a of addresses) {
    const i = TREND.indexOf(a);
    if (i >= 0) {
      const sym = 'TK' + String.fromCharCode(65 + i) + String.fromCharCode(97 + i);
      // thin pair, a fat pair where the token is only the quote side, and the real pair
      out.push(pair(a, sym, VOL[i] / 10, { noImage: i === 4 || i === 6, broken: i === 9 }));
      out.push({ ...pair(a, sym, 9e9), baseToken: { address: 'Other' + a.slice(5), name: 'x', symbol: 'X' }, quoteToken: { address: a, name: sym, symbol: sym } });
      out.push(pair(a, sym, VOL[i], { noImage: i === 4 || i === 6, broken: i === 9 }));
    } else if (a === OWN_CA) {
      out.push(...ownPairs());
    }
  }
  return out;
}

export function ownPairs({ liquidityUsd = 0, marketCap = 123456 } = {}) {
  return [
    { ...pair(OWN_CA, 'XSS', 1500, { over: { liquidity: { usd: liquidityUsd || 0 }, marketCap } }), url: 'https://dexscreener.com/solana/small' },
    { ...pair(OWN_CA, 'XSS', 8800000, { over: { liquidity: { usd: liquidityUsd || 0 }, marketCap } }), url: 'https://dexscreener.com/solana/big' },
    { ...pair(OWN_CA, 'XSS', 99, { over: { liquidity: { usd: 5 } } }), baseToken: { address: 'Notown' + OWN_CA.slice(6), name: 'n', symbol: 'N' } },
  ];
}

export const PUMP = { image_uri: 'https://fixture-img.test/pump-own.png', symbol: 'XSS' };
// 1x1 png
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export function expectedTrending() {
  const set = [...new Set(boosts().filter((b) => b.chainId === 'solana').map((b) => b.tokenAddress))];
  const vol = (a) => (a === OWN_CA ? 8800000 : VOL[TREND.indexOf(a)]);
  return set.map((a) => ({ address: a, vol: vol(a) })).sort((x, y) => y.vol - x.vol);
}
