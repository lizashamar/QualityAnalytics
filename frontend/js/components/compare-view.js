// Сравнение двух версий чек-листа: сводка, что изменилось в чек-листе, таблица диалогов «было → стало».
import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { checklistLabel, fmtScore, fmtPts, scoreTone } from '../results.js';
import { emptyState, skeleton } from './ui.js';
import { loadCompare } from '../actions.js';

const EPS = 0.005;
const TYPE = { yesno: 'Да / Нет', scale: 'Шкала' };
const dTone = (d) => (d == null || Math.abs(d) < EPS ? 'ne' : d > 0 ? 'ok' : 'rd');
const dIcon = { ok: 'up', rd: 'down', ne: 'minus' };
const dLabel = { ok: 'рост', rd: 'падение', ne: 'без изменений' };

function fmtVal(field, v) {
  if (v === true) return 'да';
  if (v === false) return 'нет';
  if (field === 'type') return TYPE[v] || v;
  if (field === 'scale_steps') return v && v.length ? v.join(' / ') : '—';
  if (field === 'scale_labels') return Object.keys(v || {}).length ? Object.entries(v).map(([k, t]) => `${k}: ${t}`).join('; ') : '—';
  if (v === '' || v == null) return '—';
  return String(v);
}
const ansText = (a) => (a == null ? '—' : a === 'yes' ? 'Да' : a === 'no' ? 'Нет' : a === 'na' ? 'N/A' : String(a));
const ptsText = (p) => (p == null ? '—' : fmtPts(p));

export function deltaBadge(d) {
  const t = dTone(d);
  return html`<span class="delta-b d-${t}">${icon(dIcon[t])}<span>${d == null ? '—' : `${d > 0 ? '+' : ''}${fmtPts(d)}`}</span><span class="sr">${dLabel[t]}</span></span>`;
}

function ui(s) {
  return { sort: 'delta-asc', onlyChanged: false, expanded: {}, ...(s.compareUi || {}) };
}

function sorted(rows, sort) {
  const key = { 'delta-asc': (r) => r.delta ?? 0, 'delta-desc': (r) => -(r.delta ?? 0), 'id': () => 0 }[sort] || (() => 0);
  return [...rows].sort((a, b) => (key(a) - key(b)) || a.conversation_id.localeCompare(b.conversation_id, 'ru', { numeric: true }));
}

function diffView(diff) {
  const nothing = !diff.added.length && !diff.removed.length && !diff.changed.length;
  return html`<section class="card mt" aria-labelledby="cmp-diff-h">
    <div class="card-head"><h3 id="cmp-diff-h">Что изменилось в чек-листе</h3>
      <span class="hint">добавлено ${diff.added.length} · удалено ${diff.removed.length} · изменено ${diff.changed.length} · без изменений ${diff.unchanged}</span></div>
    ${nothing ? html`<p class="hint">Критерии версий совпадают.</p>` : ''}
    <ul class="diff-list">
      ${diff.added.map((c) => html`<li class="diff-item add"><span class="diff-kind">${icon('plus')}Добавлен</span>
        <span class="diff-title">${c.title} <span class="hint">${c.criterion_id} · ${c.section}</span></span>
        <span class="diff-meta">${c.is_flag ? 'флаг, без баллов' : `вес ${c.weight} · ${TYPE[c.type] || c.type}${c.type === 'scale' ? ' ' + c.scale_steps.join('/') : ''}`}${c.allow_na ? ' · N/A' : ''}</span></li>`)}
      ${diff.removed.map((c) => html`<li class="diff-item del"><span class="diff-kind">${icon('trash')}Удалён</span>
        <span class="diff-title">${c.title} <span class="hint">${c.criterion_id} · ${c.section}</span></span>
        <span class="diff-meta">${c.is_flag ? 'флаг' : `вес ${c.weight}`}</span></li>`)}
      ${diff.changed.map((c) => html`<li class="diff-item mod"><span class="diff-kind">${icon('edit')}Изменён</span>
        <span class="diff-title">${c.title} <span class="hint">${c.criterion_id}</span></span>
        <dl class="diff-changes">${c.changes.map((x) => html`<div><dt>${x.label}</dt><dd><s>${fmtVal(x.field, x.from)}</s> ${icon('arrowRight')} <b>${fmtVal(x.field, x.to)}</b></dd></div>`)}</dl></li>`)}
    </ul>
  </section>`;
}

function rowView(r, u, d) {
  const open = !!u.expanded[r.conversation_id];
  const t = dTone(r.delta);
  const details = [...r.changed_criteria.map((c) => ({ ...c, kind: 'answer' })), ...r.points_changed.map((c) => ({ ...c, kind: 'points' }))];
  return html`<tr class="cmp-row d-${t}${open ? ' open' : ''}">
    <td><button type="button" class="cmp-toggle" data-action="cmp-expand" data-id="${r.conversation_id}" aria-expanded="${String(open)}" ${open ? html`aria-controls="cmp-d-${r.conversation_id}"` : ''}
      aria-label="Критерии диалога ${r.conversation_id}" ${attr('disabled', !details.length)}>${icon(open ? 'down' : 'arrowRight')}</button></td>
    <td><a href="#/conversations/${encodeURIComponent(r.conversation_id)}" class="mono-id">${r.conversation_id}</a></td>
    <td class="num t-${scoreTone(r.total_from)}">${fmtScore(r.total_from)}${r.final_total_from != null ? html`<span class="hint final" title="После решения проверяющего"> · ${fmtScore(r.final_total_from)}</span>` : ''}</td>
    <td class="num t-${scoreTone(r.total_to)}">${fmtScore(r.total_to)}${r.final_total_to != null ? html`<span class="hint final" title="После решения проверяющего"> · ${fmtScore(r.final_total_to)}</span>` : ''}</td>
    <td>${deltaBadge(r.delta)}</td>
    <td>${r.gross_from === r.gross_to ? (r.gross_to ? html`<span class="b rd">${icon('alert')}<span>в обеих</span></span>` : html`<span class="hint">нет</span>`)
      : r.gross_to ? html`<span class="b rd">${icon('alert')}<span>появилось</span></span>` : html`<span class="b ok">${icon('check')}<span>исчезло</span></span>`}</td>
    <td class="num">${details.length ? details.length : html`<span class="hint">0</span>`}</td>
  </tr>
  ${open ? html`<tr class="cmp-detail" id="cmp-d-${r.conversation_id}"><td></td><td colspan="6">
    ${r.changed_criteria.length ? html`<p class="eyebrow-sm">Ответ изменился</p>` : ''}
    ${r.changed_criteria.map((c) => html`<div class="cmp-crit"><span class="cmp-crit-t">${c.title}</span>
      <span><s>${ansText(c.answer_from)}</s> ${icon('arrowRight')} <b>${ansText(c.answer_to)}</b></span>
      <span class="num">${ptsText(c.points_from)} ${icon('arrowRight')} ${ptsText(c.points_to)}</span></div>`)}
    ${r.points_changed.length ? html`<p class="eyebrow-sm">Ответ тот же, баллы изменились (вес или перераспределение N/A)</p>` : ''}
    ${r.points_changed.map((c) => html`<div class="cmp-crit"><span class="cmp-crit-t">${c.title}</span>
      <span>${ansText(c.answer_to)}</span>
      <span class="num">${ptsText(c.points_from)} ${icon('arrowRight')} ${ptsText(c.points_to)}</span></div>`)}
    <a class="small" href="#/conversations/${encodeURIComponent(r.conversation_id)}">Открыть диалог ${icon('arrowRight')}</a>
  </td></tr>` : ''}`;
}

export function view(s) {
  const { from, to } = s.route.params;
  const c = s.compare && s.compare.from === from && s.compare.to === to ? s.compare : { loading: true };
  const fromCl = s.checklists.find((x) => x.id === from);
  const toCl = s.checklists.find((x) => x.id === to);
  const versions = [...s.checklists].sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version);
  const opt = (v, cur) => html`<option value="${v.id}" ${attr('selected', v.id === cur)}>${checklistLabel(v)}${v.active ? ' (активная)' : ''}</option>`;
  const head = html`<a href="#/checklists" class="back">${icon('arrowLeft')}К чек-листам</a>
    <div class="page-head"><div><h2>Сравнение версий</h2>
      <p class="sub">${fromCl ? checklistLabel(fromCl) : from} ${icon('arrowRight')} ${toCl ? checklistLabel(toCl) : to}</p></div>
      <form class="row cmp-pick" data-submit="compare-switch" aria-label="Выбор версий">
        <label for="cmp-from" class="inline">Было</label><select id="cmp-from" name="from">${versions.map((v) => opt(v, from))}</select>
        <label for="cmp-to" class="inline">Стало</label><select id="cmp-to" name="to">${versions.map((v) => opt(v, to))}</select>
        <button type="submit">${icon('refresh')}Сравнить</button>
      </form></div>`;

  if (c.loading) return html`${head}<div class="card" aria-busy="true" aria-label="Загрузка сравнения">${skeleton(6)}</div>`;
  if (c.error) return html`${head}<div class="card">${emptyState('alert', 'Не удалось сравнить версии', c.error,
    html`<button type="button" data-action="cmp-retry">${icon('refresh')}Повторить</button>`)}</div>`;

  const d = c.data;
  const sm = d.summary;
  const u = ui(s);
  const rows = sorted(u.onlyChanged ? d.rows.filter((r) => r.delta != null && Math.abs(r.delta) >= EPS) : d.rows, u.sort);
  const stat = (label, value, extra = '', cls = '') => html`<div class="card kpi ${cls}"><span class="kpi-l">${label}</span><b class="big">${value}</b>${extra}</div>`;

  return html`${head}
    ${sm.compared ? html`<div class="kpis cmp-kpis">
      ${stat('Средний итог', html`${fmtScore(sm.avg_from)} ${icon('arrowRight')} ${fmtScore(sm.avg_to)}`, html`<span>${deltaBadge(sm.avg_delta)}</span>`)}
      ${stat('Диалогов сравнено', sm.compared, html`<span class="hint">не оценено по v${d.to.version}: ${sm.not_evaluated_in_to}</span>`)}
      ${stat('Выросло / упало / без изм.', html`<span class="t-ok">${sm.improved}</span> / <span class="t-rd">${sm.declined}</span> / <span class="t-ne">${sm.unchanged}</span>`,
        html`<span class="hint">${icon('up')}рост · ${icon('down')}падение · ${icon('minus')}без изменений</span>`)}
      ${stat('Грубые нарушения', html`${sm.gross_from} ${icon('arrowRight')} ${sm.gross_to}`,
        html`<span class="hint">${sm.gross_changed ? 'есть изменения' : 'без изменений'}${sm.reevaluation_cost_usd != null ? ` · переоценка $${sm.reevaluation_cost_usd.toFixed(4)}` : ''}</span>`, sm.gross_to > sm.gross_from ? 't-rd' : '')}
    </div>` : ''}
    ${diffView(d.diff)}
    <section class="card mt" aria-labelledby="cmp-rows-h">
      <div class="card-head"><h3 id="cmp-rows-h">Диалоги</h3>
        <div class="row">
          <label class="check"><input type="checkbox" id="cmp-only" data-change="cmp-only" ${attr('checked', u.onlyChanged)}> Только изменившиеся</label>
          <label for="cmp-sort" class="inline">Сортировка</label>
          <select id="cmp-sort" data-change="cmp-sort">
            <option value="delta-asc" ${attr('selected', u.sort === 'delta-asc')}>Сначала упавшие</option>
            <option value="delta-desc" ${attr('selected', u.sort === 'delta-desc')}>Сначала выросшие</option>
            <option value="id" ${attr('selected', u.sort === 'id')}>По ID</option>
          </select></div></div>
      ${!sm.compared ? emptyState('inbox', 'Нет диалогов, оценённых по обеим версиям',
          `Оценено по v${d.from.version}: ${sm.evaluated_in_from}, по v${d.to.version}: ${sm.evaluated_in_to}. Переоцените диалоги новой версией на вкладке «Чек-лист».`,
          html`<a class="btn p" href="#/checklists">${icon('refresh')}Переоценить</a>`)
        : !rows.length ? emptyState('check', 'Изменившихся итогов нет', 'Снимите фильтр «Только изменившиеся», чтобы увидеть все диалоги.')
        : html`<div class="tw"><table class="table cmp-table">
          <caption class="sr">Итоги диалогов по версиям ${d.from.version} и ${d.to.version}</caption>
          <thead><tr><th scope="col"><span class="sr">Раскрыть</span></th><th scope="col">Диалог</th>
            <th scope="col">Было (v${d.from.version})</th><th scope="col">Стало (v${d.to.version})</th>
            <th scope="col" aria-sort="${u.sort === 'delta-asc' ? 'ascending' : u.sort === 'delta-desc' ? 'descending' : 'none'}">
              <button type="button" class="th-sort" data-action="cmp-sort-delta">Разница ${icon(u.sort === 'delta-desc' ? 'down' : 'up')}</button></th>
            <th scope="col">Нарушение</th><th scope="col">Критериев изм.</th></tr></thead>
          <tbody>${rows.map((r) => rowView(r, u, d))}</tbody></table></div>`}
    </section>`;
}

// ---------- выбор версий (модальное окно из списка чек-листов) ----------
export function pickModalView(s, m) {
  const versions = [...s.checklists].sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version);
  const opt = (v, cur) => html`<option value="${v.id}" ${attr('selected', v.id === cur)}>${checklistLabel(v)}${v.active ? ' (активная)' : ''}</option>`;
  return html`<form data-submit="compare-switch" aria-labelledby="cmp-pick-h">
    <h3 id="cmp-pick-h">Сравнить версии чек-листа</h3>
    <label for="cmp-from">Было</label><select id="cmp-from" name="from">${versions.map((v) => opt(v, m.from))}</select>
    <label for="cmp-to">Стало</label><select id="cmp-to" name="to">${versions.map((v) => opt(v, m.to))}</select>
    <p class="err" role="alert">${m.error || ''}</p>
    <div class="row end"><button type="button" data-action="modal-close">Отмена</button><button type="submit" class="p">Сравнить</button></div>
  </form>`;
}

const setUi = (patch) => store.set((s) => ({ compareUi: { ...ui(s), ...patch } }));

export const handlers = {
  click: {
    'cmp-expand'(el) { const u = ui(store.get()); setUi({ expanded: { ...u.expanded, [el.dataset.id]: !u.expanded[el.dataset.id] } }); },
    'cmp-sort-delta'() { const u = ui(store.get()); setUi({ sort: u.sort === 'delta-asc' ? 'delta-desc' : 'delta-asc' }); },
    'cmp-retry'() { const { from, to } = store.get().route.params; loadCompare(from, to); },
    'compare-open'(el) {
      const s = store.get();
      const cur = s.checklists.find((c) => c.id === el.dataset.id);
      const fam = s.checklists.filter((c) => c.family_id === cur.family_id && c.id !== cur.id).sort((a, b) => b.version - a.version);
      const prev = fam.find((c) => c.version < cur.version) || fam[0] || s.checklists.find((c) => c.id !== cur.id);
      store.set({ modal: { type: 'compare-pick', from: prev ? prev.id : cur.id, to: cur.id } });
    },
  },
  change: {
    'cmp-only'(el) { setUi({ onlyChanged: el.checked }); },
    'cmp-sort'(el) { setUi({ sort: el.value }); },
  },
  submit: {
    'compare-switch'(form) {
      const from = form.querySelector('[name="from"]').value;
      const to = form.querySelector('[name="to"]').value;
      if (from === to) {
        const m = store.get().modal;
        if (m && m.type === 'compare-pick') store.set({ modal: { ...m, from, to, error: 'Выберите две разные версии.' } });
        else store.set({ toast: { text: 'Выберите две разные версии', tone: 'rd', at: Date.now() } });
        return;
      }
      store.set({ modal: null });
      location.hash = `#/checklists/compare/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;
    },
  },
};
