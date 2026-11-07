import { api } from './api.js';
import { store } from './store.js';
import { activeChecklist } from './results.js';

let toastTimer = null;
export function toast(text, tone = '') {
  clearTimeout(toastTimer);
  store.set({ toast: { text, tone, at: Date.now() } });
  toastTimer = setTimeout(() => store.set({ toast: null }), 3200);
}

export function fail(e) {
  console.error(e);
  toast(e && e.message ? e.message : String(e), 'rd');
}

function putEvaluation(ev, { asLatest = true } = {}) {
  store.set((s) => ({
    evaluations: { ...s.evaluations, [ev.id]: ev },
    latest: asLatest ? { ...s.latest, [ev.conversation_id]: ev.id } : s.latest,
  }));
}

export async function loadAll() {
  try {
    const [conversations, checklists, evals, appeals] = await Promise.all([
      api.getConversations(), api.getChecklists(), api.listEvaluations(), api.listAppeals(),
    ]);
    const evaluations = {};
    const latest = {};
    for (const e of evals) { evaluations[e.id] = e; latest[e.conversation_id] = e.id; }
    store.set({ conversations, checklists, evaluations, latest, appeals, ready: true, error: null });
    loadHistory();
  } catch (e) {
    store.set({ ready: true, error: e.message || String(e) });
  }
}

/** История оценок по версиям чек-листа и средняя цена оценки. Ошибка не мешает основному экрану. */
export async function loadHistory() {
  try {
    const [history, cost] = await Promise.all([
      api.listEvaluationHistory ? api.listEvaluationHistory() : [],
      api.getEvaluationCost ? api.getEvaluationCost().catch(() => null) : null,
    ]);
    store.set({ history: history || [], avgCost: cost ? cost.average_cost_usd : null });
  } catch { store.set({ history: [] }); }
}

/** Сравнение двух версий чек-листа: s.compare = {from, to, loading, error, data}. */
export async function loadCompare(from, to) {
  store.set((s) => ({ compare: { ...(s.compare || {}), from, to, loading: true, error: null, data: null } }));
  try {
    const data = await api.compareChecklists(from, to);
    const cur = store.get().compare;
    if (cur && cur.from === from && cur.to === to) store.set({ compare: { ...cur, loading: false, data } });
  } catch (e) {
    const cur = store.get().compare;
    if (cur && cur.from === from && cur.to === to) store.set({ compare: { ...cur, loading: false, error: e.message || String(e) } });
  }
}

export async function refreshChecklists() {
  store.set({ checklists: await api.getChecklists() });
}

export async function ensureEvaluation(id) {
  if (store.get().evaluations[id]) return;
  try { putEvaluation(await api.getEvaluation(id), { asLatest: false }); } catch (e) { fail(e); }
}

const reviewRequests = new Map();
/** Appeals span dataset groups. Load their evidence without changing the loaded dataset. */
export async function ensureReviewContext(appealId) {
  if (reviewRequests.has(appealId)) return reviewRequests.get(appealId);
  const appeal = store.get().appeals.find((a) => a.id === appealId);
  if (!appeal) return;
  const request = (async () => {
    store.set((s) => ({ reviewLoads: { ...s.reviewLoads, [appealId]: { status: 'loading' } } }));
    try {
      const s = store.get();
      const [evaluation, conversation] = await Promise.all([
        s.evaluations[appeal.evaluation_id] || api.getEvaluation(appeal.evaluation_id),
        s.conversations.find((c) => c.conversation_id === appeal.conversation_id)
          || s.reviewConversations?.[appeal.conversation_id] || api.getConversation(appeal.conversation_id),
      ]);
      if (!evaluation || !conversation) throw new Error('Оценка или диалог больше недоступны.');
      store.set((current) => ({
        evaluations: { ...current.evaluations, [evaluation.id]: evaluation },
        reviewConversations: { ...current.reviewConversations, [conversation.conversation_id]: conversation },
        reviewLoads: { ...current.reviewLoads, [appealId]: { status: 'ready' } },
      }));
    } catch (e) {
      store.set((s) => ({ reviewLoads: { ...s.reviewLoads, [appealId]: {
        status: 'error', error: e.message || String(e),
      } } }));
    }
  })();
  reviewRequests.set(appealId, request);
  try { await request; } finally { reviewRequests.delete(appealId); }
}

export async function runEvaluation(conversationId, checklistId, { batch = false } = {}) {
  const s = store.get();
  if(s.running[conversationId] || s.applying&&!batch) throw new Error('Дождитесь завершения текущей оценки.');
  const clId = checklistId || (activeChecklist(s) || {}).id;
  store.set((st) => ({ running: { ...st.running, [conversationId]: true } }));
  try {
    const ev = await api.runEvaluation(conversationId, clId);
    putEvaluation(ev);
    store.set({ appeals: await api.listAppeals() });
    if (!store.get().applying) loadHistory(); // при массовой оценке — один раз в конце
    return ev;
  } finally {
    store.set((st) => { const r = { ...st.running }; delete r[conversationId]; return { running: r }; });
  }
}

export async function evaluateMany(ids, checklistId) {
  if (store.get().applying) throw new Error("Массовая оценка уже выполняется");
  ids = [...new Set(ids)];
  store.set({ applying: { done: 0, total: ids.length } });
  let ok = 0;
  try {
    for (const id of ids) {
      try { await runEvaluation(id, checklistId, {batch:true}); ok++; } catch (e) { fail(e); }
      store.set((s) => ({ applying: { done: s.applying.done + 1, total: ids.length } }));
    }
  } finally {
    store.set({ applying: null });
    loadHistory();
  }
  return ok;
}

export async function createAppeal(data) {
  const ap = await api.createAppeal(data);
  store.set((s) => ({ appeals: [...s.appeals, ap] }));
  return ap;
}

export async function resolveAppeal(id, data) {
  const ap = await api.resolveAppeal(id, data);
  const ev = await api.getEvaluation(ap.evaluation_id);
  putEvaluation(ev, { asLatest: store.get().latest[ev.conversation_id] === ev.id });
  store.set((s) => ({ appeals: s.appeals.map((a) => (a.id === id ? ap : a)) }));
  loadHistory();
  return ap;
}

export async function saveChecklist(draft, activate) {
  const saved = await api.saveChecklist({
    family_id: draft.family_id || null,
    based_on: draft.based_on || null,
    name: draft.name,
    description: draft.description,
    criteria: draft.criteria,
    activate: !!activate,
  });
  if (activate) await api.activateChecklist(saved.id);
  await refreshChecklists();
  return saved;
}

export async function activateChecklist(id) {
  await api.activateChecklist(id);
  await refreshChecklists();
}

export async function resetDemo() {
  await api.resetMock();
  store.set({ draft: null, review: null, reviewConversations: {}, reviewLoads: {}, modal: null, highlight: { indices: [], range: null } });
  await loadAll();
}
