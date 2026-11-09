import { spring } from './spring.js';

export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

export function tween(from, to, ms, step, done) {
  if (reduced || ms <= 0) { step(to); done && done(); return () => {}; }
  let raf = 0, t0 = 0, dead = false;
  const f = (t) => {
    if (dead) return;
    if (!t0) t0 = t;
    const k = Math.min(1, (t - t0) / ms);
    step(from + (to - from) * easeOut(k));
    if (k < 1) raf = requestAnimationFrame(f); else done && done();
  };
  raf = requestAnimationFrame(f);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => el.classList.add('is-in');
  if (reduced || !('IntersectionObserver' in window)) { els.forEach(show); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      io.unobserve(el);
      const sibs = el.parentElement && el.parentElement.hasAttribute('data-reveal-group')
        ? [...el.parentElement.children] : [el];
      const idx = Math.max(0, sibs.indexOf(el));
      spring({
        from: 0, to: 1, stiffness: 170, damping: 22, delay: idx * 70,
        onUpdate(p) {
          el.classList.add('is-in');
          el.style.opacity = String(Math.max(0, Math.min(1, p * 1.25)));
          el.style.transform = `translate3d(0,${((1 - p) * 28).toFixed(2)}px,0)`;
        },
        onDone() { el.style.opacity = ''; el.style.transform = ''; },
      });
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));
}

export function initProgress() {
  const bar = document.querySelector('.progress i');
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  const q = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', q, { passive: true });
  addEventListener('resize', q);
  paint();
}

export function initParallax() {
  if (reduced) return;
  const layers = [...document.querySelectorAll('[data-depth]')];
  if (!layers.length) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, running = false, lastY = -1;
  const frame = () => {
    cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
    const sy = Math.min(scrollY, innerHeight * 1.2);
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.setProperty('--px', (-cx * d * 120).toFixed(2) + 'px');
      l.style.setProperty('--py', (-cy * d * 120 + sy * d * 0.9).toFixed(2) + 'px');
    }
    const settled = Math.abs(tx - cx) < 0.002 && Math.abs(ty - cy) < 0.002 && lastY === scrollY;
    lastY = scrollY;
    if (settled) { running = false; return; }
    requestAnimationFrame(frame);
  };
  const kick = () => { if (!running) { running = true; requestAnimationFrame(frame); } };
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; kick();
  }, { passive: true });
  addEventListener('scroll', kick, { passive: true });
  kick();
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('[data-spot]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
}
