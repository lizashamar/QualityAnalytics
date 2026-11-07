// Апелляции: создание (модальное окно на карточке), очередь и экран проверяющего.
// Проверяющий выбирает новый ответ только из допустимых значений критерия и обязательно пишет причину.

import { html, attr } from '../html.js';
import { store } from '../store.js';
import { calculate, allowedAnswers, validAnswer } from '../scoring.js';
import {
  checklistById, criterionOf, answerBadge, answerText, finalResult, fmtScore, fmtPts,
  fmtDate, replicaNo, latestEvaluation,
} from '../results.js';
import { transcriptView } from './transcript.js';
import { createAppeal, resolveAppeal, toast, fail } from '../actions.js';

const STATUS = { pending: 'На рассмотрении', resolved: 'Рассмотрена', outdated: 'Устарела' };
const tone = (st) => (st === 'pending' ? 'wn' : st === 'outdated' ? 'ne' : 'ok');

// ---------- очередь ----------
export function listView(s) {
  const f = s.appealFilter;
  const list = s.appeals.filter((a) => f === 'all' || a.status === f)
    .sort((a, b) => (a.status === b.status ? Date.parse(b.created_at) - Date.parse(a.created_at) : a.status === 'pending' ? -1 : 1));
  const count = (st) => s.appeals.filter((a) => st === 'all' || a.status === st).length;
  const tab = (k, label) => html`<button type="button" role="tab" aria-selected="${f === k}" class="${f === k ? 'tab on' : 'tab'}" data-action="appeal-filter" data-f="${k}">${label} (${count(k)})</button>`;
  return html`
    <h2>Апелляции и пересмотр</h2>
    <p class="sub">Проверяющий подтверждает или меняет оспоренный ответ, итог пересчитывается автоматически.</p>
    <div class="row tabs" role="tablist" aria-label="Фильтр апелляций">${tab('pending', 'На рассмотрении')}${tab('resolved', 'Рассмотренные')}${tab('all', 'Все')}</div>
    <div class="card tw"><table>
      <caption class="sr">Очередь апелляций</caption>
      <thead><tr><th scope="col">Апелляция</th><th scope="col">Диалог</th><th scope="col">Критерий</th><th scope="col">Исходный ответ</th>
        <th scope="col">Комментарий</th><th scope="col">Статус</th><th scope="col">Решение</th><th scope="col"><span class="sr">Действие</span></th></tr></thead>
      <tbody>
      ${list.map((a) => {
        const c = criterionOf(checklistById(s, a.checklist_id), a.criterion_id);
        return html`<tr>
          <td><b>${a.id}</b><div class="mu small">${fmtDate(a.created_at)}</div></td>
          <td><a href="#/conversations/${encodeURIComponent(a.conversation_id)}">${a.conversation_id}</a></td>
          <td>${c ? c.title : a.criterion_id}</td>
          <td>${answerBadge(c, a.original_answer)}</td>
          <td class="clip">${a.comment}</td>
          <td><span class="b ${tone(a.status)}">${STATUS[a.status] || a.status}</span></td>
          <td>${a.resolution ? answerBadge(c, a.resolution.new_answer) : '—'}</td>
          <td><a class="btn ${a.status === 'pending' ? 'p' : ''}" href="#/appeals/${encodeURIComponent(a.id)}">${a.status === 'pending' ? 'Рассмотреть' : 'Открыть'}</a></td>
        </tr>`;
      })}
      ${list.length ? '' : html`<tr><td colspan="8" class="mu">Апелляций нет. Откройте оценку диалога и нажмите «Оспорить» у критерия.</td></tr>`}
      </tbody></table></div>`;
}

// ---------- экран проверяющего ----------
const encodeAns = (a) => (typeof a === 'number' ? `n:${a}` : String(a));
const decodeAns = (v) => (v.startsWith('n:') ? Number(v.slice(2)) : v);

export function reviewView(s) {
  const id = s.route.params.id;
  const ap = s.appeals.find((a) => a.id === id);
  if (!ap) return html`<a href="#/appeals" class="back">← К очереди</a><h2>Апелляция не найдена</h2>`;
  const ev = s.evaluations[ap.evaluation_id];
  const conv = s.conversations.find((c) => c.conversation_id === ap.conversation_id);
  if (!ev || !conv) return html`<a href="#/appeals" class="back">← К очереди</a><p class="mu">Загружаем оценку…</p>`;
  const cl = checklistById(s, ev.checklist_id);
  const c = criterionOf(cl, ap.criterion_id);
  const item = ev.items.find((i) => i.criterion_id === ap.criterion_id);
  const R = finalResult(s, ev);
  const latest = latestEvaluation(s, ev.conversation_id);
  const pending = ap.status === 'pending';
  const r = s.review && s.review.appealId === id ? s.review : { answer: ap.original_answer, reason: '' };

  // Пересчёт «что будет»: текущие финальные ответы + выбранный проверяющим.
  let preview = null;
  if (pending && cl && validAnswer(c, r.answer)) {
    preview = calculate(cl.criteria, { ...R.finalAnswers, [ap.criterion_id]: r.answer });
  }

  const marks = [...(item.evidence || []), ...(item.checked_range || [])];
  const from = marks.length ? Math.max(0, Math.min(...marks) - 2) : 0;
  const to = marks.length ? Math.max(...marks) + 2 : Infinity;
  const options = c ? allowedAnswers(c) : [];

  return html`
    <a href="#/appeals" class="back">← К очереди апелляций</a>
    <div class="row sp head"><div>
      <h2>Апелляция ${ap.id} <span class="b ${tone(ap.status)}">${STATUS[ap.status]}</span></h2>
      <p class="sub">Диалог <a href="#/conversations/${encodeURIComponent(conv.conversation_id)}">${conv.conversation_id}</a> · ${conv.language} · создана ${fmtDate(ap.created_at)}</p>
    </div></div>
    ${latest && latest.id !== ev.id ? html`<p class="b wn block">Диалог переоценён после подачи апелляции (новая оценка ${latest.id}). Решение применится к оценке ${ev.id}.</p>` : ''}
    <div class="split">
      <div class="col">
        <section class="card" aria-labelledby="orig-h">
          <h3 id="orig-h">Исходная оценка</h3>
          <h4>${c ? c.title : ap.criterion_id}</h4>
          ${c ? html`<p class="q">${c.question}</p>${c.allow_na ? html`<p class="q">${c.na_condition}</p>` : ''}` : ''}
          <div class="row">${answerBadge(c, item.answer)} ${!c || c.is_flag ? '' : html`<span class="mu">${fmtPts(item.points)} баллов</span>`}</div>
          <p class="expl">${item.explanation}</p>
          ${item.na_reason ? html`<p class="na"><b>Почему N/A:</b> ${item.na_reason}</p>` : ''}
          <p class="mu small">Доказательства: ${(item.evidence || []).length ? item.evidence.map((i) => `#${replicaNo(i)}`).join(', ') : 'нет'}
            ${item.checked_range ? ` · проверенный участок: реплики ${replicaNo(item.checked_range[0])}–${replicaNo(item.checked_range[1])}` : ''}</p>
          <p>Итог оценки сейчас: <b>${fmtScore(R.final.total)}</b>${R.changed ? html` <span class="mu">(исходный ${fmtScore(R.original.total)})</span>` : ''}</p>
        </section>
        <section class="card" aria-labelledby="cm-h"><h3 id="cm-h">Комментарий к апелляции</h3><blockquote>${ap.comment}</blockquote></section>
        ${pending ? html`<form class="card" data-submit="review" aria-labelledby="dec-h" novalidate>
          <h3 id="dec-h">Решение проверяющего</h3>
          <fieldset><legend>Новый ответ (только допустимые значения критерия)</legend>
            ${options.map((o) => html`<label class="opt"><input type="radio" name="answer" value="${encodeAns(o)}" data-change="review-answer" ${attr('checked', o === r.answer)}>
              ${answerBadge(c, o)} ${c && c.type === 'scale' && o !== 'na' && c.scale_labels && c.scale_labels[o] ? html`<span class="mu">${c.scale_labels[o]}</span>` : ''}
              ${o === 'na' ? html`<span class="mu">${c.na_condition}</span>` : ''}
              ${o === ap.original_answer ? html`<span class="mu small">(исходный)</span>` : ''}</label>`)}
          </fieldset>
          <label for="rv-reason">Причина решения <span aria-hidden="true">*</span><span class="sr">(обязательно)</span></label>
          <textarea id="rv-reason" rows="3" required data-input="review-reason" aria-describedby="rv-err" ${attr('aria-invalid', !!r.error)}>${r.reason}</textarea>
          <p id="rv-err" class="err" role="alert">${r.error || ''}</p>
          ${preview ? html`<p class="preview" aria-live="polite">Итог после решения: <b>${fmtScore(R.final.total)}</b> → <b>${fmtScore(preview.total)}</b>${preview.gross_flag ? ' · грубое нарушение' : ''}</p>` : ''}
          <div class="row end"><a class="btn" href="#/appeals">Отмена</a><button type="submit" class="p">Подтвердить решение</button></div>
        </form>` : !ap.resolution ? html`<section class="card"><h3>Апелляция устарела</h3>
          <p class="mu">Диалог был переоценён, исходная оценка больше не действует. Если спор остался, оспорьте новую оценку в карточке диалога.</p></section>`
        : html`<section class="card"><h3>Решение проверяющего</h3>
          <ol class="layers">
            <li><span class="lbl">Исходная оценка</span>${answerBadge(c, ap.original_answer)}</li>
            <li><span class="lbl">Решение проверяющего</span>${answerBadge(c, ap.resolution.new_answer)} <span class="reason">«${ap.resolution.reason}»</span> <span class="mu small">${fmtDate(ap.resolution.resolved_at)}</span></li>
            <li><span class="lbl">Финальный результат</span>итог <b>${fmtScore(R.final.total)}</b>${R.final.gross_flag ? ' · грубое нарушение' : ''}</li>
          </ol></section>`}
      </div>
      <section class="card" aria-labelledby="frag-h"><h3 id="frag-h">Фрагмент диалога вокруг доказательства</h3>
        ${transcriptView(conv, { from, to, highlight: { indices: item.evidence || [], range: item.checked_range }, audio: false })}
        <a href="#/conversations/${encodeURIComponent(conv.conversation_id)}">Открыть весь диалог →</a>
      </section>
    </div>`;
}

// ---------- модальное окно «Оспорить» ----------
export function appealModalView(s, m) {
  const ev = s.evaluations[m.evaluationId];
  const cl = checklistById(s, ev.checklist_id);
  const pendingIds = new Set(s.appeals.filter((a) => a.evaluation_id === ev.id && a.status === 'pending').map((a) => a.criterion_id));
  const items = ev.items.filter((i) => !pendingIds.has(i.criterion_id));
  const cur = items.find((i) => i.criterion_id === m.criterionId) || items[0];
  const c = cur && criterionOf(cl, cur.criterion_id);
  return html`<form data-submit="appeal" novalidate aria-labelledby="ap-h">
    <h3 id="ap-h">Оспорить оценку</h3>
    ${items.length ? html`
      <label for="ap-crit">Критерий</label>
      <select id="ap-crit" data-change="appeal-crit">${items.map((i) => {
        const cc = criterionOf(cl, i.criterion_id);
        return html`<option value="${i.criterion_id}" ${attr('selected', i === cur)}>${cc ? cc.title : i.criterion_id} — ${answerText(cc, i.answer)}</option>`;
      })}</select>
      <div class="box"><div class="row">${answerBadge(c, cur.answer)}</div><p class="expl">${cur.explanation}</p></div>
      <label for="ap-comment">Комментарий <span aria-hidden="true">*</span><span class="sr">(обязательно)</span></label>
      <textarea id="ap-comment" rows="4" placeholder="Почему оценка неверна? Укажите номер реплики, если можно." data-input="appeal-comment" aria-describedby="ap-err" ${attr('aria-invalid', !!m.error)}>${m.comment || ''}</textarea>
      <p id="ap-err" class="err" role="alert">${m.error || ''}</p>
      <div class="row end"><button type="button" data-action="modal-close">Отмена</button><button type="submit" class="p" ${attr('disabled', m.busy)}>Отправить апелляцию</button></div>`
    : html`<p class="mu">По всем критериям уже есть апелляции на рассмотрении.</p><div class="row end"><button type="button" data-action="modal-close">Закрыть</button></div>`}
  </form>`;
}

export const handlers = {
  click: {
    'appeal-filter'(el) { store.set({ appealFilter: el.dataset.f }); },
    'appeal-open'(el) {
      const s = store.get();
      const ev = latestEvaluation(s, s.route.params.id);
      if (!ev) return;
      store.set({ modal: { type: 'appeal', evaluationId: ev.id, criterionId: el.dataset.criterion || null, comment: '' } });
    },
  },
  change: {
    'appeal-crit'(el) { const m = store.get().modal; store.set({ modal: { ...m, criterionId: el.value, error: null } }); },
    'review-answer'(el) {
      const s = store.get();
      const prev = s.review && s.review.appealId === s.route.params.id ? s.review : { reason: '' };
      store.set({ review: { ...prev, appealId: s.route.params.id, answer: decodeAns(el.value) } });
    },
  },
  input: {
    'appeal-comment'(el) { store.get().modal.comment = el.value; }, // без перерисовки
    'review-reason'(el) {
      const s = store.get();
      const ap = s.appeals.find((a) => a.id === s.route.params.id);
      const prev = s.review && s.review.appealId === s.route.params.id ? s.review : { answer: ap.original_answer };
      store.set({ review: { ...prev, appealId: s.route.params.id, reason: el.value } }, { silent: true });
    },
  },
  submit: {
    async appeal(form) {
      const s = store.get();
      const m = s.modal;
      const comment = form.querySelector('#ap-comment').value.trim();
      const crit = form.querySelector('#ap-crit').value;
      if (!comment) { store.set({ modal: { ...m, criterionId: crit, comment, error: 'Напишите комментарий — без него апелляцию не принять.' } }); return; }
      const ev = s.evaluations[m.evaluationId];
      const item = ev.items.find((i) => i.criterion_id === crit);
      try {
        const ap = await createAppeal({ evaluation_item_id: item.id, comment });
        store.set({ modal: null });
        toast(`Апелляция ${ap.id} отправлена`, 'ok');
      } catch (e) { store.set({ modal: { ...m, criterionId: crit, comment, error: e.message } }); }
    },
    async review(form) {
      const s = store.get();
      const id = s.route.params.id;
      const ap = s.appeals.find((a) => a.id === id);
      const checked = form.querySelector('input[name="answer"]:checked');
      const reason = form.querySelector('#rv-reason').value.trim();
      const answer = checked ? decodeAns(checked.value) : ap.original_answer;
      if (!reason) {
        store.set({ review: { appealId: id, answer, reason: '', error: 'Причина обязательна: опишите, почему ответ подтверждён или изменён.' } });
        document.getElementById('rv-reason')?.focus();
        return;
      }
      const ev = s.evaluations[ap.evaluation_id];
      const before = finalResult(s, ev).final.total;
      try {
        await resolveAppeal(id, { new_answer: answer, reason });
        const after = finalResult(store.get(), ev).final.total;
        store.set({ review: null });
        toast(`Решение сохранено. Итог: ${fmtScore(before)} → ${fmtScore(after)}`, 'ok');
      } catch (e) { fail(e); }
    },
  },
};
