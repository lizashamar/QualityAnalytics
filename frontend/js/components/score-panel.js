import { html } from '../html.js';
import { offsets, fmtOffset } from './transcript.js';
import { icon } from '../icons.js';
import {
  finalResult, criterionOf, answerBadge, answerText, fmtScore, fmtPts, scoreTone,
  checklistLabel, activeChecklist, latestEvaluation, fmtDate, replicaNo,
} from '../results.js';
import { scoreRing, meter } from './ui.js';

function evidenceLinks(item, conv) {
  const times = offsets(conv.transcript || []);
  const ev = item.evidence || [];
  const parts = [];
  if (ev.length) {
    parts.push(html`<span class="evid-label">Доказательства</span>
      ${ev.map((i) => html`<button type="button" class="chip" data-action="jump" data-indices="${i}" aria-label="Показать реплику ${replicaNo(i)}">${icon('quote')}реплика ${replicaNo(i)}${conv.audio_url && times[i] != null ? ` · ${fmtOffset(times[i])}` : ''}</button>`)}
      ${ev.length > 1 ? html`<button type="button" class="chip ghost" data-action="jump" data-indices="${ev.join(',')}">все</button>` : ''}`);
  }
  if (item.checked_range) {
    const [a, b] = item.checked_range;
    parts.push(html`<button type="button" class="chip range" data-action="jump" data-indices="" data-from="${a}" data-to="${b}">${icon('range')}Проверенный участок: реплики ${replicaNo(a)}–${replicaNo(b)}</button>`);
  }
  const quotes = (item.evidence_quotes || []).map((q) => html`<blockquote class="small">#${replicaNo(q.index)} · ${(conv.transcript || [])[q.index]?.speaker || ''}: «${q.quote}»</blockquote>`);
  return parts.length ? html`<div class="evid">${parts}</div>${quotes}` : '';
}

function weightInfo(c, origRow) {
  if (!c) return '';
  if (c.is_flag) return html`<span class="weight">флаг, без баллов</span>`;
  if (!origRow || !origRow.applicable) return html`<span class="weight">вес ${c.weight} · исключён (N/A)</span>`;
  const eff = origRow.effective_weight;
  return html`<span class="weight">вес ${c.weight}${Math.abs(eff - c.weight) > 0.005 ? html` → ${fmtPts(eff)} после перераспределения` : ''}</span>`;
}

function pointsText(c, row) {
  if (!c || c.is_flag || !row || !row.applicable) return '';
  return html`<span class="pts"><b>${fmtPts(row.points)}</b><span> / ${fmtPts(row.effective_weight)}</span></span>`;
}

function itemView(item, c, R, conv, allowAppeal = true) {
  const cid = item.criterion_id;
  const origRow = R.originalCalc.rows.find((r) => r.criterion_id === cid);
  const finRow = R.final.rows.find((r) => r.criterion_id === cid);
  const dec = R.decisions[cid];
  const pend = R.pending[cid];
  const origPtsRow = origRow ? { ...origRow, points: item.points } : null; // баллы — как пришли
  return html`<article class="crit${c && c.is_flag ? ' is-flag' : ''}" id="crit-${cid}" aria-labelledby="crit-h-${cid}">
    <div class="crit-head">
      <div class="crit-title"><h4 id="crit-h-${cid}">${c ? c.title : cid}</h4>${weightInfo(c, dec ? finRow : origRow)}</div>
      <div class="ans">${answerBadge(c, dec ? dec.resolution.new_answer : item.answer)} ${pointsText(c, dec ? finRow : origPtsRow)}</div>
    </div>
    ${c && c.question ? html`<details class="criterion-rule"><summary>Правило оценки ${icon('down')}</summary><div><p class="q">${c.question}</p></div></details>` : ''}
    ${dec?html`<p class="hint">Обоснование исходной оценки</p>`:''}<p class="expl">${item.explanation}</p>
    ${R.finalAnswers[cid] === 'na' ? html`<p class="na">${icon('info')}<span><b>Почему N/A:</b> ${dec?.resolution.reason || item.na_reason || '—'}</span></p>` : ''}
    ${evidenceLinks(item, conv)}
    ${dec ? html`<ol class="layers" aria-label="История оценки по критерию">
      <li><span class="lbl">Исходная оценка</span>${answerBadge(c, item.answer)} ${pointsText(c, origPtsRow)}</li>
      <li><span class="lbl">Решение проверяющего</span>${answerBadge(c, dec.resolution.new_answer)}
        <span class="reason">«${dec.resolution.reason}»</span> <span class="hint">${fmtDate(dec.resolution.resolved_at)} · ${dec.id}</span>
        <span class="hint">Апелляция: «${dec.comment}»</span></li>
      <li><span class="lbl">Финальный результат</span>${answerBadge(c, dec.resolution.new_answer)} ${pointsText(c, finRow)}</li>
    </ol>` : ''}
    <div class="crit-foot">
      ${pend
        ? html`<a class="b wn" href="#/appeals/${pend.id}">${icon('clock')}<span>Апелляция ${pend.id} на рассмотрении</span></a>`
        : allowAppeal ? html`<button type="button" class="btn-sm" data-action="appeal-open" data-criterion="${cid}" aria-label="Оспорить оценку по критерию «${c ? c.title : cid}»">${icon('scale')}Оспорить</button>` : ''}
    </div>
  </article>`;
}

function sectionsView(sections, finalSections, changed, R) {
  return html`<div class="sections">${sections.map((s) => {
    const f = (finalSections || []).find((x) => x.section === s.section) || s;
    // Флаг секции — по финальным ответам на флаговые критерии (поле gross_flag в sections есть не у всех источников).
    const sectionFlag = R.criteria.some((c) => c.section === s.section && c.is_flag && R.finalAnswers[c.id] === 'yes');
    const pct = f.percent;
    const moved = changed && f.max > 0 && Math.abs(f.points - s.points) > 0.004;
    const hint = f.max > 0 ? `${fmtPts(f.points)} из ${fmtPts(f.max)} баллов после перераспределения весов N/A` : 'Секция без баллов (флаг грубого нарушения)';
    return html`<div class="sec">
      <div class="sec-head"><span class="sec-name">${s.section}</span>
        ${f.max > 0
          ? html`<span class="sec-val"><b class="t-${scoreTone(pct)}">${fmtScore(pct)}%</b><span>${fmtPts(f.points)} / ${fmtPts(f.max)}</span>${moved ? html`<span class="was">было ${fmtPts(s.points)}</span>` : ''}</span>`
          : html`<span class="sec-val">${sectionFlag ? html`<span class="b rd">${icon('alert')}<span>выявлено</span></span>` : html`<span class="b ok">${icon('check')}<span>не выявлено</span></span>`}</span>`}</div>
      ${f.max > 0 ? meter(pct, { label: s.section, hint }) : ''}
    </div>`;
  })}</div>`;
}

function grossBanner(R, ev) {
  const flagItems = ev.items.filter((i) => {
    const c = criterionOf(R.checklist, i.criterion_id);
    const a = R.finalAnswers[i.criterion_id];
    return c && c.is_flag && a === 'yes';
  });
  return html`<section class="gross" role="alert" aria-labelledby="gross-h">
    <div class="gross-icon">${icon('alert', 'ic-lg')}</div>
    <div class="gross-body"><h3 id="gross-h">Выявлено грубое нарушение</h3>
      ${flagItems.map((i) => {
        const c = criterionOf(R.checklist, i.criterion_id);
        return html`<p><b>${c.title}.</b> ${R.decisions[i.criterion_id]?.resolution.reason || i.explanation}</p>
          ${(i.evidence || []).length ? html`<div class="evid">${i.evidence.map((x) => html`<button type="button" class="chip on-danger" data-action="jump" data-indices="${x}">${icon('quote')}реплика ${replicaNo(x)}</button>`)}</div>` : ''}`;
      })}
      <p class="gross-note">Флаг не обнуляет итоговый балл и учитывается отдельно.</p></div>
  </section>`;
}

export function scorePanelView(s, conv, ev) {
  if (ev.stale || ev.status === 'error') return html`<section class="card" role="alert"><h3>${ev.stale?'Диалог изменился — нужна переоценка':'Оценка не выполнена'}</h3><p>${ev.stale?'Сохранённый результат относится к другой версии транскрипта. Он исключён из аналитики и экспорта успешных оценок.':ev.error||'Не удалось получить обоснованные ответы по всем критериям.'}</p><p class="hint">Выберите чек-лист и нажмите «Переоценить». Ошибка обработки не считается нулевым баллом.</p></section>`;
  const R = finalResult(s, ev);
  const allowAppeal=latestEvaluation(s,conv.conversation_id)?.id===ev.id;
  const active = activeChecklist(s);
  const W = R.criteria.filter(c=>!c.is_flag&&R.finalAnswers[c.id]!=='na').reduce((sum,c)=>sum+Number(c.weight||0),0);
  const naCount = ev.items.filter(i=>R.finalAnswers[i.criterion_id]==='na').length;
  const missing = !R.checklist;

  const groups = [];
  const used = new Set();
  for (const c of R.criteria) {
    const item = ev.items.find((i) => i.criterion_id === c.id);
    if (!item) continue;
    used.add(item.criterion_id);
    let g = groups.find((x) => x.section === c.section);
    if (!g) groups.push((g = { section: c.section, items: [] }));
    g.items.push([item, c]);
  }
  const needsAttention = item => {
    const c=criterionOf(R.checklist,item.criterion_id), row=R.final.rows.find(r=>r.criterion_id===item.criterion_id);
    return c?.is_flag ? R.finalAnswers[c.id]==='yes' : row?.applicable && row.points < row.effective_weight;
  };
  const issueCount=ev.items.filter(needsAttention).length;
  const orphan = ev.items.filter((i) => !used.has(i.criterion_id));
  if (orphan.length) groups.push({ section: 'Без критерия в чек-листе', items: orphan.map((i) => [i, null]) });

  const step = (label, value, flag, extra = '') => html`<li class="step t-${scoreTone(value)}">
    <span class="step-lbl">${label}</span><b class="big">${fmtScore(value)}</b>${flag ? html`<span class="b rd" title="Грубое нарушение">${icon('alert')}<span><span class="sr">грубое </span>нарушение</span></span>` : ''}${extra}</li>`;

  return html`
    ${R.final.gross_flag ? grossBanner(R, ev) : ''}
    <section class="card hero" aria-labelledby="total-h">
      ${scoreRing(R.final.total, { key: ev.id })}
      <div class="hero-body">
        <h3 id="total-h">${R.changed ? 'Финальный результат' : 'Итоговый балл'}</h3>
        ${R.final.total === null ? html`<p class="big">не рассчитывается</p>` : ''}
        <p class="hint">Чек-лист: ${checklistLabel(R.checklist)}${active && R.checklist && active.id !== R.checklist.id ? html` <span class="b wn">${icon('info')}<span>активна ${checklistLabel(active)}</span></span>` : ''}</p>
        <p class="hint">Оценка ${ev.id} от ${fmtDate(ev.created_at)}</p>
        <p class="hint">${naCount ? `N/A: ${naCount} — исключены; веса применимых критериев (сумма ${W}) пересчитаны до 100.` : 'Все критерии применимы.'}</p>
        ${!R.final.gross_flag ? html`<span class="b ok big-b">${icon('check')}<span>Грубых нарушений нет</span></span>` : html`<span class="big-b sr">Грубое нарушение выявлено</span>`}
      </div>
      ${R.hasDecisions ? html`<ol class="stepper total-layers" aria-label="Слои итоговой оценки">
        ${step('Исходная оценка', R.original.total, R.original.gross_flag)}
        <li class="step-arrow" aria-hidden="true">${icon('arrowRight')}</li>
        <li class="step decision"><span class="step-lbl">Решения проверяющего</span>${Object.values(R.decisions).map((d) => {
          const c = criterionOf(R.checklist, d.criterion_id);
          return html`<span class="change">${c ? c.title : d.criterion_id}: <s>${answerText(c, d.original_answer)}</s> ${icon('arrowRight')} <b>${answerText(c, d.resolution.new_answer)}</b></span>`;
        })}</li>
        <li class="step-arrow" aria-hidden="true">${icon('arrowRight')}</li>
        ${step('Финальный результат', R.final.total, R.final.gross_flag, R.changed && R.final.total !== null && R.original.total !== null ? html`<span class="delta">${R.final.total - R.original.total >= 0 ? '+' : ''}${fmtPts(R.final.total - R.original.total)}</span>` : '')}
      </ol>` : ''}
      ${ev.usage ? html`<p class="hint evaluation-cost">Модель: ${ev.usage.model || ev.model} ·
        Токены: ${ev.usage.input_tokens ?? 0} вход / ${ev.usage.output_tokens ?? 0} выход ·
        Примерная стоимость: <b>${typeof ev.usage.cost_usd === 'number' ? `$${ev.usage.cost_usd.toFixed(6)}` : 'не задана'}</b>
        ${ev.usage.provider === 'mock' ? ' · демо-оценка' : ''}</p>` : ''}
      ${(ev.warnings || []).length ? html`<div class="notice wn" role="alert">Проверьте результат: ${ev.warnings.join(' ')}</div>` : ''}
      ${missing ? html`<p class="b rd">Версия чек-листа ${ev.checklist_id} не найдена — пересчёт недоступен.</p>` : ''}
    </section>
    <section class="card" aria-labelledby="sec-h"><h3 id="sec-h">Баллы по секциям</h3>${sectionsView(R.original.sections || [], R.final.sections, R.changed, R)}</section>
    <section class="card" aria-labelledby="crit-h">
      <div class="card-head"><h3 id="crit-h">Критерии</h3>
        ${allowAppeal?html`<button type="button" class="btn-sm" data-action="appeal-open" data-criterion="">${icon('scale')}Оспорить оценку…</button>`:''}</div>
      ${!allowAppeal?html`<p class="hint">Материалы сохранённой оценки доступны для чтения. Новая апелляция доступна у последней оценки в загруженной группе.</p>`:''}
      <div class="seg criteria-filters" role="group" aria-label="Фильтр критериев"><button type="button" class="tab ${s.criteriaFilter!=='issues'?'on':''}" data-action="criteria-filter" data-filter="all" aria-pressed="${s.criteriaFilter!=='issues'}">Все (${ev.items.length})</button><button type="button" class="tab ${s.criteriaFilter==='issues'?'on':''}" data-action="criteria-filter" data-filter="issues" aria-pressed="${s.criteriaFilter==='issues'}">Требуют внимания (${issueCount})</button></div>
      ${groups.map(g=>{const items=g.items.filter(([i])=>s.criteriaFilter!=='issues'||needsAttention(i));return items.length?html`<h4 class="group">${g.section}</h4>${items.map(([i,c])=>itemView(i,c,R,conv,allowAppeal))}`:'';})}
      ${s.criteriaFilter==='issues'&&!issueCount?html`<p class="hint">Нет критериев с потерей баллов или грубыми нарушениями.</p>`:''}
    </section>`;
}
