import { calculate, round2 } from './scoring.js';
import { html } from './html.js';
import { icon } from './icons.js';

export const LANG = { RU: 'Русский', KZ: 'Қазақша', EN: 'English' };
export const CHANNEL = { 'agent chat': 'Чат', 'voice call': 'Звонок' };
export const ROLE = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };

export const checklistById = (s, id) => s.checklists.find((c) => c.id === id) || null;
export const activeChecklist = (s) => s.checklists.find((c) => c.active) || s.checklists[s.checklists.length - 1] || null;
export const latestEvaluation = (s, convId) => s.evaluations?.[s.latest?.[convId]] || null;
export const criterionOf = (cl, id) => (cl ? cl.criteria.find((c) => c.id === id) : null) || null;
export const checklistLabel = (cl) => (cl ? `${cl.name} · v${cl.version}` : 'неизвестный чек-лист');

/** Итоги: исходный (как пришёл в evaluation) и финальный (после решений проверяющего). */
export function finalResult(s, ev) {
  const saved = checklistById(s, ev.checklist_id);
  const criteria = ev.criteria || saved?.criteria || [];
  const cl = saved ? { ...saved, criteria } : criteria.length ? { id:ev.checklist_id, name:ev.checklist_id, version:ev.checklist_version, criteria } : null;
  const appeals = s.appeals.filter((a) => a.evaluation_id === ev.id);
  const decisions = {};
  appeals
    .filter((a) => a.status === 'resolved' && a.resolution)
    .sort((a, b) => Date.parse(a.resolution.resolved_at) - Date.parse(b.resolution.resolved_at))
    .forEach((a) => { decisions[a.criterion_id] = a; });
  const pending = {};
  appeals.filter((a) => a.status === 'pending').forEach((a) => { pending[a.criterion_id] = a; });

  const originalAnswers = Object.fromEntries(ev.items.map((i) => [i.criterion_id, i.answer]));
  const finalAnswers = { ...originalAnswers };
  for (const [cid, a] of Object.entries(decisions)) finalAnswers[cid] = a.resolution.new_answer;
  const changed = Object.keys(decisions).some((cid) => decisions[cid].resolution.new_answer !== originalAnswers[cid]);

  const originalCalc = calculate(criteria, originalAnswers); // для весов после перераспределения
  const finalCalc = changed ? calculate(criteria, finalAnswers) : null;
  return {
    checklist: cl,
    criteria,
    decisions,
    pending,
    changed,
    hasDecisions: Object.keys(decisions).length > 0,
    originalCalc,
    original: { total: ev.total, gross_flag: ev.gross_flag, sections: ev.sections },
    final: finalCalc
      ? { total: finalCalc.total, gross_flag: finalCalc.gross_flag, sections: finalCalc.sections, rows: finalCalc.rows }
      : { total: ev.total, gross_flag: ev.gross_flag, sections: ev.sections, rows: originalCalc.rows },
    finalAnswers,
  };
}

const maxStep = (c) => Math.max(0, ...(c.scale_steps || []).map(Number));

export function answerText(c, a) {
  if (a === undefined || a === null) return 'нет ответа';
  if (!c) return String(a);
  if (a === 'na') return 'N/A';
  if (c.is_flag) return a === 'yes' ? 'Нарушение выявлено' : a === 'no' ? 'Нарушение не выявлено' : String(a);
  if (c.type === 'scale') return `${a} из ${maxStep(c)}`;
  return a === 'yes' ? 'Да' : a === 'no' ? 'Нет' : String(a);
}

export function answerTone(c, a) {
  if (!c || a === undefined || a === null) return { cls: 'ne', icon: 'help' };
  if (a === 'na') return { cls: 'ne', icon: 'minus' };
  if (c.is_flag) return a === 'yes' ? { cls: 'rd', icon: 'alert' } : { cls: 'ok', icon: 'check' };
  const f = c.type === 'scale' ? (maxStep(c) ? a / maxStep(c) : 0) : a === 'yes' ? 1 : 0;
  if (f >= 0.75) return { cls: 'ok', icon: 'check' };
  if (f >= 0.4) return { cls: 'wn', icon: 'half' };
  return { cls: 'rd', icon: 'x' };
}

export function answerBadge(c, a) {
  const t = answerTone(c, a);
  return html`<span class="b ${t.cls}">${icon(t.icon)}<span>${answerText(c, a)}</span></span>`;
}

export function scoreTone(v) {
  if (v === null || v === undefined) return 'ne';
  return v >= 80 ? 'ok' : v >= 60 ? 'wn' : 'rd';
}
export const TONE_LABEL = { ok: 'хорошо', wn: 'частично', rd: 'низко', ne: 'нет данных' };
export const TONE_ICON = { ok: 'check', wn: 'half', rd: 'x', ne: 'minus' };
export const fmtScore = (v) => (v === null || v === undefined ? '—' : round2(v).toFixed(2));
export const fmtPts = (v) => (Math.round(v * 100) / 100).toFixed(2);

export function scoreBadge(v) {
  const t = scoreTone(v);
  return html`<span class="b ${t}">${icon(TONE_ICON[t])}<span>${fmtScore(v)}</span></span>`;
}

export const STATUS = {
  none: 'Не оценён',
  error: 'Ошибка оценки',
  stale: 'Нужна переоценка',
  evaluated: 'Оценён',
  appeal: 'Апелляция на рассмотрении',
  reviewed: 'Пересмотрен',
};

export function conversationStatus(s, convId) {
  const ev = latestEvaluation(s, convId);
  if (!ev) return 'none';
  if (ev.stale) return 'stale';
  if (ev.status === 'error') return 'error';
  const ap = s.appeals.filter((a) => a.evaluation_id === ev.id);
  if (ap.some((a) => a.status === 'pending')) return 'appeal';
  if (ap.some((a) => a.status === 'resolved')) return 'reviewed';
  return 'evaluated';
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Оценки диалога по разным версиям чек-листа (из s.history): последние две версии, по возрастанию.
 *  Возвращает null, если версия одна. Итог — с учётом решения проверяющего, если оно есть. */
export function versionTrail(s, convId) {
  const history=(s.history||[]).filter(h=>h.conversation_id===convId&&h.status!=='error'&&!h.stale);
  const current=latestEvaluation(s,convId)?.checklist_id||[...history].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]?.checklist_id;
  const family=s.checklists?.find(c=>c.id===current)?.family_id;
  const list=history.filter(h=>!family||s.checklists.some(c=>c.id===h.checklist_id&&c.family_id===family))
    .sort((a,b)=>a.checklist_version-b.checklist_version||String(a.created_at).localeCompare(String(b.created_at)));
  if (list.length < 2) return null;
  const pick = list.slice(-2).map((h) => ({ version: h.checklist_version, checklist_id: h.checklist_id, total: h.final_total ?? h.total }));
  const [a, b] = pick;
  return { from: a, to: b, delta: a.total != null && b.total != null ? round2(b.total - a.total) : null };
}

export function trailView(t) {
  if (!t) return '';
  const tone = t.delta == null || Math.abs(t.delta) < 0.005 ? 'ne' : t.delta > 0 ? 'ok' : 'rd';
  const ic = tone === 'ok' ? 'up' : tone === 'rd' ? 'down' : 'minus';
  return html`<span class="ver-trail d-${tone}" title="Итог по версиям чек-листа">v${t.from.version}: <b>${fmtScore(t.from.total)}</b> ${icon('arrowRight')} v${t.to.version}: <b>${fmtScore(t.to.total)}</b>
    ${t.delta != null ? html`<span class="ver-delta">${icon(ic)}${t.delta > 0 ? '+' : ''}${fmtPts(t.delta)}</span>` : ''}</span>`;
}

export const replicaNo = (i) => i + 1;
