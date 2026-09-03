// Presentation helpers. The one rule that matters here: a metric with no source
// renders as an em-dash and says "not sourced", never as 0. A zero on this page
// must always mean "measured, and it was zero".

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const BLANK = '<span class="blank" title="No source for this metric yet">&mdash;</span>';

export function num(v, { money = false } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return BLANK;
  return money
    ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : v.toLocaleString('en-US');
}

// Sums only the campaigns that actually reported a number. If none did, the
// result is null - which renders blank, not zero.
export function total(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

export function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return Math.round((d - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

// Status is never carried by colour alone - every pill ships a glyph and a word.
const IMPACT = {
  Critical: { cls: 'critical', icon: '&#9679;' },
  High: { cls: 'serious', icon: '&#9670;' },
  Medium: { cls: 'warning', icon: '&#9724;' },
  Low: { cls: 'muted', icon: '&#9723;' },
};
export function impactPill(v) {
  const m = IMPACT[v] || { cls: 'muted', icon: '&#9723;' };
  return `<span class="pill ${m.cls}">${m.icon} ${esc(v || 'Unset')}</span>`;
}

const STATUS = {
  Live: 'good', 'Gate pending': 'warning', Draft: 'muted',
  Paused: 'serious', Closed: 'muted', BLOCKED: 'critical', 'Open decision': 'serious',
};
export function statusPill(v) {
  return `<span class="pill ${STATUS[v] || 'muted'}">${esc(v || 'Unset')}</span>`;
}

export function dueLabel(iso) {
  const d = daysUntil(iso);
  if (d === null) return `${BLANK} <span class="note">no date</span>`;
  if (d < 0) return `<span class="pill critical">&#9679; ${-d}d overdue</span>`;
  if (d === 0) return '<span class="pill serious">&#9670; today</span>';
  if (d <= 7) return `<span class="pill warning">&#9724; in ${d}d</span>`;
  return `<span class="note">${esc(iso)}</span>`;
}
