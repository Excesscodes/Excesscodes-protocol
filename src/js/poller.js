// 60 s cadence, exponential backoff on failure, pauses while hidden,
// fires immediately when the tab becomes visible again.
export function createPoller({ task, interval = 60000, base = 2000, onStatus }) {
  let timer = 0, failures = 0, ctrl = null, running = false, started = false;
  const clear = () => { clearTimeout(timer); timer = 0; };
  const schedule = (ms) => { clear(); if (!document.hidden) timer = setTimeout(run, ms); };
  async function run() {
    if (document.hidden || running) return;
    running = true; clear();
    ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), 12000);
    try {
      await task(ctrl.signal);
      failures = 0;
      onStatus && onStatus('live', null);
      schedule(interval);
    } catch (err) {
      if (document.hidden) { running = false; clearTimeout(kill); return; }
      failures += 1;
      onStatus && onStatus('fail', err, failures);
      schedule(Math.min(interval, base * 2 ** (failures - 1)));
    } finally { clearTimeout(kill); running = false; }
  }
  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (document.hidden) { clear(); ctrl && ctrl.abort(); }
    else run();
  });
  return { start() { started = true; run(); }, now: run };
}

export async function getJSON(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
