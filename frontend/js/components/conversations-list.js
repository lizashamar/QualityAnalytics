// Список диалогов: поиск, фильтры (язык, канал, статус), итог и флаг грубого нарушения.

import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import {
  LANG, CHANNEL, STATUS, latestEvaluation, finalResult, conversationStatus, checklistById, fmtScore,
} from '../results.js';
import { scoreRing, emptyState } from './ui.js';

const STATUS_TONE = { none: 'ne', evaluated: 'ok', appeal: 'wn', reviewed: 'ac' };
const STATUS_ICON = { none: 'circle', evaluated: 'check', appeal: 'clock', reviewed: 'scale' };

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

function preview(conv) {
  const first = conv.transcript.find((t) => t.speaker === 'client') || conv.transcript[0];
  if (!first) return '';
  const t = String(first.text);
  return t.length > 110 ? t.slice(0, 110) + '…' : t;
}

function cardView(s, r) {
  const c = r.conv;
  const cl = r.ev ? checklistById(s, r.ev.checklist_id) : null;
  const isCall = c.channel === 'voice call';
  const flag = r.R && r.R.final.gross_flag;
  return html`<li class="conv${flag ? ' has-flag' : ''}" data-action="open-conv" data-id="${c.conversation_id}">
    <div class="conv-main">
      <div class="conv-top">
        <span class="conv-ch ${isCall ? 'call' : ''}" title="${CHANNEL[c.channel] || c.channel}">${icon(isCall ? 'phone' : 'chat')}</span>
        <a class="conv-id" href="#/conversations/${encodeURIComponent(c.conversation_id)}">${c.conversation_id}</a>
      </div>
      <p class="conv-preview">${preview(c)}</p>
      <div class="badges">
        <span class="b ne">${c.language}</span>
        <span class="b ne">${CHANNEL[c.channel] || c.channel}</span>
        <span class="b ${STATUS_TONE[r.status]}">${icon(STATUS_ICON[r.status])}<span>${STATUS[r.status]}</span></span>
        ${flag ? html`<span class="b rd">${icon('flag')}<span>Грубое нарушение</span></span>` : ''}
        ${cl ? html`<span class="hint">v${cl.version} · ${c.transcript.length} реплик</span>` : html`<span class="hint">${c.transcript.length} реплик</span>`}
      </div>
    </div>
    <div class="conv-score">
      ${r.R ? html`${scoreRing(r.R.final.total, { key: r.ev.id, size: 'sm', label: `Итог ${c.conversation_id}` })}
        ${r.R.changed ? html`<span class="hint was" title="Исходная оценка">было ${fmtScore(r.ev.total)}</span>` : ''}`
        : html`<span class="ring-empty" aria-label="Не оценён">—</span>`}
    </div>
  </li>`;
}

export function view(s) {
  const f = s.filters;
  const all = rowsFor(s);
  const rows = all.filter((r) => matches(f, r));
  const langs = [...new Set(s.conversations.map((c) => c.language))];
  const channels = [...new Set(s.conversations.map((c) => c.channel))];
  const opt = (v, label, cur) => html`<option value="${v}" ${attr('selected', v === cur)}>${label}</option>`;
  const filtered = f.q || f.language || f.channel || f.status;

  return html`
    <div class="page-head"><div><h2>Диалоги</h2>
      <p class="sub">Откройте диалог, чтобы увидеть оценку, доказательства и оспорить результат.</p></div></div>
    <div class="filters card" role="search">
      <div class="search">${icon('search')}<label class="sr" for="f-q">Поиск</label>
        <input id="f-q" type="search" placeholder="Поиск по ID и тексту реплик" value="${f.q}" data-input="filter" data-key="q"></div>
      <label class="sr" for="f-lang">Язык</label>
      <select id="f-lang" data-change="filter" data-key="language">${opt('', 'Все языки', f.language)}${langs.map((l) => opt(l, `${LANG[l] || l} (${l})`, f.language))}</select>
      <label class="sr" for="f-ch">Канал</label>
      <select id="f-ch" data-change="filter" data-key="channel">${opt('', 'Чаты и звонки', f.channel)}${channels.map((c) => opt(c, CHANNEL[c] || c, f.channel))}</select>
      <label class="sr" for="f-st">Статус оценки</label>
      <select id="f-st" data-change="filter" data-key="status">${opt('', 'Любой статус', f.status)}${Object.entries(STATUS).map(([k, v]) => opt(k, v, f.status))}${opt('flag', 'С грубым нарушением', f.status)}</select>
      ${filtered ? html`<button type="button" class="ghost" data-action="filter-reset">${icon('x')}Сбросить</button>` : ''}
    </div>
    <p class="hint" aria-live="polite">Показано ${rows.length} из ${all.length}</p>
    ${rows.length
      ? html`<ul class="conv-list" aria-label="Список диалогов">${rows.map((r) => cardView(s, r))}</ul>`
      : html`<div class="card">${emptyState('search', 'Ничего не найдено', 'Нет диалогов под эти фильтры.',
          filtered ? html`<button type="button" data-action="filter-reset">Сбросить фильтры</button>` : '')}</div>`}`;
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
