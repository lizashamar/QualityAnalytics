import { html, attr } from '../html.js';
import { store } from '../store.js';
import { validateChecklist, round2 } from '../scoring.js';
import { activeChecklist, checklistLabel, fmtDate } from '../results.js';
import { saveChecklist, activateChecklist, evaluateMany, toast, fail } from '../actions.js';
import { icon } from '../icons.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const TYPE = { yesno: 'Да / Нет', scale: 'Шкала' };

export function newDraft(base) {
  if (!base) return { family_id: null, based_on: null, name: 'Новый чек-лист', description: '', criteria: [], activate: true };
  return { family_id: base.family_id, based_on: base.id, name: base.name, description: base.description || '', criteria: clone(base.criteria), activate: true, baseVersion: base.version };
}

export function scaleMode(c) {
  if (c._scaleMode) return c._scaleMode;
  if (c.type !== 'scale') return 'yesno';
  for (const maximum of [10, 20]) {
    if (c.scale_steps?.length === maximum + 1 && Array.from({length:maximum + 1}, (_, i) => i).every((i) => c.scale_steps.includes(i))) return `scale_${maximum}`;
  }
  return 'scale';
}

export function listView(s) {
  const fams = [];
  for (const c of s.checklists) {
    let f = fams.find((x) => x.id === c.family_id);
    if (!f) fams.push((f = { id: c.family_id, versions: [] }));
    f.versions.push(c);
  }
  fams.forEach((f) => f.versions.sort((a, b) => b.version - a.version));
  const act = activeChecklist(s);
  return html`
    ${reevalPanel(s)}
    <div class="page-head"><div><h2>Чек-листы</h2>
      <p class="sub">Оценка запускается активной версией. Сохранение изменений создаёт новую версию — старые оценки остаются привязаны к своей.</p></div>
      <div class="row">
        ${act ? html`<button type="button" data-action="apply-open">${icon('refresh')}Применить к диалогам…</button>` : ''}
        <a class="btn p" href="#/checklists/new/edit">${icon('plus')}Новый чек-лист</a></div></div>
    ${fams.map((f) => html`<section class="card mb" aria-label="${f.versions[0].name}">
      <div class="card-head"><h3>${icon('doc')}${f.versions[0].name}</h3><span class="hint">${f.versions.length} верс.</span></div>
      <div class="tw" tabindex="0" role="region" aria-label="Версии чек-листа ${f.versions[0].name}. Таблица прокручивается по горизонтали."><table class="table"><thead><tr><th scope="col">Версия</th><th scope="col">Критериев</th><th scope="col">Создана</th><th scope="col">Статус</th><th scope="col"><span class="sr">Действия</span></th></tr></thead><tbody>
      ${f.versions.map((v) => html`<tr>
        <td><b>v${v.version}</b></td><td>${v.criteria.length}</td><td>${fmtDate(v.created_at)}</td>
        <td>${v.active ? html`<span class="b ok">${icon('check')}<span>Активная</span></span>` : html`<span class="hint">—</span>`}</td>
        <td><div class="row end">
          ${s.checklists.length > 1 ? html`<button type="button" class="btn-sm" data-action="compare-open" data-id="${v.id}" aria-label="Сравнить версию ${v.version} с другой">${icon('scale')}Сравнить с…</button>` : ''}
          ${v.active ? '' : html`<button type="button" data-action="cl-activate" data-id="${v.id}">Сделать активной</button>`}
          <a class="btn" href="#/checklists/${encodeURIComponent(v.id)}/edit">Изменить (новая версия)</a>
        </div></td></tr>`)}
      </tbody></table></div>
    </section>`)}`;
}

// ---------- переоценка после сохранения новой версии ----------
function avgCost(s) {
  if (typeof s.avgCost === 'number') return s.avgCost;
  const xs = Object.values(s.evaluations || {}).map((e) => e.usage?.cost_usd).filter((x) => typeof x === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function reevalIds(s, o) {
  if (o.mode === 'selected') return (s.selectedConversations || []).filter((id) => s.conversations.some((c) => c.conversation_id === id));
  if (o.mode === 'first') return s.conversations.slice(0, Math.max(0, Number(o.n) || 0)).map((c) => c.conversation_id);
  // все ранее оценённые по прежней версии (по истории; если её нет — по последним оценкам)
  const fromHistory = new Set((s.history || []).filter((h) => h.checklist_id === o.baseId).map((h) => h.conversation_id));
  const fromLatest = s.conversations.filter((c) => s.evaluations[s.latest[c.conversation_id]]?.checklist_id === o.baseId).map((c) => c.conversation_id);
  return s.conversations.map((c) => c.conversation_id).filter((id) => fromHistory.has(id) || fromLatest.includes(id));
}

function reevalPanel(s) {
  const o = s.reevalOffer;
  if (!o) return '';
  const ids = reevalIds(s, o);
  const avg = avgCost(s);
  const busy = !!s.applying;
  const done = o.done;
  const radio = (mode, label, count) => html`<label class="opt"><input type="radio" name="reeval-mode" value="${mode}" data-change="reeval-mode" ${attr('checked', o.mode === mode)} ${attr('disabled', busy)}>
    <span>${label}</span><span class="hint">${count} диал.</span></label>`;
  return html`<section class="notice ok reeval" role="region" aria-labelledby="reeval-h">
    ${icon('check')}
    <div class="grow">
      <h3 id="reeval-h">Версия v${o.version} сохранена. Переоценить диалоги?</h3>
      ${done ? html`<p>Переоценено ${done.ok} из ${done.total}.${done.cost != null ? ` Стоимость ≈ $${done.cost.toFixed(4)}.` : ''}</p>
        <div class="row">${o.baseId ? html`<a class="btn p" href="#/checklists/compare/${encodeURIComponent(o.baseId)}/${encodeURIComponent(o.id)}">${icon('scale')}Сравнить v${o.baseVersion} → v${o.version}</a>` : ''}
          <button type="button" data-action="reeval-dismiss">Закрыть</button></div>`
      : html`<fieldset ${attr('disabled', busy)}><legend class="sr">Какие диалоги переоценить</legend>
          ${o.baseId ? radio('previous', `Все ранее оценённые по v${o.baseVersion}`, reevalIds(s, { ...o, mode: 'previous' }).length) : ''}
          ${radio('selected', 'Выбранные в списке диалогов', reevalIds(s, { ...o, mode: 'selected' }).length)}
          ${radio('first', 'Первые N', reevalIds(s, { ...o, mode: 'first' }).length)}
          <div class="row"><label class="inline" for="reeval-n">Количество диалогов (N)</label><input id="reeval-n" type="number" min="1" max="${s.conversations.length}" value="${o.n}" data-input="reeval-n" class="num"></div>
        </fieldset>
        <p class="hint">Будет оценено <b>${ids.length}</b> диал. чек-листом v${o.version}.
          ${avg != null ? html`Ориентировочная стоимость: <b>$${(avg * ids.length).toFixed(4)}</b> (средняя цена прошлой оценки $${avg.toFixed(4)}).` : 'Стоимость неизвестна: цены модели не заданы.'}</p>
        ${busy ? html`<p role="status">Оценено ${s.applying.done} из ${s.applying.total}…</p>
          <progress max="${s.applying.total}" value="${s.applying.done}" aria-label="Прогресс переоценки"></progress>` : ''}
        <div class="row">
          <button type="button" class="p" data-action="reeval-run" ${attr('disabled', busy || !ids.length)}>${icon('refresh')}Переоценить (${ids.length})</button>
          <button type="button" class="ghost" data-action="reeval-dismiss" ${attr('disabled', busy)}>Не сейчас</button>
        </div>`}
    </div>
  </section>`;
}

// ---------- редактор ----------
export function editorView(s) {
  const d = s.draft;
  if (!d) return html`<p class="mu">Загрузка…</p>`;
  const scoreSum = round2(d.criteria.filter((c) => !c.is_flag).reduce((a, c) => a + (Number(c.weight) || 0), 0));
  const errors = validateChecklist(d.criteria);
  const ok = !errors.length;
  let lastSection = null;
  return html`
    <a href="#/checklists" class="back">${icon('arrowLeft')}К чек-листам</a>
    <div class="page-head"><div>
      <h2>${d.based_on ? 'Редактирование чек-листа' : 'Новый чек-лист'}</h2>
      <p class="sub">${d.based_on?`На основе v${d.baseVersion}. `:''}Изменения сохранятся как новая версия. Существующие оценки сохранят свою методику.</p></div></div>
    <section class="card editor-identity">

      <label for="ed-name">Название</label><input id="ed-name" value="${d.name}" data-input="draft-field" data-key="name">
      <label for="ed-desc">Описание</label><input id="ed-desc" value="${d.description}" data-input="draft-field" data-key="description">
    </section>
    <section class="card mt" aria-labelledby="ed-crit-h">
      <div class="card-head"><h3 id="ed-crit-h">Критерии (${d.criteria.length})</h3>
        <span class="b ${scoreSum === 100 ? 'ok' : 'rd'}">${icon(scoreSum === 100 ? 'check' : 'x')}<span>Сумма весов ${scoreSum} / 100</span></span></div>
      <div class="meter t-${scoreSum === 100 ? 'ok' : 'rd'}" role="img" aria-label="Сумма весов ${scoreSum} из 100"><i style="width:${Math.min(100, scoreSum)}%"></i></div>
      <ol class="ed-list">
      ${d.criteria.map((c, i) => {
        const sec = c.section !== lastSection ? html`<li class="group" aria-hidden="true">${c.section}</li>` : '';
        lastSection = c.section;
        return html`${sec}<li class="ed-item" data-criterion-index="${i}">
          <button type="button" class="drag-handle" draggable="true" data-drag-criterion="${i}" aria-label="Перетащить критерий ${i + 1}" title="Перетащите или используйте стрелки">⠿</button>
          <div class="criterion-copy"><b>${i + 1}. ${c.title || 'Без названия'}</b>
            <div class="mu small">${c.is_flag ? 'флаг грубого нарушения, без баллов' : `${TYPE[c.type]}${c.type === 'scale' ? ' ' + c.scale_steps.join('/') : ''} · вес ${c.weight}`}${c.allow_na ? ' · N/A разрешён' : ''} · id ${c.id}</div>
            <div class="mu small">${c.question}</div></div>
          <div class="criterion-controls">${!c.is_flag ? html`<label class="inline-weight">Вес<input type="number" min="0.01" max="100" step="any" data-change="criterion-weight" data-i="${i}" value="${c.weight}" aria-label="Вес критерия ${c.title}"></label>` : html`<span class="flag-label">${icon('flag')}Без баллов</span>`}
          <div class="ed-actions">
            <button type="button" class="icon-btn" data-action="cr-move" data-i="${i}" data-d="-1" aria-label="Переместить «${c.title}» выше" title="Выше" ${attr('disabled', i === 0)}>${icon('up')}</button>
            <button type="button" class="icon-btn" data-action="cr-move" data-i="${i}" data-d="1" aria-label="Переместить «${c.title}» ниже" title="Ниже" ${attr('disabled', i === d.criteria.length - 1)}>${icon('down')}</button>
            <button type="button" class="btn-sm" data-action="cr-edit" data-i="${i}" aria-label="Изменить критерий «${c.title}»">${icon('edit')}<span class="edit-label">Изменить</span></button>
            <button type="button" class="btn-sm d" data-action="cr-delete" data-i="${i}" aria-label="Удалить критерий «${c.title}»" title="Удалить">${icon('trash')}<span class="btn-label">Удалить</span></button>
          </div></div></li>`;
      })}
      </ol>
      <button type="button" class="ghost add" data-action="cr-edit" data-i="-1">${icon('plus')}Добавить критерий</button>
    </section>
    <section class="card mt editor-save">
      ${ok ? html`<p class="notice ok">${icon('check')}<span>Чек-лист корректен</span></p>` : html`<div class="notice rd errors" role="alert">${icon('alert')}<div><b>Исправьте перед сохранением:</b><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div></div>`}
      <label class="check"><input type="checkbox" id="ed-activate" data-change="draft-activate" ${attr('checked', d.activate)}> Сделать новую версию активной</label>
      <div class="row end">
        <a class="btn" href="#/checklists">Отмена</a>
        <button type="button" class="p" data-action="draft-save" ${attr('disabled', !ok || d.busy)} aria-describedby="save-hint">${d.busy?'Сохраняем…':'Сохранить как новую версию'}</button>
      </div>
      <p id="save-hint" class="mu small">Существующие оценки останутся привязаны к своей версии чек-листа.</p>
    </section>`;
}

export function criterionModalView(s, m) {
  const c = m.c;
  const sections = [...new Set(s.draft.criteria.map((x) => x.section).filter(Boolean))];
  const steps = c.scale_steps.length ? c.scale_steps : [];
  return html`<form data-submit="criterion" novalidate aria-labelledby="cm-h" id="cm-form">
    <div class="dialog-head"><h3 id="cm-h">${m.index < 0 ? 'Новый критерий' : 'Изменить критерий'}</h3><button type="button" class="icon-btn ghost" data-action="modal-close" aria-label="Закрыть редактор критерия">${icon('x')}</button></div>
    <label for="cm-id">ID критерия</label><input id="cm-id" value="${c.id}" required>
    <label for="cm-title">Название</label><input id="cm-title" value="${c.title}" required>
    <label for="cm-section">Секция</label><input id="cm-section" list="cm-sections" value="${c.section}" required>
    <datalist id="cm-sections">${sections.map((x) => html`<option value="${x}"></option>`)}</datalist>
    <label for="cm-question">Формулировка (что значит «Да» / что оценивать)</label><textarea id="cm-question" rows="3">${c.question}</textarea>
    <label class="check"><input type="checkbox" id="cm-flag" data-change="cm-rerender" ${attr('checked', c.is_flag)}> Флаг грубого нарушения (без баллов; «Да» = нарушение выявлено)</label>
    <div class="row two">
      <div><label for="cm-type">Тип ответа</label>
        <select id="cm-type" data-change="cm-rerender" ${attr('disabled', c.is_flag)}>
          <option value="yesno" ${attr('selected', c.type === 'yesno')}>Да / Нет</option>
          <option value="scale" ${attr('selected', scaleMode(c) === 'scale')}>Шкала (свои ступени)</option>
          <option value="scale_10" ${attr('selected', scaleMode(c) === 'scale_10')}>Шкала 0–10</option>
          <option value="scale_20" ${attr('selected', scaleMode(c) === 'scale_20')}>Шкала 0–20</option></select></div>
      <div><label for="cm-weight">Вес</label><input id="cm-weight" type="number" min="0" step="any" value="${c.is_flag ? 0 : c.weight}" ${attr('disabled', c.is_flag)}></div>
    </div>
    ${c.type === 'scale' && !c.is_flag && scaleMode(c) !== 'scale' ? html`<p class="mu small">Все целые значения от 0 до ${scaleMode(c) === 'scale_10' ? 10 : 20}. Для своих ступеней и описаний выберите «Шкала (свои ступени)».</p>` : ''}
    ${c.type === 'scale' && !c.is_flag && scaleMode(c) === 'scale' ? html`<fieldset><legend>Ступени шкалы и описания (верхняя ступень = полный вес)</legend>
      ${steps.map((st, i) => html`<div class="row step">
        <label class="sr" for="cm-step-${i}">Ступень ${i + 1}</label><input id="cm-step-${i}" class="num" type="number" min="0" step="any" value="${st}" data-step="${i}">
        <label class="sr" for="cm-label-${i}">Описание ступени ${i + 1}</label><input id="cm-label-${i}" class="grow" value="${(c.scale_labels || {})[st] || ''}" placeholder="Описание ступени">
        <button type="button" class="icon-btn d" data-action="cm-step-del" data-i="${i}" aria-label="Удалить ступень ${st}" title="Удалить ступень">${icon('trash')}</button></div>`)}
      <button type="button" class="ghost" data-action="cm-step-add">${icon('plus')}Ступень</button></fieldset>` : ''}
    <label class="check"><input type="checkbox" id="cm-na" data-change="cm-rerender" ${attr('checked', c.allow_na)}> Разрешён ответ N/A</label>
    ${c.allow_na ? html`<label for="cm-nacond">Условие N/A</label><textarea id="cm-nacond" rows="2">${c.na_condition}</textarea>` : ''}
    <p class="err" role="alert">${m.error || ''}</p>
    <div class="row end"><button type="button" data-action="modal-close">Отмена</button><button type="submit" class="p">Сохранить критерий</button></div>
  </form>`;
}

/** Считывает текущие значения формы критерия (чтобы перерисовка не теряла ввод). */
function readCriterionForm(base) {
  const $ = (id) => document.getElementById(id);
  const c = { ...base };
  c.id = $('cm-id').value.trim();
  c.title = $('cm-title').value.trim();
  c.section = $('cm-section').value.trim();
  c.question = $('cm-question').value.trim();
  c.is_flag = $('cm-flag').checked;
  const selectedType = c.is_flag ? 'yesno' : $('cm-type').value;
  c._scaleMode = selectedType;
  c.type = selectedType.startsWith('scale_') ? 'scale' : selectedType;
  c.weight = c.is_flag ? 0 : Number($('cm-weight').value) || 0;
  c.allow_na = $('cm-na').checked;
  c.na_condition = $('cm-nacond') ? $('cm-nacond').value.trim() : base.na_condition || '';
  if (selectedType.startsWith('scale_')) {
    const maximum = Number(selectedType.split('_')[1]);
    c.scale_steps = Array.from({length:maximum + 1}, (_, i) => maximum - i);
  } else if (c.type === 'scale') {
    const steps = [];
    const labels = {};
    document.querySelectorAll('#cm-form [data-step]').forEach((inp) => {
      const i = inp.dataset.step;
      const v = inp.value === '' ? NaN : Number(inp.value);
      steps.push(v);
      const lb = $(`cm-label-${i}`).value.trim();
      if (Number.isFinite(v) && lb) labels[v] = lb;
    });
    c.scale_steps = steps.length ? steps : [...(base.scale_steps||[])];
    c.scale_labels = steps.length ? labels : {...base.scale_labels};
  }
  return c;
}

function rerender(patch = (c) => c, error = null) {
  const m = store.get().modal;
  store.set({ modal: { ...m, c: patch(readCriterionForm(m.c)), error } });
}

export function applyModalView(s, m) {
  const act = activeChecklist(s);
  const sel = new Set(m.selected);
  const busy = !!s.applying;
  return html`<form data-submit="apply" aria-labelledby="apply-h">
    <h3 id="apply-h">Применить чек-лист к диалогам</h3>
    <p>Оценка будет выполнена активной версией: <b>${checklistLabel(act)}</b>.</p>
    <label class="check"><input type="checkbox" data-change="apply-all" ${attr('checked', sel.size === s.conversations.length)} ${attr('disabled', busy)}> Все диалоги (${s.conversations.length})</label>
    <fieldset ${attr('disabled', busy)}><legend class="sr">Диалоги</legend>
      ${s.conversations.map((c) => html`<label class="check"><input type="checkbox" data-change="apply-one" value="${c.conversation_id}" ${attr('checked', sel.has(c.conversation_id))}> ${c.conversation_id} <span class="mu small">${c.language} · ${c.channel}</span></label>`)}
    </fieldset>
    ${busy ? html`<p aria-live="polite">Оценено ${s.applying.done} из ${s.applying.total}…</p><div class="bar"><i style="width:${(s.applying.done / s.applying.total) * 100}%"></i></div>` : ''}
    <div class="row end"><button type="button" data-action="modal-close" ${attr('disabled', busy)}>Отмена</button>
      <button type="submit" class="p" ${attr('disabled', busy || !sel.size)}>Оценить выбранные (${sel.size})</button></div>
  </form>`;
}

export const handlers = {
  input: {
    'reeval-n'(el) { const o = store.get().reevalOffer; if (o) store.set({ reevalOffer: { ...o, n: Math.max(1, Math.min(9999, Number(el.value) || 1)), mode: 'first' } }); },
    'draft-field'(el) { store.get().draft[el.dataset.key] = el.value; }, // без перерисовки
  },
  change: {
    'reeval-mode'(el) { const o = store.get().reevalOffer; if (o) store.set({ reevalOffer: { ...o, mode: el.value } }); },
    'criterion-weight'(el) {
      const d=store.get().draft, i=Number(el.dataset.i), value=Number(el.value);
      if(!d||!d.criteria[i]||!Number.isFinite(value))return;
      store.set({draft:{...d,criteria:d.criteria.map((c,k)=>k===i?{...c,weight:value}:c)}});
    },
    'draft-activate'(el) { store.get().draft.activate = el.checked; },
    'cm-rerender'() { rerender(); },
    'apply-all'(el) {
      const s = store.get();
      store.set({ modal: { ...s.modal, selected: el.checked ? s.conversations.map((c) => c.conversation_id) : [] } });
    },
    'apply-one'(el) {
      const m = store.get().modal;
      const sel = new Set(m.selected);
      if (el.checked) sel.add(el.value); else sel.delete(el.value);
      store.set({ modal: { ...m, selected: [...sel] } });
    },
  },
  click: {
    'reeval-dismiss'() { if (!store.get().applying) store.set({ reevalOffer: null }); },
    async 'reeval-run'() {
      const s = store.get();
      const o = s.reevalOffer;
      if (!o || s.applying) return;
      const ids = reevalIds(s, o);
      if (!ids.length) return;
      const before = new Set(Object.keys(s.evaluations));
      try {
        const ok = await evaluateMany(ids, o.id);
        const fresh = Object.values(store.get().evaluations).filter((e) => !before.has(e.id) && e.checklist_id === o.id);
        const costs = fresh.map((e) => e.usage?.cost_usd).filter((x) => typeof x === 'number');
        store.set((st) => ({ reevalOffer: st.reevalOffer && { ...st.reevalOffer, done: { ok, total: ids.length, cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null } } }));
        toast(`Переоценено ${ok} из ${ids.length} по v${o.version}`, ok === ids.length ? 'ok' : 'rd');
      } catch (e) { fail(e); }
    },
    async 'cl-activate'(el) {
      try { await activateChecklist(el.dataset.id); toast('Версия сделана активной', 'ok'); } catch (e) { fail(e); }
    },
    'apply-open'() {
      const s = store.get();
      store.set({ modal: { type: 'apply', selected: s.conversations.map((c) => c.conversation_id) } });
    },
    'cr-move'(el) {
      const d = store.get().draft;
      const i = Number(el.dataset.i);
      const j = i + Number(el.dataset.d);
      if (j < 0 || j >= d.criteria.length) return;
      const list = [...d.criteria];
      [list[i], list[j]] = [list[j], list[i]];
      store.set({ draft: { ...d, criteria: list } });
      requestAnimationFrame(() => document.querySelector(`[data-action="cr-move"][data-i="${j}"][data-d="${el.dataset.d}"]`)?.focus());
    },
    'cr-delete'(el) {
      const d = store.get().draft;
      const c = d.criteria[Number(el.dataset.i)];
      if (!window.confirm(`Удалить критерий «${c.title}»?`)) return;
      store.set({ draft: { ...d, criteria: d.criteria.filter((_, k) => k !== Number(el.dataset.i)) } });
    },
    'cr-edit'(el) {
      const d = store.get().draft;
      const i = Number(el.dataset.i);
      const c = i < 0
        ? { id: `k${Date.now().toString(36)}`, section: d.criteria.length ? d.criteria[d.criteria.length - 1].section : '', title: '', question: '', type: 'yesno', weight: 10, allow_na: false, na_condition: '', scale_steps: [], scale_labels: {}, is_flag: false }
        : clone(d.criteria[i]);
      store.set({ modal: { type: 'criterion', index: i, c } });
    },
    'cm-step-add'() {
      rerender((c) => {
        const nums = c.scale_steps.filter(Number.isFinite);
        const next = nums.length ? Math.max(0, Math.min(...nums) - 1) : 0;
        return { ...c, scale_steps: [...c.scale_steps, next] };
      });
    },
    'cm-step-del'(el) {
      const i = Number(el.dataset.i);
      rerender((c) => ({ ...c, scale_steps: c.scale_steps.filter((_, k) => k !== i) }));
    },
    async 'draft-save'() {
      const d = store.get().draft;
      d.name = document.getElementById('ed-name').value.trim() || 'Без названия';
      d.description = document.getElementById('ed-desc').value.trim();
      store.set({ draft: { ...d, busy: true } });
      try {
        const saved = await saveChecklist(d, d.activate);
        const hasPrev = d.based_on && store.get().checklists.some((c) => c.id === d.based_on);
        store.set({ draft: null, reevalOffer: { id: saved.id, version: saved.version, baseId: hasPrev ? d.based_on : null,
          baseVersion: d.baseVersion, mode: hasPrev ? 'previous' : 'first', n: 5, done: null } });
        location.hash = '#/checklists';
        toast(`Сохранена версия v${saved.version}${d.activate ? ' и сделана активной' : ''}`, 'ok');
      } catch (e) {
        store.set({ draft: { ...store.get().draft, busy: false } });
        fail(e);
      }
    },
  },
  submit: {
    criterion() {
      const s = store.get();
      const m = s.modal;
      const c = readCriterionForm(m.c);
      if (c.type === 'scale') {
        c.scale_steps = c.scale_steps.filter(Number.isFinite).sort((a, b) => b - a);
      } else {
        c.scale_steps = [];
        c.scale_labels = {};
      }
      delete c._scaleMode;
      if (!c.allow_na) c.na_condition = '';
      const errs = validateChecklist([c]).filter((e) => !e.startsWith('Сумма весов'));
      if (errs.length) {
        store.set({ modal: { ...m, c, error: errs.map((e) => e.replace(/^Критерий 1: /, '')).join(' ') } });
        return;
      }
      const list = [...s.draft.criteria];
      if (m.index < 0) list.push(c); else list[m.index] = c;
      store.set({ draft: { ...s.draft, criteria: list }, modal: null });
    },
    async apply() {
      const s = store.get();
      const ids = [...s.modal.selected];
      const act = activeChecklist(s);
      const ok = await evaluateMany(ids, act && act.id);
      store.set({ modal: null });
      toast(`Оценено диалогов: ${ok} из ${ids.length} (${checklistLabel(act)})`, ok === ids.length ? 'ok' : 'rd');
    },
  },
};
