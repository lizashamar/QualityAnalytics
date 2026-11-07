// Shared, URL-addressable investigation context. Dates refer to latest evaluations, in UTC.
export const FILTER_DEFAULTS = Object.freeze({ q: '', language: '', channel: '', status: '', quality: '', from: '', to: '' });
export const PAGE_SIZE = 25;
export function readExplorerQuery(query = '') {
  const params = new URLSearchParams(query);
  return Object.fromEntries(Object.keys(FILTER_DEFAULTS).map(key => [key, params.get(key) || '']));
}
export function explorerHref(filters = {}, sort = '') {
  const params = new URLSearchParams();
  for (const key of Object.keys(FILTER_DEFAULTS)) if (filters[key]) params.set(key, filters[key]);
  if (sort && sort !== 'recent') params.set('sort', sort);
  return `#/conversations${params.size ? `?${params}` : ''}`;
}
export function matchesRow(f, r) {
  const c = r.conv, score = r.R?.final.total;
  if (f.language && c.language !== f.language) return false;
  if (f.channel && c.channel !== f.channel) return false;
  if (f.status === 'flag' ? !r.R?.final.gross_flag : f.status && r.status !== f.status) return false;
  if (f.quality === 'low' && !(score != null && score < 60)) return false;
  if (f.quality === 'attention' && !(score != null && score >= 60 && score < 80)) return false;
  if (f.quality === 'high' && !(score != null && score >= 80)) return false;
  if (f.from || f.to) {
    const time = Date.parse(r.ev?.created_at);
    if (!Number.isFinite(time)) return false;
    const day = new Date(time).toISOString().slice(0, 10);
    if (f.from && day < f.from || f.to && day > f.to) return false;
  }
  const q = (f.q || '').trim().toLowerCase();
  return !q || c.conversation_id.toLowerCase().includes(q) || (c.transcript || []).some(t => String(t.text).toLowerCase().includes(q));
}
export function sortRows(rows, order = 'recent') {
  return [...rows].sort((a, b) => {
    if (order === 'score-asc' || order === 'score-desc') {
      const av = a.R?.final.total, bv = b.R?.final.total;
      if (av == null && bv != null) return 1;
      if (bv == null && av != null) return -1;
      if (av != null && bv != null && av !== bv) return (av - bv) * (order === 'score-asc' ? 1 : -1);
    }
    if (order !== 'id') {
      const diff = (Date.parse(b.ev?.created_at) || 0) - (Date.parse(a.ev?.created_at) || 0);
      if (diff) return diff;
    }
    return a.conv.conversation_id.localeCompare(b.conv.conversation_id, 'ru', { numeric: true });
  });
}
