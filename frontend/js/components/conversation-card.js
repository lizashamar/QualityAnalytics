// Карточка диалога: транскрипт слева, оценка справа, запуск оценки выбранным чек-листом.

import { html, attr } from '../html.js';
import { store } from '../store.js';
import { LANG, CHANNEL, latestEvaluation, activeChecklist, checklistLabel } from '../results.js';
import { transcriptView } from './transcript.js';
import { scorePanelView } from './score-panel.js';
import { runEvaluation, toast, fail } from '../actions.js';

export function view(s) {
  const id = s.route.params.id;
  const conv = s.conversations.find((c) => c.conversation_id === id);
  if (!conv) {
    return html`<a href="#/conversations" class="back">← К списку</a><h2>Диалог не найден</h2><p class="mu">Нет диалога с ID «${id}».</p>`;
  }
  const ev = latestEvaluation(s, id);
  const running = !!s.running[id];
  const active = activeChecklist(s);
  const selected = s.cardChecklistId && s.checklists.some((c) => c.id === s.cardChecklistId) ? s.cardChecklistId : active && active.id;
  const versions = [...s.checklists].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);

  return html`
    <a href="#/conversations" class="back">← К списку диалогов</a>
    <div class="row sp head">
      <div>
        <h2>${conv.conversation_id}</h2>
        <p class="sub"><span class="b ne">${LANG[conv.language] || conv.language} · ${conv.language}</span>
          <span class="b ne">${CHANNEL[conv.channel] || conv.channel}</span>
          <span class="mu">${conv.transcript.length} реплик</span></p>
      </div>
      <div class="row run" role="group" aria-label="Запуск оценки">
        <label for="card-cl" class="inline">Чек-лист</label>
        <select id="card-cl" data-change="card-checklist">
          ${versions.map((c) => html`<option value="${c.id}" ${attr('selected', c.id === selected)}>${checklistLabel(c)}${c.active ? ' (активная)' : ''}</option>`)}
        </select>
        <button type="button" class="p" data-action="evaluate" data-id="${id}" ${attr('disabled', running)} aria-busy="${running}">
          ${running ? 'Оцениваем…' : ev ? 'Переоценить' : 'Оценить'}</button>
      </div>
    </div>
    <div class="split">
      <section class="card" aria-labelledby="tr-h"><h3 id="tr-h">Транскрипт</h3>
        <p class="mu small legend"><span class="sw client"></span>клиент <span class="sw operator"></span>оператор <span class="sw bot"></span>бот / система — контекст</p>
        ${transcriptView(conv, { highlight: s.highlight })}
      </section>
      <div class="col">
        ${running ? html`<section class="card" aria-live="polite"><h3>Оценка выполняется…</h3><div class="bar"><i class="run-bar"></i></div>
          <p class="mu">Применяем чек-лист «${checklistLabel(s.checklists.find((c) => c.id === selected))}».</p></section>` : ''}
        ${ev ? scorePanelView(s, conv, ev) : !running ? html`<section class="card"><h3>Ещё не оценён</h3>
          <p class="mu">Выберите чек-лист и нажмите «Оценить», чтобы увидеть баллы, объяснения и доказательства.</p></section>` : ''}
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
