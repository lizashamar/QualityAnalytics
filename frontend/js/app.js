// Точка входа: hash-роутер, отрисовка, делегирование событий (без inline-обработчиков —
// совместимо с CSP в Dynamics 365), модальные окна, уведомления, тема.

import { config } from './config.js';
import { store } from './store.js';
import { html } from './html.js';
import { loadAll, ensureEvaluation } from './actions.js';
import { activeChecklist } from './results.js';
import { icon } from './icons.js';
import { skeleton, emptyState } from './components/ui.js';
import * as overview from './components/overview.js';
import * as list from './components/conversations-list.js';
import * as card from './components/conversation-card.js';
import * as transcript from './components/transcript.js';
import * as appeals from './components/appeals.js';
import * as editor from './components/checklist-editor.js';

// ---------- обработчики ----------
const H = { click: {}, input: {}, change: {}, submit: {} };
for (const m of [overview, list, card, transcript, appeals, editor]) {
  for (const k of Object.keys(H)) Object.assign(H[k], (m.handlers && m.handlers[k]) || {});
}
H.click['modal-close'] = () => store.set({ modal: null });
H.click['skip'] = () => document.getElementById('main').focus(); // не трогаем hash — он занят роутером
H.click['retry'] = () => { store.set({ ready: false, error: null }); loadAll().then(onRoute); };
H.click['theme'] = () => {
  const order = ['auto', 'light', 'dark'];
  const theme = order[(order.indexOf(store.get().theme) + 1) % order.length];
  try { localStorage.setItem('cqa.theme', theme); } catch { /* ignore */ }
  store.set({ theme });
};

const run = (fn, ...args) => {
  try { const r = fn(...args); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); }
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && H.click[el.dataset.action] && !el.disabled) run(H.click[el.dataset.action], el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el && H.input[el.dataset.input]) run(H.input[el.dataset.input], el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && H.change[el.dataset.change]) run(H.change[el.dataset.change], el, e);
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-submit]');
  if (!form) return;
  e.preventDefault();
  if (H.submit[form.dataset.submit]) run(H.submit[form.dataset.submit], form, e);
});

// ---------- роутер ----------
function parse(hash) {
  const p = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (p[0] === 'overview') return { name: 'overview', params: {} };
  if (p[0] === 'conversations' && p[1]) return { name: 'conversation', params: { id: p[1] } };
  if (p[0] === 'appeals' && p[1]) return { name: 'review', params: { id: p[1] } };
  if (p[0] === 'appeals') return { name: 'appeals', params: {} };
  if (p[0] === 'checklists' && p[1] && p[2] === 'edit') return { name: 'editor', params: { id: p[1] } };
  if (p[0] === 'checklists') return { name: 'checklists', params: {} };
  return { name: 'conversations', params: {} };
}

let routeChanged = false;
function onRoute() {
  const s = store.get();
  const route = parse(location.hash);
  const prev = s.route;
  const patch = { route, modal: null };
  if (route.name === 'conversation' && (prev.name !== 'conversation' || prev.params.id !== route.params.id)) {
    patch.highlight = { indices: [], range: null };
    patch.cardChecklistId = null;
  }
  if (route.name === 'review') {
    const ap = s.appeals.find((a) => a.id === route.params.id);
    if (ap && (!s.review || s.review.appealId !== ap.id)) patch.review = { appealId: ap.id, answer: ap.original_answer, reason: '' };
    if (ap) ensureEvaluation(ap.evaluation_id);
  }
  if (route.name === 'editor' && s.ready) {
    const id = route.params.id;
    const want = id === 'new' ? null : id;
    if (!s.draft || s.draft.based_on !== want || (id === 'new' && s.draft.family_id)) {
      patch.draft = editor.newDraft(id === 'new' ? null : s.checklists.find((c) => c.id === id) || activeChecklist(s));
    }
  }
  routeChanged = route.name !== prev.name || JSON.stringify(route.params) !== JSON.stringify(prev.params);
  store.set(patch);
}
window.addEventListener('hashchange', onRoute);

// ---------- отрисовка ----------
const NAV = [
  ['conversations', '#/conversations', 'Диалоги', 'chat'],
  ['appeals', '#/appeals', 'Апелляции', 'scale'],
  ['checklists', '#/checklists', 'Чек-лист', 'doc'],
  ['overview', '#/overview', 'Обзор', 'sparkle'],
];
const NAV_OF = { conversation: 'conversations', review: 'appeals', editor: 'checklists' };
const THEME_LABEL = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };
const THEME_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

function navView(s) {
  const cur = NAV_OF[s.route.name] || s.route.name;
  const pending = s.appeals.filter((a) => a.status === 'pending').length;
  return html`
    <div class="hdr-top">
      <div class="brand"><b>CQA · Анализ качества диалогов</b><span>Freedom Broker × NU Data Challenge</span></div>
      <div class="hdr-tools">
        <span class="b ${config.USE_MOCK ? 'wn' : 'ok'} mode" title="${config.USE_MOCK ? 'Данные симулируются в браузере' : config.API_BASE}">${icon(config.USE_MOCK ? 'info' : 'check')}<span>${config.USE_MOCK ? 'Демо-режим (mock)' : 'API подключён'}</span></span>
        <button type="button" class="icon-btn theme" data-action="theme" aria-label="${THEME_LABEL[s.theme]}. Переключить тему" title="${THEME_LABEL[s.theme]}">${icon(THEME_ICON[s.theme])}</button>
      </div>
    </div>
    <nav class="tabs" aria-label="Разделы"><ul>${NAV.map(([k, href, label, ic]) => html`<li><a href="${href}" ${k === cur ? html`aria-current="page" class="on"` : ''}>
      ${icon(ic)}<span>${label}</span>${k === 'appeals' && pending ? html`<span class="count" aria-label="${pending} на рассмотрении">${pending}</span>` : ''}</a></li>`)}</ul></nav>`;
}

function loadingView() {
  return html`<div aria-busy="true" aria-label="Загрузка"><div class="page-head"><div><span class="sk-title"></span></div></div>
    <div class="conv-list">${[1, 2, 3, 4].map(() => html`<div class="card">${skeleton(3)}</div>`)}</div></div>`;
}

function mainView(s) {
  if (!s.ready) return loadingView();
  if (s.error) return html`<section class="card">${emptyState('alert', 'Не удалось загрузить данные', s.error,
    html`<p class="hint">API: ${config.API_BASE || '(не задан)'}</p><button type="button" class="p" data-action="retry">${icon('refresh')}Повторить</button>`)}</section>`;
  switch (s.route.name) {
    case 'overview': return overview.view(s);
    case 'conversation': return card.view(s);
    case 'appeals': return appeals.listView(s);
    case 'review': return appeals.reviewView(s);
    case 'checklists': return editor.listView(s);
    case 'editor': return editor.editorView(s);
    default: return list.view(s);
  }
}

function modalView(s, m) {
  if (m.type === 'appeal') return appeals.appealModalView(s, m);
  if (m.type === 'criterion') return editor.criterionModalView(s, m);
  if (m.type === 'apply') return editor.applyModalView(s, m);
  return html``;
}

const $root = document.getElementById('app');
const $nav = document.getElementById('nav');
const $main = document.getElementById('main');
const $dialog = document.getElementById('modal');
const $toast = document.getElementById('toast');
let lastModal = null;
let lastApplying = null;
let opener = null;

function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.id || a === document.body) return null;
  const f = { id: a.id };
  try { f.start = a.selectionStart; f.end = a.selectionEnd; } catch { /* не текстовое поле */ }
  return f;
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  if (typeof f.start === 'number') { try { el.setSelectionRange(f.start, f.end); } catch { /* ignore */ } }
}

function render(s) {
  const focus = captureFocus();
  // Тема ставится на корень компонента (.cqa-app), а не на документ — не трогаем страницу-хост в D365.
  if (s.theme === 'auto') delete $root.dataset.theme; else $root.dataset.theme = s.theme;

  $nav.innerHTML = String(navView(s));
  // Элементы с data-keep (аудиоплеер) переживают перерисовку: позиция и воспроизведение не сбрасываются.
  const keep = new Map([...$main.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el]));
  $main.innerHTML = String(mainView(s));
  $main.querySelectorAll('[data-keep]').forEach((el) => {
    const old = keep.get(el.dataset.keep);
    if (old) el.replaceWith(old);
  });

  // Модальное окно перерисовывается только при смене объекта modal (не теряет ввод).
  const m = s.modal;
  if (m !== lastModal || (m && m.type === 'apply' && s.applying !== lastApplying)) {
    const opening = m && !lastModal;
    lastModal = m;
    lastApplying = s.applying;
    if (m) {
      const dlgFocus = opening ? null : captureFocus();
      if (opening) opener = focus;
      $dialog.innerHTML = String(modalView(s, m));
      if (!$dialog.open) $dialog.showModal();
      if (opening) $dialog.querySelector('input:not([type=hidden]),select,textarea,button')?.focus();
      else restoreFocus(dlgFocus);
    } else {
      if ($dialog.open) $dialog.close();
      $dialog.innerHTML = '';
      restoreFocus(opener);
      opener = null;
    }
  }

  $toast.className = s.toast ? `toast show ${s.toast.tone || ''}` : 'toast';
  $toast.textContent = s.toast ? s.toast.text : '';

  if (routeChanged) {
    routeChanged = false;
    window.scrollTo(0, 0);
    $main.querySelector('h2')?.setAttribute('tabindex', '-1');
    $main.querySelector('h2')?.focus({ preventScroll: true });
  } else if (!m) {
    restoreFocus(focus);
  }
}

$dialog.addEventListener('close', () => { if (store.get().modal) store.set({ modal: null }); });

// ---------- запуск ----------
let theme = 'auto';
try { theme = localStorage.getItem('cqa.theme') || 'auto'; } catch { /* ignore */ }
store.set({ config, theme }, { silent: true });
store.subscribe(render);
onRoute();
loadAll().then(onRoute);
