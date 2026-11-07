// Единственное место с fetch. Все методы возвращают Promise.
// USE_MOCK=true -> данные из js/mock/, состояние в localStorage (ключ cqa.mock.v1).
//
// Ожидаемые эндпоинты бэкенда (относительно API_BASE):
//   GET  /conversations?group_id=           -> record[]
//   GET  /conversations/{id}                -> record
//   GET  /checklists                        -> checklist[] (все версии)
//   POST /checklists                        -> checklist (новая версия; тело: {family_id?, name, description, criteria})
//   POST /checklists/{id}/activate          -> checklist
//   POST /evaluations                       -> evaluation (тело: {conversation_id, checklist_id})
//   GET  /evaluations/{id}                  -> evaluation
//   GET  /evaluations/latest?conversation_id=&checklist_id=  -> evaluation | 404
//   GET  /evaluations?group_id=&latest=1    -> evaluation[] (последняя по каждому диалогу)
//   POST /appeals                           -> appeal (тело: {evaluation_item_id | conversation_id+criterion_id, comment})
//   GET  /appeals                           -> appeal[]
//   POST /appeals/{id}/resolve              -> appeal (тело: {new_answer, reason})

import { config } from './config.js';
import { validAnswer, validateChecklist } from './scoring.js';

const enc = encodeURIComponent;
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------- реальный API ----------
async function http(method, path, body) {
  const res = await fetch(config.API_BASE + path, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 404 && method === 'GET' && path.startsWith('/evaluations/latest')) return null;
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = j.detail || j.message || ''; } catch { /* не JSON */ }
    throw new Error(msg || `Ошибка API: HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// Бэкенд хранит статус апелляции как open|resolved|outdated; интерфейс называет открытую «pending».
const normAppeal = (a) => (a && a.status === 'open' ? { ...a, status: 'pending' } : a);

const remote = {
  getConversations: () => http('GET', `/conversations${qs({ group_id: config.GROUP_ID })}`),
  getConversation: (id) => http('GET', `/conversations/${enc(id)}`),
  getChecklists: () => http('GET', '/checklists'),
  saveChecklist: (cl) => http('POST', '/checklists', cl),
  activateChecklist: (id) => http('POST', `/checklists/${enc(id)}/activate`),
  runEvaluation: (conversationId, checklistId) => http('POST', '/evaluations', { conversation_id: conversationId, checklist_id: checklistId }),
  getEvaluation: (query) => (typeof query === 'string'
    ? http('GET', `/evaluations/${enc(query)}`)
    : http('GET', `/evaluations/latest${qs(query)}`)),
  listEvaluations: () => http('GET', `/evaluations${qs({ group_id: config.GROUP_ID, latest: 1 })}`),
  createAppeal: (data) => http('POST', '/appeals', data).then(normAppeal),
  listAppeals: () => http('GET', '/appeals').then((list) => list.map(normAppeal)),
  resolveAppeal: (appealId, data) => http('POST', `/appeals/${enc(appealId)}/resolve`, data).then(normAppeal),
};

// ---------- mock ----------
const KEY = 'cqa.mock.v1';
const clone = (x) => JSON.parse(JSON.stringify(x));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let memory = null; // если localStorage недоступен
let mockMods = null;

async function mods() {
  if (!mockMods) {
    const [conv, seed, evaluator, audio] = await Promise.all([
      import('./mock/conversations.js'), import('./checklist.seed.js'), import('./mock/evaluator.js'), import('./mock/audio.js'),
    ]);
    mockMods = { ...conv, ...seed, ...evaluator, ...audio };
  }
  return mockMods;
}

async function seedDb() {
  const m = await mods();
  const db = { seq: 1, conversations: clone(m.MOCK_CONVERSATIONS), checklists: [clone(m.SEED_CHECKLIST)], evaluations: [], appeals: [] };
  for (const id of m.PRE_EVALUATED) {
    const conv = db.conversations.find((c) => c.conversation_id === id);
    db.evaluations.push(m.evaluate(conv, db.checklists[0], `ev-${db.seq++}`, '2026-11-06T12:00:00+05:00'));
  }
  return db;
}

let loading = null; // параллельные вызовы при старте не должны сеять базу дважды
function load() {
  if (memory) return Promise.resolve(memory);
  if (!loading) {
    loading = (async () => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) return (memory = JSON.parse(raw));
      } catch { /* приватный режим и т.п. */ }
      const db = await seedDb();
      save(db);
      return db;
    })().finally(() => { loading = null; });
  }
  return loading;
}
function save(db) {
  memory = db;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* только в памяти */ }
}

async function withAudio(rec) {
  const r = clone(rec);
  const m = /^mock-audio:(\d+)$/.exec(r.audio_url || '');
  if (m) r.audio_url = (await mods()).mockAudioUrl(Number(m[1]));
  return r;
}

const latestFor = (db, convId, checklistId) => db.evaluations
  .filter((e) => e.conversation_id === convId && (!checklistId || e.checklist_id === checklistId))
  .sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || b.id.localeCompare(a.id, 'en', { numeric: true }))[0] || null;

function fail(msg) { throw new Error(msg); }

const mock = {
  async getConversations() {
    const db = await load(); await wait(120);
    return Promise.all(db.conversations.map(withAudio));
  },
  async getConversation(id) {
    const db = await load(); await wait(80);
    const c = db.conversations.find((x) => x.conversation_id === id) || fail(`Диалог ${id} не найден`);
    return withAudio(c);
  },
  async getChecklists() {
    const db = await load(); await wait(80);
    return clone(db.checklists);
  },
  async saveChecklist(cl) {
    const db = await load(); await wait(200);
    const errors = validateChecklist(cl.criteria || []);
    if (errors.length) fail(errors.join(' '));
    const family_id = cl.family_id || `cl-${Date.now().toString(36)}`;
    const version = Math.max(0, ...db.checklists.filter((x) => x.family_id === family_id).map((x) => x.version)) + 1;
    const created = {
      id: `${family_id}-v${version}`, family_id, version,
      name: String(cl.name || 'Без названия'), description: String(cl.description || ''),
      active: false, created_at: now(), based_on: cl.based_on || null, criteria: clone(cl.criteria),
    };
    db.checklists.push(created); save(db);
    return clone(created);
  },
  async activateChecklist(id) {
    const db = await load(); await wait(80);
    const cl = db.checklists.find((x) => x.id === id) || fail('Чек-лист не найден');
    db.checklists.forEach((x) => { x.active = x.id === id; }); save(db);
    return clone(cl);
  },
  async runEvaluation(conversationId, checklistId) {
    const db = await load(); await wait(700);
    const conv = db.conversations.find((x) => x.conversation_id === conversationId) || fail('Диалог не найден');
    const cl = db.checklists.find((x) => x.id === checklistId) || db.checklists.find((x) => x.active) || fail('Чек-лист не найден');
    const ev = (await mods()).evaluate(conv, cl, `ev-${db.seq++}`, now());
    db.evaluations.push(ev); save(db);
    return clone(ev);
  },
  async getEvaluation(query) {
    const db = await load(); await wait(60);
    if (typeof query === 'string') return clone(db.evaluations.find((e) => e.id === query) || fail('Оценка не найдена'));
    const e = latestFor(db, query.conversation_id, query.checklist_id);
    return e ? clone(e) : null;
  },
  async listEvaluations() {
    const db = await load(); await wait(60);
    return db.conversations.map((c) => latestFor(db, c.conversation_id)).filter(Boolean).map(clone);
  },
  async createAppeal({ evaluation_item_id, conversation_id, criterion_id, comment }) {
    const db = await load(); await wait(150);
    if (!String(comment || '').trim()) fail('Комментарий обязателен');
    let ev, item;
    if (evaluation_item_id) {
      ev = db.evaluations.find((e) => e.items.some((i) => i.id === evaluation_item_id));
      item = ev && ev.items.find((i) => i.id === evaluation_item_id);
    } else {
      ev = latestFor(db, conversation_id);
      item = ev && ev.items.find((i) => i.criterion_id === criterion_id);
    }
    if (!item) fail('Пункт оценки не найден');
    if (db.appeals.some((a) => a.evaluation_item_id === item.id && a.status === 'pending')) fail('По этому критерию уже есть апелляция на рассмотрении');
    const appeal = {
      id: `AP-${db.seq++}`, evaluation_id: ev.id, evaluation_item_id: item.id,
      conversation_id: ev.conversation_id, criterion_id: item.criterion_id, checklist_id: ev.checklist_id,
      original_answer: item.answer, comment: String(comment).trim(), status: 'pending', created_at: now(), resolution: null,
    };
    db.appeals.push(appeal); save(db);
    return clone(appeal);
  },
  async listAppeals() {
    const db = await load(); await wait(60);
    return clone(db.appeals);
  },
  async resolveAppeal(appealId, { new_answer, reason }) {
    const db = await load(); await wait(150);
    const ap = db.appeals.find((a) => a.id === appealId) || fail('Апелляция не найдена');
    if (ap.status !== 'pending') fail('Апелляция уже рассмотрена');
    if (!String(reason || '').trim()) fail('Причина решения обязательна');
    const cl = db.checklists.find((x) => x.id === ap.checklist_id);
    const crit = cl && cl.criteria.find((c) => c.id === ap.criterion_id);
    if (!validAnswer(crit, new_answer)) fail('Недопустимое значение ответа для этого критерия');
    ap.status = 'resolved';
    ap.resolution = { new_answer, reason: String(reason).trim(), resolved_at: now() };
    save(db);
    return clone(ap);
  },
  async resetMock() {
    memory = null;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    save(await seedDb());
  },
};

export const api = config.USE_MOCK ? mock : { ...remote, resetMock: async () => {} };
