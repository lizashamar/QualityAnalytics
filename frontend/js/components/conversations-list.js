// Список диалогов: поиск, фильтры (язык, канал, статус), итог и флаг грубого нарушения.

import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { config } from '../config.js';
import { loadAll, toast, evaluateMany } from '../actions.js';
import {
  LANG, CHANNEL, STATUS, latestEvaluation, finalResult, conversationStatus, checklistById, fmtScore, activeChecklist, checklistLabel,
} from '../results.js';
import { scoreRing, emptyState } from './ui.js';

const STATUS_TONE = { none: 'ne', evaluated: 'ok', appeal: 'wn', reviewed: 'ac' };
const STATUS_ICON = { none: 'circle', evaluated: 'check', appeal: 'clock', reviewed: 'scale' };

export function rowsFor(s) {
  return s.conversations.map((conv) => {
    const ev = latestEvaluation(s, conv.conversation_id);
    const R = ev ? finalResult(s, ev) : null;
    return { conv, ev, R, status: conversationStatus(s, conv.conversation_id) };
  });
}

function matches(f, r) {
  const c = r.conv;
  if (f.language && c.language !== f.language) return false;
  if (f.channel && c.channel !== f.channel) return false;
  if (f.status === 'flag') { if (!(r.R && r.R.final.gross_flag)) return false; }
  else if (f.status && r.status !== f.status) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return c.conversation_id.toLowerCase().includes(q) || c.transcript.some((t) => String(t.text).toLowerCase().includes(q));
}

function preview(conv) {
  const first = conv.transcript.find((t) => t.speaker === 'client') || conv.transcript[0];
  if (!first) return '';
  const t = String(first.text);
  return t.length > 110 ? t.slice(0, 110) + '…' : t;
}

function cardView(s, r, selected, busy) {
  const c = r.conv;
  const cl = r.ev ? checklistById(s, r.ev.checklist_id) : null;
  const isCall = c.channel === 'voice call';
  const flag = r.R && r.R.final.gross_flag;
  return html`<li class="conv${flag ? ' has-flag' : ''}" data-action="open-conv" data-id="${c.conversation_id}">
    <div class="conv-main">
      <div class="conv-top">
        <input type="checkbox" class="conv-select" data-change="select-conversation" data-id="${c.conversation_id}" aria-label="Выбрать диалог ${c.conversation_id}" ${attr('checked', selected.has(c.conversation_id))} ${attr('disabled', busy)}>
        <span class="conv-ch ${isCall ? 'call' : ''}" title="${CHANNEL[c.channel] || c.channel}">${icon(isCall ? 'phone' : 'chat')}</span>
        <a class="conv-id" href="#/conversations/${encodeURIComponent(c.conversation_id)}">${c.conversation_id}</a>
      </div>
      <p class="conv-preview">${preview(c)}</p>
      <div class="badges">
        <span class="b ne">${c.language}</span>
        <span class="b ne">${CHANNEL[c.channel] || c.channel}</span>
        <span class="b ${STATUS_TONE[r.status]}">${icon(STATUS_ICON[r.status])}<span>${STATUS[r.status]}</span></span>
        ${flag ? html`<span class="b rd">${icon('flag')}<span>Грубое нарушение</span></span>` : ''}
        ${cl ? html`<span class="hint">v${cl.version} · ${c.transcript.length} реплик</span>` : html`<span class="hint">${c.transcript.length} реплик</span>`}
      </div>
    </div>
    <div class="conv-score">
      ${r.R ? html`${scoreRing(r.R.final.total, { key: r.ev.id, size: 'sm', label: `Итог ${c.conversation_id}` })}
        ${r.R.changed ? html`<span class="hint was" title="Исходная оценка">было ${fmtScore(r.ev.total)}</span>` : ''}`
        : html`<span class="ring-empty" aria-label="Не оценён">—</span>`}
    </div>
  </li>`;
}

export function view(s) {
  const f = s.filters;
  const all = rowsFor(s);
  const rows = all.filter((r) => matches(f, r));
  const langs = [...new Set(s.conversations.map((c) => c.language))];
  const channels = [...new Set(s.conversations.map((c) => c.channel))];
  const selected = new Set((s.selectedConversations || []).filter((id) => s.conversations.some((c) => c.conversation_id === id)));
  const checklist = s.checklists.find((c) => c.id === s.batchChecklistId) || activeChecklist(s);
  const busy = !!s.applying || !!s.importing || Object.keys(s.running || {}).length > 0;
  const opt = (v, label, cur) => html`<option value="${v}" ${attr('selected', v === cur)}>${label}</option>`;
  const filtered = f.q || f.language || f.channel || f.status;

  return html`
    <div class="page-head"><div><h2>Диалоги</h2>
      <p class="sub">Откройте диалог, чтобы увидеть оценку, доказательства и оспорить результат.</p></div></div>
    ${!config.USE_MOCK ? html`<form class="card row dataset-import" data-submit="dataset-import">
      <label for="dataset-group">Группа датасета</label>
      <input id="dataset-group" name="group_id" value="${s.datasetGroup || config.GROUP_ID || 'DEV'}" maxlength="128" required ${attr('disabled', busy)}>
      <button type="submit" class="p" ${attr('disabled', busy)}>${s.importing ? 'Загрузка…' : 'Загрузить группу'}</button>
      <span class="mu small">DEV или группа контрольного набора. Оценка запускается отдельно.</span>
    </form>` : ''}
    <div class="filters card" role="search">
      <div class="search">${icon('search')}<label class="sr" for="f-q">Поиск</label>
        <input id="f-q" type="search" placeholder="Поиск по ID и тексту реплик" value="${f.q}" data-input="filter" data-key="q"></div>
      <label class="sr" for="f-lang">Язык</label>
      <select id="f-lang" data-change="filter" data-key="language">${opt('', 'Все языки', f.language)}${langs.map((l) => opt(l, `${LANG[l] || l} (${l})`, f.language))}</select>
      <label class="sr" for="f-ch">Канал</label>
      <select id="f-ch" data-change="filter" data-key="channel">${opt('', 'Чаты и звонки', f.channel)}${channels.map((c) => opt(c, CHANNEL[c] || c, f.channel))}</select>
      <label class="sr" for="f-st">Статус оценки</label>
      <select id="f-st" data-change="filter" data-key="status">${opt('', 'Любой статус', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v, f.status))}${opt('flag', 'С грубым нарушением', f.status)}</select>
      ${filtered ? html`<button type="button" class="ghost" data-action="filter-reset">${icon('x')}Сбросить</button>` : ''}
    </div>
    <section class="card batch-controls" aria-label="Массовая оценка">
      <div class="row">
        <label for="batch-checklist">Чек-лист для оценки</label>
        <select id="batch-checklist" data-change="batch-checklist" ${attr('disabled', busy)}>
          ${s.checklists.map((c) => opt(c.id, checklistLabel(c), checklist?.id))}
        </select>
        <button type="button" class="p" data-action="evaluate-selected" ${attr('disabled', busy || !checklist || !selected.size)}>Оценить выбранные (${selected.size})</button>
        <button type="button" data-action="evaluate-all" ${attr('disabled', busy || !checklist || !all.length)}>Оценить все (${all.length})</button>
        <button type="button" class="link" data-action="selection-clear" ${attr('disabled', busy || !selected.size)}>Снять выбор</button>
      </div>
      <p class="mu small">«Оценить все» — все диалоги загруженной группы, включая скрытые фильтрами. Выбранные диалоги сохраняются при фильтрации. Повторная оценка создаёт новый результат.</p>
      ${s.applying ? html`<p role="status">Оценено ${s.applying.done} из ${s.applying.total}…</p>
        <progress max="${s.applying.total}" value="${s.applying.done}" aria-label="Прогресс оценки"></progress>` : ''}
      ${s.batchSummary ? html`<p role="status">Готово: ${s.batchSummary.ok} из ${s.batchSummary.total}. Ошибок: ${s.batchSummary.total - s.batchSummary.ok}.</p>` : ''}
    </section>
    <label class="select-visible"><input id="select-visible" type="checkbox" data-change="select-visible" ${attr('checked', rows.length > 0 && rows.every((r) => selected.has(r.conv.conversation_id)))} ${attr('disabled', busy || !rows.length)}> Выбрать все показанные диалоги</label>
    <p class="hint" aria-live="polite">Показано ${rows.length} из ${all.length}</p>
    ${rows.length
      ? html`<ul class="conv-list" aria-label="Список диалогов">${rows.map((r) => cardView(s, r, selected, busy))}</ul>`
      : html`<div class="card">${emptyState('search', 'Ничего не найдено', 'Нет диалогов под эти фильтры.',
          filtered ? html`<button type="button" data-action="filter-reset">Сбросить фильтры</button>` : '')}</div>`}`;
}

export const handlers = {
  submit: {
    async 'dataset-import'(form) {
      if (store.get().importing || store.get().applying) return;
      const group = form.querySelector('[name="group_id"]').value.trim();
      if (!group) return;
      store.set({importing:true, datasetGroup:group});
      try {
        const result = await api.importDataset(group);
        await loadAll();
        store.set({selectedConversations:[], batchSummary:null});
        toast(`Группа ${group}: загружено ${result.imported} из ${result.total}; пропущено ${result.skipped}`, 'ok');
      } catch (e) { toast(e.message, 'rd'); }
      finally { store.set({importing:false}); }
    },
  },
  input: {
    filter(el) { store.set((s) => ({ filters: { ...s.filters, [el.dataset.key]: el.value } })); },
  },
  change: {
    'batch-checklist'(el) { store.set({batchChecklistId:el.value}); },
    'select-conversation'(el) {
      if (store.get().applying) return;
      const selected = new Set(store.get().selectedConversations || []);
      if (el.checked) selected.add(el.dataset.id); else selected.delete(el.dataset.id);
      store.set({selectedConversations:[...selected]});
    },
    'select-visible'(el) {
      const s = store.get();
      if (s.applying) return;
      const selected = new Set(s.selectedConversations || []);
      rowsFor(s).filter((r) => matches(s.filters,r)).forEach((r) => {
        if (el.checked) selected.add(r.conv.conversation_id); else selected.delete(r.conv.conversation_id);
      });
      store.set({selectedConversations:[...selected]});
    },
    filter(el) { store.set((s) => ({ filters: { ...s.filters, [el.dataset.key]: el.value } })); },
  },
  click: {
    'selection-clear'() { if (!store.get().applying) store.set({selectedConversations:[]}); },
    'evaluate-selected'() { return evaluateSelection(false); },
    'evaluate-all'() { return evaluateSelection(true); },
    'filter-reset'() { store.set({ filters: { q: '', language: '', channel: '', status: '' } }); },
    'open-conv'(el, ev) {
      if (ev.target.closest('a,input,button,label,select')) return; // ссылка сама сменит hash
      location.hash = `#/conversations/${encodeURIComponent(el.dataset.id)}`;
    },
  },
};

async function evaluateSelection(all) {
  const s = store.get();
  if (s.applying || s.importing || Object.keys(s.running || {}).length) return;
  const checklist = s.checklists.find((c) => c.id === s.batchChecklistId) || activeChecklist(s);
  const selected = new Set(s.selectedConversations || []);
  const ids = s.conversations.filter((c) => all || selected.has(c.conversation_id)).map((c) => c.conversation_id);
  if (!checklist || !ids.length) return;
  store.set({batchSummary:null});
  const ok = await evaluateMany(ids,checklist.id);
  store.set({batchSummary:{ok,total:ids.length}});
  toast(`Оценено ${ok} из ${ids.length}`, ok === ids.length ? 'ok' : 'rd');
}
