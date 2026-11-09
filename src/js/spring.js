// Damped spring, fixed-step semi-implicit Euler. Settles to rest, then reports done.
export function spring({ from = 0, to = 1, stiffness = 170, damping = 22, mass = 1, delay = 0, onUpdate, onDone }) {
  let x = from, v = 0, last = 0, started = false, raf = 0, cancelled = false;
  const dt = 1 / 120;
  const tick = (t) => {
    if (cancelled) return;
    if (!started) { started = true; last = t; }
    let acc = Math.min((t - last) / 1000, 0.05);
    last = t;
    while (acc > 0) {
      const step = Math.min(dt, acc);
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * step;
      x += v * step;
      acc -= step;
    }
    const rest = Math.abs(v) < 0.001 && Math.abs(x - to) < 0.0008;
    onUpdate(rest ? to : x);
    if (rest) { onDone && onDone(); return; }
    raf = requestAnimationFrame(tick);
  };
  const timer = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
  return () => { cancelled = true; clearTimeout(timer); cancelAnimationFrame(raf); };
}
