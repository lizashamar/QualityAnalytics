// Панель оценки: показывает только то, что пришло в evaluation; итог после решений
// проверяющего пересчитывается через scoring.js. Критерии — из версии чек-листа оценки.

import { html } from '../html.js';
import {
  finalResult, criterionOf, answerBadge, answerText, scoreTone, fmtScore, fmtPts,
  checklistLabel, activeChecklist, fmtDate, replicaNo,
} from '../results.js';

function evidenceLinks(item) {
  const ev = item.evidence || [];
  const parts = [];
  if (ev.length) {
    parts.push(html`<span class="mu">Доказательства:</span> ${ev.map((i) => html`<button type="button" class="chip" data-action="jump" data-indices="${i}" aria-label="Показать реплику ${replicaNo(i)}">реплика ${replicaNo(i)}</button>`)}
      ${ev.length > 1 ? html`<button type="button" class="chip" data-action="jump" data-indices="${ev.join(',')}">все</button>` : ''}`);
  }
  if (item.checked_range) {
    const [a, b] = item.checked_range;
    parts.push(html`<button type="button" class="chip range" data-action="jump" data-indices="" data-from="${a}" data-to="${b}">Проверенный участок: реплики ${replicaNo(a)}–${replicaNo(b)}</button>`);
  }
  return parts.length ? html`<div class="row evid">${parts}</div>` : '';
}

function weightInfo(c, origRow) {
  if (!c) return '';
  if (c.is_flag) return html`<span class="mu">флаг, без баллов</span>`;
  if (!origRow || !origRow.applicable) return html`<span class="mu">вес ${c.weight} · исключён (N/A)</span>`;
  const eff = origRow.effective_weight;
  return html`<span class="mu">вес ${c.weight}${Math.abs(eff - c.weight) > 0.005 ? html` → ${fmtPts(eff)} после перераспределения` : ''}</span>`;
}

function pointsText(c, row) {
  if (!c || c.is_flag || !row || !row.applicable) return '';
  return html`<span class="pts"><b>${fmtPts(row.points)}</b><span class="mu"> / ${fmtPts(row.effective_weight)}</span></span>`;
}

function itemView(item, c, R) {
  const cid = item.criterion_id;
  const origRow = R.originalCalc.rows.find((r) => r.criterion_id === cid);
  const finRow = R.final.rows.find((r) => r.criterion_id === cid);
  const dec = R.decisions[cid];
  const pend = R.pending[cid];
  const origPtsRow = origRow ? { ...origRow, points: item.points } : null; // баллы — как пришли
  return html`<article class="crit" id="crit-${cid}" aria-labelledby="crit-h-${cid}">
    <div class="crit-head">
      <div><h4 id="crit-h-${cid}">${c ? c.title : cid}</h4>${weightInfo(c, origRow)}</div>
      <div class="ans">${answerBadge(c, dec ? dec.resolution.new_answer : item.answer)} ${pointsText(c, dec ? finRow : origPtsRow)}</div>
    </div>
    ${c && c.question ? html`<p class="q">${c.question}</p>` : ''}
    <p class="expl">${item.explanation}</p>
    ${item.answer === 'na' ? html`<p class="na"><b>Почему N/A:</b> ${item.na_reason || '—'}</p>` : ''}
    ${evidenceLinks(item)}
    ${dec ? html`<ol class="layers" aria-label="История оценки по критерию">
      <li><span class="lbl">Исходная оценка</span>${answerBadge(c, item.answer)} ${pointsText(c, origPtsRow)}</li>
      <li><span class="lbl">Решение проверяющего</span>${answerBadge(c, dec.resolution.new_answer)}
        <span class="reason">«${dec.resolution.reason}»</span> <span class="mu small">${fmtDate(dec.resolution.resolved_at)} · ${dec.id}</span>
        <span class="mu small">Апелляция: «${dec.comment}»</span></li>
      <li><span class="lbl">Финальный результат</span>${answerBadge(c, dec.resolution.new_answer)} ${pointsText(c, finRow)}</li>
    </ol>` : ''}
    <div class="row">
      ${pend
        ? html`<a class="b wn" href="#/appeals/${pend.id}">⏳ Апелляция ${pend.id} на рассмотрении</a>`
        : html`<button type="button" data-action="appeal-open" data-criterion="${cid}" aria-label="Оспорить оценку по критерию «${c ? c.title : cid}»">Оспорить</button>`}
    </div>
  </article>`;
}

function sectionsView(sections, finalSections, changed) {
  return html`<div class="sections">${sections.map((s) => {
    const f = (finalSections || []).find((x) => x.section === s.section) || s;
    const pct = f.percent;
    return html`<div class="sec">
      <div class="row sp"><span>${s.section}</span>
        <span>${f.max > 0 ? html`<b>${fmtPts(f.points)}</b><span class="mu"> / ${fmtPts(f.max)} · ${fmtScore(pct)}%</span>` : html`<span class="mu">без баллов</span>`}
        ${changed && f.max > 0 && Math.abs(f.points - s.points) > 0.004 ? html` <span class="mu small">(было ${fmtPts(s.points)})</span>` : ''}</span></div>
      ${f.max > 0 ? html`<div class="bar" role="img" aria-label="${s.section}: ${fmtScore(pct)}%"><i class="${scoreTone(pct)}" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>` : ''}
    </div>`;
  })}</div>`;
}

export function scorePanelView(s, conv, ev) {
  const R = finalResult(s, ev);
  const active = activeChecklist(s);
  const W = R.originalCalc.applicable_weight;
  const naCount = ev.items.filter((i) => i.answer === 'na').length;
  const missing = !R.checklist;

  // Группировка по секциям в порядке критериев версии чек-листа.
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
  const orphan = ev.items.filter((i) => !used.has(i.criterion_id));
  if (orphan.length) groups.push({ section: 'Без критерия в чек-листе', items: orphan.map((i) => [i, null]) });

  return html`
    <section class="card" aria-labelledby="total-h">
      <div class="row sp top">
        <div>
          <h3 id="total-h" class="mu">${R.changed ? 'Финальный результат' : 'Итог'}</h3>
          <div class="big">${R.final.total === null ? html`<span class="mu">не рассчитывается</span>` : html`${fmtScore(R.final.total)}<span class="mu unit"> / 100</span>`}</div>
        </div>
        ${R.final.gross_flag
          ? html`<span class="b rd big-b">⚠ Грубое нарушение выявлено</span>`
          : html`<span class="b ok big-b">✓ Грубых нарушений нет</span>`}
      </div>
      ${R.hasDecisions ? html`<ol class="layers total-layers" aria-label="Слои итоговой оценки">
        <li><span class="lbl">Исходная оценка</span><b>${fmtScore(R.original.total)}</b>${R.original.gross_flag ? ' · грубое нарушение' : ''}</li>
        <li><span class="lbl">Решения проверяющего</span>${Object.values(R.decisions).map((d) => {
          const c = criterionOf(R.checklist, d.criterion_id);
          return html`<span class="mu">${c ? c.title : d.criterion_id}: ${answerText(c, d.original_answer)} → ${answerText(c, d.resolution.new_answer)}</span>`;
        })}</li>
        <li><span class="lbl">Финальный результат</span><b>${fmtScore(R.final.total)}</b>${R.final.gross_flag ? ' · грубое нарушение' : ''}</li>
      </ol>` : ''}
      <p class="mu small">
        Чек-лист: ${checklistLabel(R.checklist)}${active && R.checklist && active.id !== R.checklist.id ? html` <span class="b wn">активна ${checklistLabel(active)}</span>` : ''}
        · оценка ${ev.id} от ${fmtDate(ev.created_at)}<br>
        ${naCount ? `N/A: ${naCount} — исключены; веса применимых критериев (сумма ${W}) пересчитаны до 100.` : 'Все критерии применимы.'}
      </p>
      ${missing ? html`<p class="b rd">Версия чек-листа ${ev.checklist_id} не найдена — пересчёт недоступен.</p>` : ''}
    </section>
    <section class="card" aria-labelledby="sec-h"><h3 id="sec-h">Баллы по секциям</h3>${sectionsView(R.original.sections || [], R.final.sections, R.changed)}</section>
    <section class="card" aria-labelledby="crit-h">
      <div class="row sp"><h3 id="crit-h">Критерии</h3>
        <button type="button" data-action="appeal-open" data-criterion="">Оспорить оценку…</button></div>
      ${groups.map((g) => html`<h4 class="group">${g.section}</h4>${g.items.map(([i, c]) => itemView(i, c, R))}`)}
    </section>`;
}
