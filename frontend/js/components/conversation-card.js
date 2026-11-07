import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { LANG, CHANNEL, latestEvaluation, activeChecklist, checklistLabel, versionTrail, trailView } from '../results.js';
import { transcriptView } from './transcript.js';
import { scorePanelView } from './score-panel.js';
import { rowsFor } from './conversations-list.js';
import { explorerHref, matchesRow, sortRows } from '../design/explorer.js';
import { emptyState, skeleton } from './ui.js';
import { runEvaluation, toast, fail } from '../actions.js';

export function view(s) {
  const id = s.route.params.id;
  const conv = s.conversations.find((c) => c.conversation_id === id) || s.reviewConversations?.[id];
  const backHref = explorerHref(s.filters,s.explorerSort);
  if (!conv) {
    return html`<a href="${backHref}" class="back">${icon('arrowLeft')}К списку диалогов</a>
      <h2>Диалог не найден</h2>${emptyState('inbox', 'Нет такого диалога', `ID «${id}» отсутствует в наборе.`)}`;
  }
  const ev = latestEvaluation(s, id) || Object.values(s.evaluations).filter(e=>e.conversation_id===id).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  const external = !s.conversations.some(c=>c.conversation_id===id);
  const busy = !!s.applying || !!s.importing || Object.keys(s.running||{}).length>0;
  const running = !!s.running[id];
  const context=sortRows(rowsFor(s).filter(r=>matchesRow(s.filters,r)),s.explorerSort);
  const index=context.findIndex(r=>r.conv.conversation_id===id);
  const sibling=(offset,label,ic)=>{const row=index>=0&&context[index+offset];return row?html`<a class="btn" href="#/conversations/${encodeURIComponent(row.conv.conversation_id)}" aria-label="${label}: ${row.conv.conversation_id}" title="${label}: ${row.conv.conversation_id}">${icon(ic)}<span>${label}</span></a>`:'';};
  const active = activeChecklist(s);
  const selected = s.cardChecklistId && s.checklists.some((c) => c.id === s.cardChecklistId) ? s.cardChecklistId : active && active.id;
  const versions = [...s.checklists].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
  const isCall = conv.channel === 'voice call';

  return html`
    <div class="conversation-navigation"><a href="${backHref}" class="back">${icon('arrowLeft')}К списку диалогов</a><nav class="row" aria-label="Диалоги текущей выборки">${sibling(-1,'Предыдущий','arrowLeft')}${index>=0?html`<span class="hint">${index+1} из ${context.length}</span>`:''}${sibling(1,'Следующий','arrowRight')}</nav></div>
    <div class="page-head">
      <div>
        <h2>${conv.conversation_id}</h2>
        <div class="badges">
          <span class="b ne">${conv.languages?.length?conv.languages.join(' + '):`${LANG[conv.language]||conv.language} · ${conv.language}`}</span>${conv.synthetic?html`<span class="b ne">Синтетический сценарий</span>`:''}
          <span class="b ne">${icon(isCall ? 'phone' : 'chat')}<span>${CHANNEL[conv.channel] || conv.channel}</span></span>
          <span class="b ne">${conv.transcript.length} реплик</span>
          ${(() => { const t = versionTrail(s, id); return t ? html`${trailView(t)}<a class="small" href="#/checklists/compare/${encodeURIComponent(t.from.checklist_id)}/${encodeURIComponent(t.to.checklist_id)}">сравнить версии</a>` : ''; })()}
        </div>
      </div>
      <div class="run" role="group" aria-label="Запуск оценки">
        <label for="card-cl">Чек-лист</label>
        <select id="card-cl" data-change="card-checklist" ${attr('disabled',busy||external)}>
          ${versions.map((c) => html`<option value="${c.id}" ${attr('selected', c.id === selected)}>${checklistLabel(c)}${c.active ? ' (активная)' : ''}</option>`)}
        </select>
        <button type="button" class="p" data-action="evaluate" data-id="${id}" ${attr('disabled', busy || !selected || external)} aria-busy="${running}">
          ${icon(ev ? 'refresh' : 'sparkle')}${running ? 'Оцениваем…' : ev ? 'Переоценить' : 'Оценить'}</button>
      </div>
    </div>
    ${external?html`<p class="notice">${icon('info')}Диалог открыт из материалов апелляции. Оценка относится к сохранённой версии; для новой оценки загрузите его группу.</p>`:''}
    ${s.applying?html`<p class="notice wn" role="status">${icon('clock')}Выполняется массовая оценка: ${s.applying.done} из ${s.applying.total}. Новую оценку можно запустить после завершения.</p>`:''}
    <div class="split">
      <section class="card transcript-card" aria-labelledby="tr-h">
        <div class="card-head"><h3 id="tr-h">Транскрипт</h3>
          <p class="legend"><span class="sw client"></span>клиент <span class="sw operator"></span>оператор <span class="sw bot"></span>бот и система</p></div>
        <div class="transcript-tools"><label class="sr" for="transcript-query">Поиск в транскрипте</label><div class="search">${icon('search')}<input id="transcript-query" type="search" value="${s.transcriptQuery||''}" data-input="transcript-query" placeholder="Найти в транскрипте"></div>${s.highlight.indices.length||s.highlight.range?html`<button type="button" class="ghost" data-action="highlight-clear">Снять подсветку</button>`:''}</div>
        ${transcriptView(conv, { highlight: s.highlight, query:s.transcriptQuery||'' })}
      </section>
      <div class="col">
        ${running ? html`<section class="card" aria-live="polite"><h3>Оценка выполняется…</h3><div class="progress"><i></i></div>
          <p class="hint">Применяем чек-лист «${checklistLabel(s.checklists.find((c) => c.id === selected))}».</p>${skeleton(4)}</section>` : ''}
        ${ev ? scorePanelView(s, conv, ev) : !running ? html`<section class="card">${emptyState('sparkle', 'Диалог ещё не оценён',
          'Выберите чек-лист и нажмите «Оценить», чтобы увидеть баллы, объяснения и доказательства.')}</section>` : ''}
      </div>
    </div>`;
}

export const handlers = {
  input: {'transcript-query'(el){store.set({transcriptQuery:el.value});}},
  change: {
    'card-checklist'(el) { store.set({ cardChecklistId: el.value }); },
  },
  click: {
    'highlight-clear'(){store.set({highlight:{indices:[],range:null}});},
    'criteria-filter'(el){store.set({criteriaFilter:el.dataset.filter});},
    async evaluate(el) {
      if(store.get().applying || store.get().importing || Object.keys(store.get().running||{}).length) return;
      const id = el.dataset.id;
      const clId = document.getElementById('card-cl')?.value;
      try {
        const ev = await runEvaluation(id, clId);
        if(store.get().route.name==='conversation'&&store.get().route.params.id===id) store.set({ highlight: { indices: [], range: null } });
        toast(`Оценка готова: ${ev.total === null ? 'итог не рассчитывается' : ev.total}`, 'ok');
      } catch (e) { fail(e); }
    },
  },
};
