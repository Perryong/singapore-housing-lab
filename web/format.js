// Compact Singapore-dollar formatting for prices: $592k, $1.04m.
export const money = n => n >= 1e6 ? `$${+(n / 1e6).toFixed(2)}m` : `$${Math.round(n / 1000)}k`;
export const range = (min, max) => `${money(min)}–${money(max)}`;
