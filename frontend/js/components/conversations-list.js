// Список диалогов: поиск, фильтры (язык, канал, статус), итог и флаг грубого нарушения.

import { html, attr } from '../html.js';
import { store } from '../store.js';
import {
  LANG, CHANNEL, STATUS, latestEvaluation, finalResult, conversationStatus, scoreBadge, checklistById,
} from '../results.js';

const STATUS_TONE = { none: 'ne', evaluated: 'ok', appeal: 'wn', reviewed: 'ac' };

export function rowsFor(s) {
  return s.conversations.map((conv) => {
    const ev = latestEvaluation(s, conv.conversation_id);
    const R = ev ? finalResult(s, ev) : null;
    return { conv, ev, R, status: conversationStatus(s, conv.conversation_id) };
  });
}

function matches(f, r) {
  const c = r.conv;
  if (f.language && c.language !== f.language) return false;
  if (f.channel && c.channel !== f.channel) return false;
  if (f.status === 'flag') { if (!(r.R && r.R.final.gross_flag)) return false; }
  else if (f.status && r.status !== f.status) return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return c.conversation_id.toLowerCase().includes(q) || c.transcript.some((t) => String(t.text).toLowerCase().includes(q));
}

export function view(s) {
  const f = s.filters;
  const all = rowsFor(s);
  const rows = all.filter((r) => matches(f, r));
  const langs = [...new Set(s.conversations.map((c) => c.language))];
  const channels = [...new Set(s.conversations.map((c) => c.channel))];
  const opt = (v, label, cur) => html`<option value="${v}" ${attr('selected', v === cur)}>${label}</option>`;

  return html`
    <h2>Диалоги</h2>
    <p class="sub">Откройте диалог, чтобы увидеть оценку, доказательства и оспорить результат.</p>
    <div class="row filters" role="search">
      <label class="sr" for="f-q">Поиск</label>
      <input id="f-q" type="search" placeholder="Поиск по ID и тексту реплик" value="${f.q}" data-input="filter" data-key="q">
      <label class="sr" for="f-lang">Язык</label>
      <select id="f-lang" data-change="filter" data-key="language">${opt('', 'Все языки', f.language)}${langs.map((l) => opt(l, `${LANG[l] || l} (${l})`, f.language))}</select>
      <label class="sr" for="f-ch">Канал</label>
      <select id="f-ch" data-change="filter" data-key="channel">${opt('', 'Чаты и звонки', f.channel)}${channels.map((c) => opt(c, CHANNEL[c] || c, f.channel))}</select>
      <label class="sr" for="f-st">Статус оценки</label>
      <select id="f-st" data-change="filter" data-key="status">${opt('', 'Любой статус', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v, f.status))}${opt('flag', 'С грубым нарушением', f.status)}</select>
      ${f.q || f.language || f.channel || f.status ? html`<button type="button" data-action="filter-reset">Сбросить</button>` : ''}
    </div>
    <p class="mu small" aria-live="polite">Показано ${rows.length} из ${all.length}</p>
    <div class="card tw">
      <table>
        <caption class="sr">Список диалогов</caption>
        <thead><tr><th scope="col">ID</th><th scope="col">Язык</th><th scope="col">Канал</th><th scope="col">Реплик</th>
          <th scope="col">Статус</th><th scope="col">Итог</th><th scope="col">Грубое нарушение</th><th scope="col">Чек-лист</th></tr></thead>
        <tbody>
        ${rows.map((r) => {
          const cl = r.ev ? checklistById(s, r.ev.checklist_id) : null;
          return html`<tr class="c" data-action="open-conv" data-id="${r.conv.conversation_id}">
            <td><a href="#/conversations/${encodeURIComponent(r.conv.conversation_id)}"><b>${r.conv.conversation_id}</b></a></td>
            <td>${r.conv.language}</td>
            <td>${CHANNEL[r.conv.channel] || r.conv.channel}</td>
            <td>${r.conv.transcript.length}</td>
            <td><span class="b ${STATUS_TONE[r.status]}">${STATUS[r.status]}</span></td>
            <td>${r.R ? html`${scoreBadge(r.R.final.total)}${r.R.changed ? html` <span class="mu small" title="Исходная оценка">было ${r.ev.total ?? '—'}</span>` : ''}` : '—'}</td>
            <td>${r.R ? (r.R.final.gross_flag ? html`<span class="b rd">⚠ Выявлено</span>` : html`<span class="mu">не выявлено</span>`) : ''}</td>
            <td class="mu small">${cl ? `v${cl.version}` : ''}</td>
          </tr>`;
        })}
        ${rows.length ? '' : html`<tr><td colspan="8" class="mu">Нет диалогов под эти фильтры.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

export const handlers = {
  input: {
    filter(el) { store.set((s) => ({ filters: { ...s.filters, [el.dataset.key]: el.value } })); },
  },
  change: {
    filter(el) { store.set((s) => ({ filters: { ...s.filters, [el.dataset.key]: el.value } })); },
  },
  click: {
    'filter-reset'() { store.set({ filters: { q: '', language: '', channel: '', status: '' } }); },
    'open-conv'(el, ev) {
      if (ev.target.closest('a')) return; // ссылка сама сменит hash
      location.hash = `#/conversations/${encodeURIComponent(el.dataset.id)}`;
    },
  },
};
