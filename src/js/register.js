// Reads the inline register once. All state decisions happen at call time.
let data = { records: {} };
try {
  data = JSON.parse(document.getElementById('register-data').textContent);
} catch (_) { /* an unreadable register renders everything inert */ }

export const record = (id) => data.records[id] || { id, label: id, state: 'absent' };
export const isStated = (r) => r && r.state === 'stated';

// Link rule: the url is stored, the handle is derived from it.
export function handleOf(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : u.hostname;
  } catch (_) { return ''; }
}

export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const caValue = () => {
  const r = record('ca');
  return isStated(r) && typeof r.value === 'string' && BASE58.test(r.value) ? r.value : '';
};
