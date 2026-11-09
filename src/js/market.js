// Two independent pipelines.
//  trending: follows the market-source record only. CA state never reaches it.
//  own:      follows the ca record and the own-source record.
import { record, isStated, caValue } from './register.js';
import { createPoller, getJSON } from './poller.js';

const listeners = new Set();
export const state = {
  trending: { rows: [], status: 'idle', hasData: false, error: '' },
  own: { status: 'idle', row: null, error: '' },
};
const emit = () => listeners.forEach((f) => f(state));
export const subscribe = (f) => { listeners.add(f); f(state); return () => listeners.delete(f); };

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

function bestPair(pairs, address) {
  return pairs
    .filter((p) => p && p.baseToken && p.baseToken.address === address)
    .sort((a, b) => num(b.volume && b.volume.h24 || 0) - num(a.volume && a.volume.h24 || 0))[0];
}

function toRow(pair) {
  return {
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol || '?',
    name: pair.baseToken.name || '',
    image: pair.info && pair.info.imageUrl || '',
    price: num(pair.priceUsd),
    change: num(pair.priceChange && pair.priceChange.h24),
    volume: num(pair.volume && pair.volume.h24),
    liquidity: num(pair.liquidity && pair.liquidity.usd),
    url: pair.url || '',
  };
}

async function pullTrending(signal) {
  const src = record('market-source');
  if (!isStated(src)) throw new Error('market source not stated');
  const boosts = await getJSON(src.boosts, signal);
  const addrs = [...new Set((Array.isArray(boosts) ? boosts : [])
    .filter((b) => b && b.chainId === 'solana' && b.tokenAddress)
    .map((b) => b.tokenAddress))];
  if (!addrs.length) throw new Error('no solana entries');
  const groups = await Promise.all(chunk(addrs, 30).map((g) => getJSON(src.pairs + g.join(','), signal)));
  const pairs = groups.flat();
  const rows = addrs
    .map((a) => bestPair(pairs, a))
    .filter(Boolean)
    .map(toRow)
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, 10);
  if (!rows.length) throw new Error('no pairs');
  state.trending.rows = rows;
  state.trending.hasData = true;
}

async function pullOwn(signal) {
  const ca = caValue();
  const src = record('own-source');
  if (!ca || !isStated(src)) return;
  const [dex, pump] = await Promise.all([
    getJSON(src.pairs + ca, signal),
    getJSON(src.logo + ca, signal).catch(() => null),
  ]);
  console.log('[excess] own token raw response', { dex, pump });
  const pair = bestPair((dex && dex.pairs) || [], ca);
  if (!pair) throw new Error('own pair not found');
  const liqUsd = num(pair.liquidity && pair.liquidity.usd);
  const cap = num(pair.marketCap);
  console.log('[excess] own liquidity candidates', { liquidityUsd: liqUsd, marketCap: cap });
  const useLiq = liqUsd > 0;
  const row = toRow(pair);
  row.address = ca;
  row.image = (pump && pump.image_uri) || ''; // never the dexscreener cdn logo
  row.liquidity = useLiq ? liqUsd : cap;
  row.liquidityLabel = useLiq ? 'Liquidity' : 'Mkt Cap';
  state.own.row = row;
}

export function start() {
  const tPoll = createPoller({
    task: pullTrending,
    onStatus(kind, err) {
      const t = state.trending;
      if (kind === 'live') { t.status = 'live'; t.error = ''; }
      else { t.status = t.hasData ? 'retry' : 'down'; t.error = String(err && err.message || err); }
      emit();
    },
  });
  tPoll.start();

  if (caValue()) {
    const oPoll = createPoller({
      task: pullOwn,
      onStatus(kind, err) {
        if (kind === 'live') { state.own.status = 'live'; state.own.error = ''; }
        else { state.own.status = state.own.row ? 'retry' : 'down'; state.own.error = String(err && err.message || err); }
        emit();
      },
    });
    oPoll.start();
  }
}
