// reference/hdb/listing-status.json -> catalogue entries. Hand-edited: HDB's portal refuses automated requests.
const STALE_DAYS = 60;

export function applyListingStatus(list, status) {
  const byId = new Map(list.map(p => [p.id, p]));
  for (const [id, s] of Object.entries(status.projects)) {
    if (!byId.has(id)) throw new Error(`listing-status.json: unknown project "${id}"`);
    if (s.availability !== 'closed') throw new Error(`listing-status.json: ${id}: availability must be "closed", got "${s.availability}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.since)) throw new Error(`listing-status.json: ${id}: since must be YYYY-MM-DD, got "${s.since}"`);
    if (!s.source) throw new Error(`listing-status.json: ${id}: source is required`);
    Object.assign(byId.get(id), { availability: s.availability, since: s.since });
  }
  return list;
}

// a warning once nobody has reviewed the file for a while, else null
export function staleWarning(status, today = new Date()) {
  const days = (today - new Date(status.reviewed)) / 864e5;
  return days > STALE_DAYS ? `listing-status.json was last reviewed ${status.reviewed}, over ${STALE_DAYS} days ago` : null;
}
