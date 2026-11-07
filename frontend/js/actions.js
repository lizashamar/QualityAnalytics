// Операции, которые ходят в API и обновляют store. Компоненты вызывают только их.

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
  } catch (e) {
    store.set({ ready: true, error: e.message || String(e) });
  }
}

export async function refreshChecklists() {
  store.set({ checklists: await api.getChecklists() });
}

export async function ensureEvaluation(id) {
  if (store.get().evaluations[id]) return;
  try { putEvaluation(await api.getEvaluation(id), { asLatest: false }); } catch (e) { fail(e); }
}

export async function runEvaluation(conversationId, checklistId) {
  const s = store.get();
  const clId = checklistId || (activeChecklist(s) || {}).id;
  store.set((st) => ({ running: { ...st.running, [conversationId]: true } }));
  try {
    const ev = await api.runEvaluation(conversationId, clId);
    putEvaluation(ev);
    return ev;
  } finally {
    store.set((st) => { const r = { ...st.running }; delete r[conversationId]; return { running: r }; });
  }
}

export async function evaluateMany(ids, checklistId) {
  store.set({ applying: { done: 0, total: ids.length } });
  let ok = 0;
  try {
    for (const id of ids) {
      try { await runEvaluation(id, checklistId); ok++; } catch (e) { fail(e); }
      store.set((s) => ({ applying: { done: s.applying.done + 1, total: ids.length } }));
    }
  } finally {
    store.set({ applying: null });
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
  store.set((s) => ({ appeals: s.appeals.map((a) => (a.id === id ? ap : a)) }));
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
  store.set({ draft: null, review: null, modal: null, highlight: { indices: [], range: null } });
  await loadAll();
}
