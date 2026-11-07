import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { config } from '../config.js';
import { loadAll, toast, evaluateMany } from '../actions.js';
import {
  LANG, CHANNEL, STATUS, latestEvaluation, finalResult, conversationStatus, checklistById, fmtScore, activeChecklist, checklistLabel,
  versionTrail, trailView,
} from '../results.js';
import { scoreRing, emptyState } from './ui.js';
import { FILTER_DEFAULTS, PAGE_SIZE, matchesRow, sortRows, explorerHref } from '../design/explorer.js';

const STATUS_TONE = { none: 'ne', evaluated: 'ok', appeal: 'wn', reviewed: 'ac', error:'rd', stale:'wn' };
const STATUS_ICON = { none: 'circle', evaluated: 'check', appeal: 'clock', reviewed: 'scale', error:'alert', stale:'refresh' };

export function rowsFor(s) {
  return s.conversations.map((conv) => {
    const ev = latestEvaluation(s, conv.conversation_id);
    const R = ev && ev.status !== 'error' && !ev.stale ? finalResult(s, ev) : null;
    return { conv, ev, R, status: conversationStatus(s, conv.conversation_id) };
  });
}

function updateFilters(patch) {
  const filters = { ...FILTER_DEFAULTS, ...store.get().filters, ...patch };
  history.replaceState(null, '', explorerHref(filters, store.get().explorerSort));
  store.set({ filters, explorerPage: 1 });
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
        <span class="b ne" title="Основной язык: ${c.language}">${c.languages?.length?c.languages.join(' + '):c.language}</span>${c.synthetic?html`<span class="b ne">Синтетический</span>`:''}
        <span class="b ne">${CHANNEL[c.channel] || c.channel}</span>
        <span class="b ${STATUS_TONE[r.status]}">${icon(STATUS_ICON[r.status])}<span>${STATUS[r.status]}</span></span>
        ${flag ? html`<span class="b rd">${icon('flag')}<span>Грубое нарушение</span></span>` : ''}
        ${cl ? html`<span class="hint">v${cl.version} · ${c.transcript.length} реплик</span>` : html`<span class="hint">${c.transcript.length} реплик</span>`}
      </div>
      ${trailView(versionTrail(s, c.conversation_id))}
    </div>
    <div class="conv-score"><span class="sr">Итоговый балл</span>
      ${r.R ? html`${scoreRing(r.R.final.total, { key: r.ev.id, size: 'sm', label: `Итог ${c.conversation_id}` })}
        ${r.R.changed ? html`<span class="hint was" title="Исходная оценка">было ${fmtScore(r.ev.total)}</span>` : ''}`
        : html`<span class="ring-empty" aria-label="Не оценён">—</span>`}
    </div>
  </li>`;
}

export function view(s) {
  const f = { ...FILTER_DEFAULTS, ...s.filters };
  const all = rowsFor(s);
  const rows = sortRows(all.filter(r => matchesRow(f, r)), s.explorerSort);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, s.explorerPage || 1), pages);
  const visible = rows.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  const langs = [...new Set(s.conversations.map((c) => c.language))];
  const channels = [...new Set(s.conversations.map((c) => c.channel))];
  const selected = new Set((s.selectedConversations || []).filter((id) => s.conversations.some((c) => c.conversation_id === id)));
  const checklist = s.checklists.find((c) => c.id === s.batchChecklistId) || activeChecklist(s);
  const busy = !!s.applying || !!s.importing || Object.keys(s.running || {}).length > 0;
  const opt = (v, label, cur) => html`<option value="${v}" ${attr('selected', v === cur)}>${label}</option>`;
  const filtered = Object.values(f).some(Boolean);
  const hiddenSelection = [...selected].filter(id=>!visible.some(r=>r.conv.conversation_id===id)).length;
  const filterLabels = { q:`Поиск: ${f.q}`,language:LANG[f.language]||f.language,channel:CHANNEL[f.channel]||f.channel,status:STATUS[f.status]||(f.status==='flag'?'Грубое нарушение':''),quality:({low:'Ниже 60 баллов',attention:'60–<80 баллов',high:'80–100 баллов'})[f.quality],from:`С ${f.from}`,to:`По ${f.to}` };

  return html`
    <div class="page-head"><div><h2>Диалоги</h2>
      <p class="sub">Найдите разговор, проверьте оценку и откройте доказательства.</p></div></div>
    ${!config.USE_MOCK ? html`<form class="card row dataset-import" data-submit="dataset-import">
      <label for="dataset-group">Группа датасета</label>
      <input id="dataset-group" name="group_id" value="${s.datasetGroup || config.GROUP_ID || 'DEV'}" maxlength="128" required ${attr('disabled', busy)}>
      <button type="submit" class="p" ${attr('disabled', busy)}>${s.importing ? 'Загрузка…' : 'Загрузить группу'}</button>
      <span class="mu small">DEV или группа контрольного набора. Оценка запускается отдельно.</span>
    </form>` : ''}
    ${!config.USE_MOCK?html`<details class="card demo-details"><summary>Сдать результаты организаторам</summary><p class="hint">JSON 1.0 по официальному чек-листу: DEV — 65 диалогов, контрольный набор — 10. Ошибки сохраняются отдельными записями без балла.</p><form class="submission-export" data-submit="submission-export" aria-label="Экспорт результатов"><div><label for="export-team">Команда</label><input id="export-team" name="team_name" value="kudafest" required></div><div><label for="export-group">Группа API</label><input id="export-group" name="group_id" value="${s.datasetGroup||config.GROUP_ID||'DEV'}" required></div><div><label for="export-split">Набор</label><select id="export-split" name="split"><option value="dev">DEV · 65</option><option value="prod">Контрольный · 10</option></select></div><button type="submit">${icon('download')}Скачать results.json</button></form><p class="hint" role="status" data-export-status></p></details>`:''}
    <div class="filters card" role="search" aria-label="Фильтры диалогов">
      <div class="search">${icon('search')}<label class="sr" for="f-q">Поиск</label>
        <input id="f-q" type="search" placeholder="Поиск по ID и тексту реплик" value="${f.q}" data-input="filter" data-key="q"></div>
      <label class="sr" for="f-lang">Язык</label>
      <select id="f-lang" data-change="filter" data-key="language">${opt('', 'Все языки', f.language)}${langs.map((l) => opt(l, `${LANG[l] || l} (${l})`, f.language))}</select>
      <label class="sr" for="f-ch">Канал</label>
      <select id="f-ch" data-change="filter" data-key="channel">${opt('', 'Чаты и звонки', f.channel)}${channels.map((c) => opt(c, CHANNEL[c] || c, f.channel))}</select>
      <label class="sr" for="f-st">Статус оценки</label>
      <select id="f-st" data-change="filter" data-key="status">${opt('', 'Любой статус', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v, f.status))}${opt('flag', 'С грубым нарушением', f.status)}</select>
      <label class="sr" for="f-quality">Уровень качества</label><select id="f-quality" data-change="filter" data-key="quality">${opt('','Любой балл',f.quality)}${opt('low','Ниже 60',f.quality)}${opt('attention','60–<80',f.quality)}${opt('high','80–100',f.quality)}</select>
    </div>
    <div class="date-filters"><span>Дата последней оценки (UTC)</span><label for="f-from">С</label><input id="f-from" type="date" value="${f.from}" max="${f.to}" data-change="filter" data-key="from"><label for="f-to">По</label><input id="f-to" type="date" value="${f.to}" min="${f.from}" data-change="filter" data-key="to">${filtered?html`<button type="button" class="link" data-action="filter-reset">Сбросить всё</button>`:''}
    </div>
    ${filtered?html`<div class="active-filters" aria-label="Активные фильтры">${Object.keys(FILTER_DEFAULTS).filter(k=>f[k]).map(k=>html`<button type="button" class="filter-chip" data-action="filter-remove" data-key="${k}" aria-label="Убрать фильтр: ${filterLabels[k]}">${filterLabels[k]}${icon('x')}</button>`)}</div>`:''}
    <section class="card batch-controls${s.applying ? ' is-evaluating' : ''}" aria-label="Массовая оценка">
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
    <div class="explorer-toolbar"><label class="select-visible"><input id="select-visible" type="checkbox" data-change="select-visible" ${attr('checked', visible.length > 0 && visible.every((r) => selected.has(r.conv.conversation_id)))} ${attr('disabled', busy || !visible.length)}> Выбрать страницу</label>
    <p class="hint" aria-live="polite">${rows.length?`${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,rows.length)} из ${rows.length}`:'0 результатов'}${filtered?` · в наборе ${all.length}`:''}</p><label class="sr" for="explorer-sort">Сортировка</label><select id="explorer-sort" data-change="explorer-sort">${opt('recent','Сначала последние оценки',s.explorerSort||'recent')}${opt('score-asc','Сначала низкие баллы',s.explorerSort)}${opt('score-desc','Сначала высокие баллы',s.explorerSort)}${opt('id','По ID диалога',s.explorerSort)}</select></div>
    ${selected.size?html`<p class="selection-context" role="status">Выбрано ${selected.size}${hiddenSelection?` · вне текущей страницы: ${hiddenSelection}`:''}. Оценка применяется ко всем выбранным диалогам.</p>`:''}
    ${rows.length
      ? html`<ul class="conv-list" aria-label="Список диалогов">${visible.map((r) => cardView(s, r, selected, busy))}</ul>`
      : html`<div class="card">${emptyState('search', 'Ничего не найдено', 'Нет диалогов под эти фильтры.',
          filtered ? html`<button type="button" data-action="filter-reset">Сбросить фильтры</button>` : '')}</div>`}
    ${pages>1?html`<nav class="pagination" aria-label="Страницы диалогов"><button type="button" data-action="explorer-page" data-page="${page-1}" ${attr('disabled',page===1)}>${icon('arrowLeft')}Назад</button><span>Страница ${page} из ${pages}</span><button type="button" data-action="explorer-page" data-page="${page+1}" ${attr('disabled',page===pages)}>Далее${icon('arrowRight')}</button></nav>`:''}`;
}

export const handlers = {
  submit: {
    async 'submission-export'(form) {
      const button=form.querySelector('button[type="submit"]'), status=form.parentElement.querySelector('[data-export-status]');
      if (button.disabled) return;
      const options=Object.fromEntries(new FormData(form));
      button.disabled=true; status.textContent='Проверяем полноту набора и доказательства…';
      try {
        const result=await api.exportResults(options);
        const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download='results.json';link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        const errors=result.results.filter(r=>r.status==='error').length;
        status.textContent=`Скачано ${result.results.length} записей. Ошибок: ${errors}. Сохраните файл в results/${options.split}/results.json и проверьте перед push.`;
      } catch(e) { status.textContent=e.message||'Экспорт не выполнен. Повторите позже.'; }
      finally { button.disabled=false; }
    },
    async 'dataset-import'(form) {
      if (store.get().importing || store.get().applying) return;
      const group = form.querySelector('[name="group_id"]').value.trim();
      if (!group) return;
      store.set({importing:true, datasetGroup:group});
      try {
        const result = await api.importDataset(group);
        const url = new URL(location.href); url.searchParams.set('group', result.group_id || group); history.replaceState(null,'',url);
        await loadAll();
        updateFilters(FILTER_DEFAULTS);
        store.set({selectedConversations:[], batchSummary:null});
        toast(`Группа ${group}: загружено ${result.imported} из ${result.total}; пропущено ${result.skipped}`, 'ok');
      } catch (e) { toast(e.message, 'rd'); }
      finally { store.set({importing:false}); }
    },
  },
  input: {
    filter(el) { updateFilters({[el.dataset.key]:el.value}); },
  },
  change: {
    'explorer-sort'(el) { history.replaceState(null,'',explorerHref(store.get().filters,el.value)); store.set({explorerSort:el.value,explorerPage:1}); },
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
      const sorted = sortRows(rowsFor(s).filter(r=>matchesRow(s.filters,r)),s.explorerSort);
      const page = Math.min(Math.max(1,s.explorerPage||1),Math.max(1,Math.ceil(sorted.length/PAGE_SIZE)));
      sorted.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).forEach((r) => {
        if (el.checked) selected.add(r.conv.conversation_id); else selected.delete(r.conv.conversation_id);
      });
      store.set({selectedConversations:[...selected]});
    },
    filter(el) { updateFilters({[el.dataset.key]:el.value}); },
  },
  click: {
    'selection-clear'() { if (!store.get().applying) store.set({selectedConversations:[]}); },
    'evaluate-selected'() { return evaluateSelection(false); },
    'evaluate-all'() { return evaluateSelection(true); },
    'filter-reset'() { updateFilters(FILTER_DEFAULTS); },
    'filter-remove'(el) { updateFilters({[el.dataset.key]:''}); },
    'explorer-page'(el) { store.set({explorerPage:Number(el.dataset.page)}); document.querySelector('.explorer-toolbar')?.scrollIntoView({block:'start'}); },
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
