const initial = {
  datasetGroup: '',
  importing: false,
  ready: false,
  error: null,
  route: { name: 'conversations', params: {} },
  conversations: [],
  checklists: [],
  evaluations: {}, // evaluation_id -> evaluation
  latest: {}, // conversation_id -> evaluation_id (последняя оценка)
  appeals: [],
  filters: { q: '', language: '', channel: '', status: '' },
  appealFilter: 'pending',
  selectedConversations: [],
  batchChecklistId: null,
  batchSummary: null,
  cardChecklistId: null, // выбранный на карточке чек-лист для запуска оценки
  running: {}, // conversation_id -> true, пока идёт оценка
  highlight: { indices: [], range: null },
  review: null, // { appealId, answer, reason } — форма проверяющего
  reviewConversations: {}, // context from other dataset groups; excluded from analytics
  reviewLoads: {}, // appeal_id -> { status: loading|ready|error, error? }
  draft: null, // черновик чек-листа в редакторе
  modal: null, // { type, ... }
  applying: null, // { done, total } — массовая оценка
  toast: null,
  theme: 'auto',
};

let state = { ...initial };
const listeners = new Set();

export const store = {
  get: () => state,
  /** set(patch | state => patch, { silent }) — silent не перерисовывает (значения полей ввода). */
  set(patch, { silent = false } = {}) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    if (!silent) listeners.forEach((fn) => fn(state));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
