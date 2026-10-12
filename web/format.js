// Compact Singapore-dollar formatting for prices: $592k, $1.04m.
export const money = n => n >= 1e6 ? `$${+(n / 1e6).toFixed(2)}m` : `$${Math.round(n / 1000)}k`;
export const range = (min, max) => `${money(min)}–${money(max)}`;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const pad = n => String(n).padStart(2, '0');
export const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// minutes after midnight -> "3:05 pm"
export const fmtTime = m => { let h = Math.floor(m / 60), mm = Math.round(m % 60); if (mm === 60) { h++; mm = 0; } return `${((h + 11) % 12) + 1}:${pad(mm)} ${h >= 12 ? 'pm' : 'am'}`; };
