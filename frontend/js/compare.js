// Сравнение версий чек-листа (чистые функции; повторяют backend/app/compare.py).
// Используется mock-API; при реальном бэкенде ответ приходит с GET /checklists/compare.
import { calculate, round2 } from './scoring.js';

export const FIELDS = {
  title: 'Название', question: 'Описание', section: 'Раздел', weight: 'Вес', type: 'Тип ответа',
  scale_steps: 'Шкала', scale_labels: 'Описания ступеней', allow_na: 'N/A разрешён', na_condition: 'Условие N/A',
  is_flag: 'Флаг грубого нарушения',
};
const EPS = 0.005;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v) : v);
const labelKey = (k) => (Number.isFinite(Number(k)) ? String(Number(k)) : String(k));

function norm(field, v) {
  if (field === 'scale_steps') return [...(v || [])].map(Number).sort((a, b) => b - a);
  if (field === 'scale_labels') {
    const o = {};
    Object.entries(v || {}).filter(([, t]) => String(t).trim()).forEach(([k, t]) => { o[labelKey(k)] = String(t); });
    return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  }
  if (field === 'weight') return num(Number(v || 0));
  if (field === 'allow_na' || field === 'is_flag') return !!v;
  if (field === 'type') return v || 'yesno';
  return typeof v === 'string' || v == null ? String(v || '').trim() : v;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const brief = (c) => ({ criterion_id: c.id, title: c.title || '', section: c.section || '', weight: Number(c.weight || 0),
  type: c.type || 'yesno', is_flag: !!c.is_flag, allow_na: !!c.allow_na, scale_steps: norm('scale_steps', c.scale_steps) });

export function diffCriteria(a, b) {
  const byA = new Map(a.map((c) => [c.id, c]));
  const byB = new Map(b.map((c) => [c.id, c]));
  const changed = [];
  for (const c of b) {
    const old = byA.get(c.id);
    if (!old) continue;
    const changes = Object.entries(FIELDS)
      .map(([field, label]) => ({ field, label, from: norm(field, old[field]), to: norm(field, c[field]) }))
      .filter((x) => !same(x.from, x.to));
    if (changes.length) changed.push({ criterion_id: c.id, title: c.title || old.title || '', changes });
  }
  return {
    added: b.filter((c) => !byA.has(c.id)).map(brief),
    removed: a.filter((c) => !byB.has(c.id)).map(brief),
    changed,
    unchanged: b.filter((c) => byA.has(c.id)).length - changed.length,
  };
}

const answersOf = (items, final) => Object.fromEntries(items.map((i) => [i.criterion_id, final && i.final_answer != null ? i.final_answer : i.answer]));

function score(ev, criteria) {
  const orig = calculate(criteria, answersOf(ev.items, false));
  const decided = ev.items.some((i) => i.final_answer != null);
  const fin = decided ? calculate(criteria, answersOf(ev.items, true)) : null;
  return {
    total: orig.total, gross: orig.gross_flag, final_total: fin ? fin.total : null,
    rows: Object.fromEntries(orig.rows.map((r) => [r.criterion_id, r])),
    answers: answersOf(ev.items, false),
    titles: Object.fromEntries(criteria.map((c) => [c.id, c.title || c.id])),
    flags: new Set(criteria.filter((c) => c.is_flag).map((c) => c.id)),
  };
}
const pts = (s, cid) => {
  if (s.flags.has(cid)) return null;
  const r = s.rows[cid];
  return r && r.applicable ? round2(r.points) : null;
};

/** fromMap/toMap: conversation_id -> {ev, criteria}. */
export function compareEvaluations(fromMap, toMap) {
  const both = Object.keys(fromMap).filter((k) => k in toMap).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  const rows = both.map((cid) => {
    const a = score(fromMap[cid].ev, fromMap[cid].criteria);
    const b = score(toMap[cid].ev, toMap[cid].criteria);
    const delta = a.total != null && b.total != null ? round2(b.total - a.total) : null;
    const changed = [];
    const pointsChanged = [];
    for (const k of [...new Set([...Object.keys(a.answers), ...Object.keys(b.answers)])]) {
      const e = { criterion_id: k, title: b.titles[k] || a.titles[k] || k, answer_from: a.answers[k] ?? null, answer_to: b.answers[k] ?? null,
        points_from: pts(a, k), points_to: pts(b, k) };
      if (!same(e.answer_from, e.answer_to) || (k in a.answers) !== (k in b.answers)) changed.push(e);
      else if (e.points_from != null && e.points_to != null && Math.abs(e.points_from - e.points_to) > EPS) pointsChanged.push(e);
    }
    return {
      conversation_id: cid, evaluation_from: fromMap[cid].ev.id, evaluation_to: toMap[cid].ev.id,
      total_from: a.total, total_to: b.total, delta, final_total_from: a.final_total, final_total_to: b.final_total,
      gross_from: a.gross, gross_to: b.gross, changed_criteria: changed, points_changed: pointsChanged,
    };
  });
  const withDelta = rows.filter((r) => r.delta != null);
  const avg = (xs) => (xs.length ? round2(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const gf = rows.filter((r) => r.gross_from).length;
  const gt = rows.filter((r) => r.gross_to).length;
  const costs = Object.values(toMap).map((x) => x.ev.usage?.cost_usd).filter((c) => typeof c === 'number');
  return {
    summary: {
      compared: rows.length,
      evaluated_in_from: Object.keys(fromMap).length, evaluated_in_to: Object.keys(toMap).length,
      not_evaluated_in_to: Object.keys(fromMap).filter((k) => !(k in toMap)).length,
      not_evaluated_in_from: Object.keys(toMap).filter((k) => !(k in fromMap)).length,
      avg_from: avg(rows.map((r) => r.total_from).filter((x) => x != null)),
      avg_to: avg(rows.map((r) => r.total_to).filter((x) => x != null)),
      avg_delta: avg(withDelta.map((r) => r.delta)),
      improved: withDelta.filter((r) => r.delta > EPS).length,
      declined: withDelta.filter((r) => r.delta < -EPS).length,
      unchanged: withDelta.filter((r) => Math.abs(r.delta) <= EPS).length,
      gross_from: gf, gross_to: gt, gross_changed: gf !== gt || rows.some((r) => r.gross_from !== r.gross_to),
      reevaluation_cost_usd: costs.length ? Math.round(costs.reduce((s, c) => s + c, 0) * 1e6) / 1e6 : null,
    },
    rows,
  };
}
