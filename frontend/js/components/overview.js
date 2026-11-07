// Обзор: сводка по последним оценкам (финальный результат с учётом апелляций).

import { html } from '../html.js';
import { LANG, activeChecklist, checklistLabel, scoreTone, fmtScore } from '../results.js';
import { rowsFor } from './conversations-list.js';
import { resetDemo, toast, fail } from '../actions.js';

export function view(s) {
  const rows = rowsFor(s);
  const done = rows.filter((r) => r.R);
  const totals = done.map((r) => r.R.final.total).filter((t) => t !== null);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const flags = done.filter((r) => r.R.final.gross_flag).length;
  const pending = s.appeals.filter((a) => a.status === 'pending').length;
  const act = activeChecklist(s);

  // Средний процент по секциям (по последним оценкам).
  const sec = {};
  for (const r of done) for (const x of r.R.final.sections || []) {
    if (!(x.max > 0)) continue;
    (sec[x.section] = sec[x.section] || []).push(x.percent);
  }

  return html`
    <h2>Обзор</h2>
    <p class="sub">Активный чек-лист: <b>${checklistLabel(act)}</b> · ${act ? act.criteria.length : 0} критериев</p>
    <div class="grid g4">
      <div class="card"><div class="mu">Оценено</div><div class="big">${done.length}<span class="mu unit"> / ${rows.length}</span></div></div>
      <div class="card"><div class="mu">Средний итог</div><div class="big">${fmtScore(avg)}</div></div>
      <div class="card"><div class="mu">Грубые нарушения</div><div class="big ${flags ? 't-rd' : ''}">${flags}</div></div>
      <div class="card"><div class="mu">Апелляции на рассмотрении</div><div class="big ${pending ? 't-wn' : ''}">${pending}</div>
        ${pending ? html`<a href="#/appeals">Открыть очередь →</a>` : ''}</div>
    </div>
    <div class="grid g2 mt">
      <section class="card"><h3>Итог по диалогам</h3>
        ${done.map((r) => html`<div class="row sp bar-row">
          <a href="#/conversations/${encodeURIComponent(r.conv.conversation_id)}" class="w-id">${r.conv.conversation_id}</a>
          <div class="bar grow" role="img" aria-label="${r.conv.conversation_id}: ${fmtScore(r.R.final.total)}"><i class="${scoreTone(r.R.final.total)}" style="width:${r.R.final.total || 0}%"></i></div>
          <b>${fmtScore(r.R.final.total)}</b>${r.R.final.gross_flag ? html`<span class="b rd" title="Грубое нарушение">⚠</span>` : ''}</div>`)}
        ${done.length ? '' : html`<p class="mu">Пока нет оценённых диалогов.</p>`}
      </section>
      <section class="card"><h3>Средний процент по секциям</h3>
        ${Object.entries(sec).map(([name, list]) => {
          const p = list.reduce((a, b) => a + b, 0) / list.length;
          return html`<div class="bar-row"><div class="row sp"><span>${name}</span><b>${fmtScore(p)}%</b></div>
            <div class="bar" role="img" aria-label="${name}: ${fmtScore(p)}%"><i class="${scoreTone(p)}" style="width:${p}%"></i></div></div>`;
        })}
        <h3 class="mt">Языки</h3>
        ${Object.keys(LANG).map((l) => {
          const n = rows.filter((r) => r.conv.language === l).length;
          return html`<div class="row sp bar-row"><span class="w-id">${LANG[l]}</span><div class="bar grow"><i style="width:${rows.length ? (n / rows.length) * 100 : 0}%"></i></div><b>${n}</b></div>`;
        })}
      </section>
    </div>
    ${s.config.USE_MOCK ? html`<section class="card mt"><h3>Демо-режим</h3>
      <p class="mu">Бэкенд не подключён: данные и оценки симулируются и хранятся в этом браузере (localStorage).
      Подключение: <code>?api=https://host/api</code> или <code>window.CQA_CONFIG</code>.</p>
      <button type="button" class="d" data-action="reset-demo">Сбросить демо-данные</button></section>` : ''}`;
}

export const handlers = {
  click: {
    async 'reset-demo'() {
      if (!window.confirm('Сбросить все демо-данные (оценки, апелляции, версии чек-листа)?')) return;
      try { await resetDemo(); toast('Демо-данные сброшены'); } catch (e) { fail(e); }
    },
  },
};
