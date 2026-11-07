// Обзор: сводка по последним оценкам (финальный результат с учётом апелляций).

import { html } from '../html.js';
import { icon } from '../icons.js';
import { LANG, activeChecklist, checklistLabel, fmtScore } from '../results.js';
import { rowsFor } from './conversations-list.js';
import { meter, scoreRing, emptyState } from './ui.js';
import { resetDemo, toast, fail } from '../actions.js';

export function view(s) {
  const rows = rowsFor(s);
  const done = rows.filter((r) => r.R);
  const totals = done.map((r) => r.R.final.total).filter((t) => t !== null);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const flags = done.filter((r) => r.R.final.gross_flag).length;
  const pending = s.appeals.filter((a) => a.status === 'pending').length;
  const act = activeChecklist(s);

  const sec = {};
  for (const r of done) for (const x of r.R.final.sections || []) {
    if (!(x.max > 0)) continue;
    (sec[x.section] = sec[x.section] || []).push(x.percent);
  }

  return html`
    <div class="page-head"><div><h2>Обзор</h2>
      <p class="sub">Активный чек-лист: <b>${checklistLabel(act)}</b> · ${act ? act.criteria.length : 0} критериев</p></div></div>
    <div class="kpis">
      <div class="card kpi"><span class="kpi-l">${icon('check')}Оценено</span><b class="big">${done.length}<span class="unit"> / ${rows.length}</span></b></div>
      <div class="card kpi kpi-ring">${scoreRing(avg, { key: 'overview-avg', size: 'sm', label: 'Средний итог' })}<div><span class="kpi-l">Средний итог</span><b class="big">${fmtScore(avg)}</b></div></div>
      <div class="card kpi"><span class="kpi-l">${icon('flag')}Грубые нарушения</span><b class="big ${flags ? 't-rd' : ''}">${flags}</b></div>
      <div class="card kpi"><span class="kpi-l">${icon('clock')}Апелляции на рассмотрении</span><b class="big ${pending ? 't-wn' : ''}">${pending}</b>
        ${pending ? html`<a href="#/appeals">Открыть очередь ${icon('arrowRight')}</a>` : ''}</div>
    </div>
    <div class="grid2 mt">
      <section class="card"><h3>Итог по диалогам</h3>
        ${done.length ? html`<ul class="bars">${done.map((r) => html`<li>
          <a href="#/conversations/${encodeURIComponent(r.conv.conversation_id)}" class="bar-name">${r.conv.conversation_id}</a>
          ${meter(r.R.final.total, { label: r.conv.conversation_id, hint: `Итог ${fmtScore(r.R.final.total)}` })}
          <b class="bar-val">${fmtScore(r.R.final.total)}</b>${r.R.final.gross_flag ? html`<span class="b rd" title="Грубое нарушение">${icon('flag')}<span class="sr">грубое нарушение</span></span>` : ''}</li>`)}</ul>`
          : emptyState('sparkle', 'Пока нет оценённых диалогов', 'Откройте диалог и нажмите «Оценить».')}
      </section>
      <section class="card"><h3>Средний процент по секциям</h3>
        <ul class="bars">${Object.entries(sec).map(([name, list]) => {
          const p = list.reduce((a, b) => a + b, 0) / list.length;
          return html`<li class="wide"><span class="bar-name">${name}</span>${meter(p, { label: name, hint: `${fmtScore(p)}% в среднем` })}<b class="bar-val">${fmtScore(p)}%</b></li>`;
        })}</ul>
        <h3 class="mt">Языки</h3>
        <ul class="bars">${Object.keys(LANG).map((l) => {
          const n = rows.filter((r) => r.conv.language === l).length;
          return html`<li><span class="bar-name">${LANG[l]}</span><div class="meter t-brand"><i style="width:${rows.length ? (n / rows.length) * 100 : 0}%"></i></div><b class="bar-val">${n}</b></li>`;
        })}</ul>
      </section>
    </div>
    ${s.config.USE_MOCK ? html`<section class="card mt"><h3>Демо-режим</h3>
      <p class="hint">Бэкенд не подключён: данные и оценки симулируются и хранятся в этом браузере (localStorage).
      Подключение: <code>?api=https://host/api</code> или <code>window.CQA_CONFIG</code>.</p>
      <button type="button" class="d" data-action="reset-demo">${icon('trash')}Сбросить демо-данные</button></section>` : ''}`;
}

export const handlers = {
  click: {
    async 'reset-demo'() {
      if (!window.confirm('Сбросить все демо-данные (оценки, апелляции, версии чек-листа)?')) return;
      try { await resetDemo(); toast('Демо-данные сброшены'); } catch (e) { fail(e); }
    },
  },
};
