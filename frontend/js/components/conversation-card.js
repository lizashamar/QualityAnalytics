// Карточка диалога: транскрипт слева, оценка справа, запуск оценки выбранным чек-листом.

import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { LANG, CHANNEL, latestEvaluation, activeChecklist, checklistLabel, versionTrail, trailView } from '../results.js';
import { transcriptView } from './transcript.js';
import { scorePanelView } from './score-panel.js';
import { emptyState, skeleton } from './ui.js';
import { runEvaluation, toast, fail } from '../actions.js';

export function view(s) {
  const id = s.route.params.id;
  const conv = s.conversations.find((c) => c.conversation_id === id);
  if (!conv) {
    return html`<a href="#/conversations" class="back">${icon('arrowLeft')}К списку диалогов</a>
      <h2>Диалог не найден</h2>${emptyState('inbox', 'Нет такого диалога', `ID «${id}» отсутствует в наборе.`)}`;
  }
  const ev = latestEvaluation(s, id);
  const running = !!s.running[id];
  const active = activeChecklist(s);
  const selected = s.cardChecklistId && s.checklists.some((c) => c.id === s.cardChecklistId) ? s.cardChecklistId : active && active.id;
  const versions = [...s.checklists].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
  const isCall = conv.channel === 'voice call';

  return html`
    <a href="#/conversations" class="back">${icon('arrowLeft')}К списку диалогов</a>
    <div class="page-head">
      <div>
        <h2>${conv.conversation_id}</h2>
        <div class="badges">
          <span class="b ne">${LANG[conv.language] || conv.language} · ${conv.language}</span>
          <span class="b ne">${icon(isCall ? 'phone' : 'chat')}<span>${CHANNEL[conv.channel] || conv.channel}</span></span>
          <span class="b ne">${conv.transcript.length} реплик</span>
          ${(() => { const t = versionTrail(s, id); return t ? html`${trailView(t)}<a class="small" href="#/checklists/compare/${encodeURIComponent(t.from.checklist_id)}/${encodeURIComponent(t.to.checklist_id)}">сравнить версии</a>` : ''; })()}
        </div>
      </div>
      <div class="run" role="group" aria-label="Запуск оценки">
        <label for="card-cl">Чек-лист</label>
        <select id="card-cl" data-change="card-checklist">
          ${versions.map((c) => html`<option value="${c.id}" ${attr('selected', c.id === selected)}>${checklistLabel(c)}${c.active ? ' (активная)' : ''}</option>`)}
        </select>
        <button type="button" class="p" data-action="evaluate" data-id="${id}" ${attr('disabled', running)} aria-busy="${running}">
          ${icon(ev ? 'refresh' : 'sparkle')}${running ? 'Оцениваем…' : ev ? 'Переоценить' : 'Оценить'}</button>
      </div>
    </div>
    <div class="split">
      <section class="card transcript-card" aria-labelledby="tr-h">
        <div class="card-head"><h3 id="tr-h">Транскрипт</h3>
          <p class="legend"><span class="sw client"></span>клиент <span class="sw operator"></span>оператор <span class="sw bot"></span>бот и система</p></div>
        ${transcriptView(conv, { highlight: s.highlight })}
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
  change: {
    'card-checklist'(el) { store.set({ cardChecklistId: el.value }); },
  },
  click: {
    async evaluate(el) {
      const id = el.dataset.id;
      const clId = document.getElementById('card-cl')?.value;
      try {
        const ev = await runEvaluation(id, clId);
        store.set({ highlight: { indices: [], range: null } });
        toast(`Оценка готова: ${ev.total === null ? 'итог не рассчитывается' : ev.total}`, 'ok');
      } catch (e) { fail(e); }
    },
  },
};
