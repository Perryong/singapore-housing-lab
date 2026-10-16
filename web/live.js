// Live bus arrivals helpers (plain text out; callers escape).
export const PROD_API = 'https://sg-bus-api.vercel.app'; // the deployed sg-bus-api (github.com/Perryong/sg-bus-api)
export const apiFor = h => (h === 'localhost' || h === '127.0.0.1') ? 'http://127.0.0.1:8010' : PROD_API;
export const API = apiFor(globalThis.location?.hostname ?? '');

// base param is a test seam; callers use the default.
export async function fetchArrivals(stop, signal, base = API) {
  if (!base) throw new Error('live arrivals not configured');
  const res = await fetch(`${base}/arrivals/${encodeURIComponent(stop)}`, { signal });
  if (res.status !== 200) throw new Error(`arrivals ${res.status}`);
  const data = await res.json();
  return { data, offsetMs: Date.parse(data.at) - Date.now() };
}

export const minutesUntil = (iso, nowMs) => Math.max(0, Math.floor((Date.parse(iso) - nowMs) / 60000));
export const liveChip = (arr, nowMs) => !arr?.length ? '–' : (m => m < 1 ? 'Arr' : `${m}′`)(minutesUntil(arr[0], nowMs));
export const nextBuses = (arr, nowMs) => arr.map(a => { const m = minutesUntil(a, nowMs); return m < 1 ? 'Arriving' : `${m} min`; }).join(' · ');
export const liveLine = (updatedMs, nowMs, failed) => failed
  ? 'Live times unavailable, showing the timetable'
  : `Live · updated ${Math.max(0, Math.round((nowMs - updatedMs) / 1000))} s ago`;
