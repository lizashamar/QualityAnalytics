// Список диалогов: поиск, фильтры (язык, канал, статус), итог и флаг грубого нарушения.

import { html, attr } from '../html.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { config } from '../config.js';
import { loadAll, toast, evaluateMany } from '../actions.js';
import {
  LANG, CHANNEL, STATUS, latestEvaluation, finalResult, conversationStatus, scoreBadge, checklistById, activeChecklist, checklistLabel,
} from '../results.js';

const STATUS_TONE = { none: 'ne', evaluated: 'ok', appeal: 'wn', reviewed: 'ac' };

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

  return html`
    <h2>Диалоги</h2>
    <p class="sub">Откройте диалог, чтобы увидеть оценку, доказательства и оспорить результат.</p>
    ${!config.USE_MOCK ? html`<form class="card row dataset-import" data-submit="dataset-import">
      <label for="dataset-group">Группа датасета</label>
      <input id="dataset-group" name="group_id" value="${s.datasetGroup || config.GROUP_ID || 'DEV'}" maxlength="128" required ${attr('disabled', busy)}>
      <button type="submit" class="p" ${attr('disabled', busy)}>${s.importing ? 'Загрузка…' : 'Загрузить группу'}</button>
      <span class="mu small">DEV или группа контрольного набора. Оценка запускается отдельно.</span>
    </form>` : ''}
    <div class="row filters" role="search">
      <label class="sr" for="f-q">Поиск</label>
      <input id="f-q" type="search" placeholder="Поиск по ID и тексту реплик" value="${f.q}" data-input="filter" data-key="q">
      <label class="sr" for="f-lang">Язык</label>
      <select id="f-lang" data-change="filter" data-key="language">${opt('', 'Все языки', f.language)}${langs.map((l) => opt(l, `${LANG[l] || l} (${l})`, f.language))}</select>
      <label class="sr" for="f-ch">Канал</label>
      <select id="f-ch" data-change="filter" data-key="channel">${opt('', 'Чаты и звонки', f.channel)}${channels.map((c) => opt(c, CHANNEL[c] || c, f.channel))}</select>
      <label class="sr" for="f-st">Статус оценки</label>
      <select id="f-st" data-change="filter" data-key="status">${opt('', 'Любой статус', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v, f.status))}${opt('flag', 'С грубым нарушением', f.status)}</select>
      ${f.q || f.language || f.channel || f.status ? html`<button type="button" data-action="filter-reset">Сбросить</button>` : ''}
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
    <p class="mu small" aria-live="polite">Показано ${rows.length} из ${all.length}</p>
    <div class="card tw">
      <table>
        <caption class="sr">Список диалогов</caption>
        <thead><tr><th scope="col"><input id="select-visible" type="checkbox" data-change="select-visible" aria-label="Выбрать все показанные диалоги" ${attr('checked', rows.length > 0 && rows.every((r) => selected.has(r.conv.conversation_id)))} ${attr('disabled', busy || !rows.length)}></th><th scope="col">ID</th><th scope="col">Язык</th><th scope="col">Канал</th><th scope="col">Реплик</th>
          <th scope="col">Статус</th><th scope="col">Итог</th><th scope="col">Грубое нарушение</th><th scope="col">Чек-лист</th></tr></thead>
        <tbody>
        ${rows.map((r) => {
          const cl = r.ev ? checklistById(s, r.ev.checklist_id) : null;
          return html`<tr class="c" data-action="open-conv" data-id="${r.conv.conversation_id}">
            <td><input type="checkbox" data-change="select-conversation" data-id="${r.conv.conversation_id}" aria-label="Выбрать диалог ${r.conv.conversation_id}" ${attr('checked', selected.has(r.conv.conversation_id))} ${attr('disabled', busy)}></td>
            <td><a href="#/conversations/${encodeURIComponent(r.conv.conversation_id)}"><b>${r.conv.conversation_id}</b></a></td>
            <td>${r.conv.language}</td>
            <td>${CHANNEL[r.conv.channel] || r.conv.channel}</td>
            <td>${r.conv.transcript.length}</td>
            <td><span class="b ${STATUS_TONE[r.status]}">${STATUS[r.status]}</span></td>
            <td>${r.R ? html`${scoreBadge(r.R.final.total)}${r.R.changed ? html` <span class="mu small" title="Исходная оценка">было ${r.ev.total ?? '—'}</span>` : ''}` : '—'}</td>
            <td>${r.R ? (r.R.final.gross_flag ? html`<span class="b rd">⚠ Выявлено</span>` : html`<span class="mu">не выявлено</span>`) : ''}</td>
            <td class="mu small">${cl ? `v${cl.version}` : ''}</td>
          </tr>`;
        })}
        ${rows.length ? '' : html`<tr><td colspan="9" class="mu">Нет диалогов под эти фильтры.</td></tr>`}
        </tbody>
      </table>
    </div>`;
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
