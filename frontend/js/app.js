import { config } from './config.js';
import { store } from './store.js';
import { html } from './html.js';
import { loadAll, ensureReviewContext } from './actions.js';
import { activeChecklist } from './results.js';
import { icon } from './icons.js';
import { skeleton, emptyState } from './components/ui.js';
import * as overview from './components/overview.js';
import * as list from './components/conversations-list.js';
import * as card from './components/conversation-card.js';
import * as transcript from './components/transcript.js';
import * as appeals from './components/appeals.js';
import * as editor from './components/checklist-editor.js';
import * as compareView from './components/compare-view.js';
import { loadCompare } from './actions.js';
import { readExplorerQuery, explorerHref } from './design/explorer.js';
import { commandView, installWorkspaceInteractions, refreshAudioUI } from './design/interactions.js';

const H = { click: {}, input: {}, change: {}, submit: {} };
for (const m of [overview, list, card, transcript, appeals, editor, compareView]) {
  for (const k of Object.keys(H)) Object.assign(H[k], (m.handlers && m.handlers[k]) || {});
}
H.click['command-open'] = () => store.set({modal:{type:'command',query:''}});
H.input['command-query'] = (el) => store.set({modal:{...store.get().modal,query:el.value}});
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

function parse(hash) {
  const path = hash.split('?')[0];
  let p;
  try { p = path.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); } catch { return { name:'notfound', params:{} }; }
  if (!p.length) return { name: 'overview', params: {} };
  if (p[0] === 'overview') return { name: 'overview', params: {} };
  if (p[0] === 'conversations' && p[1]) return { name: 'conversation', params: { id: p[1] } };
  if (p[0] === 'appeals' && p[1]) return { name: 'review', params: { id: p[1] } };
  if (p[0] === 'appeals') return { name: 'appeals', params: {} };
  if (p[0] === 'checklists' && p[1] === 'compare' && p[2] && p[3]) return { name: 'compare', params: { from: p[2], to: p[3] } };
  if (p[0] === 'checklists' && p[1] && p[2] === 'edit') return { name: 'editor', params: { id: p[1] } };
  if (p[0] === 'checklists') return { name: 'checklists', params: {} };
  if (p[0] === 'conversations') return { name:'conversations', params:{} };
  return { name:'notfound', params:{} };
}

let routeChanged = false;
let lastHash = location.hash;
const draftStamp = d => JSON.stringify(d && [d.name,d.description,d.criteria,d.activate]);
const draftDirty = s => s.draft && s.draftBaseline && draftStamp(s.draft)!==s.draftBaseline;
window.addEventListener('beforeunload',e=>{if(store.get().route.name==='editor'&&draftDirty(store.get())){e.preventDefault();e.returnValue='';}});
function onRoute() {
  const s = store.get();
  const route = parse(location.hash);
  const prev = s.route;
  if(prev.name==='editor'&&(route.name!=='editor'||route.params.id!==prev.params.id)&&draftDirty(s)&&!window.confirm('В чек-листе есть несохранённые изменения. Покинуть редактор?')) {
    history.replaceState(null,'',lastHash); return;
  }
  lastHash=location.hash;
  const patch = { route, modal: null };
  if (route.name === 'conversations' && location.hash.includes('?')) {
    patch.filters = readExplorerQuery(location.hash.split('?')[1]);
    const sort = new URLSearchParams(location.hash.split('?')[1]).get('sort');
    patch.explorerSort = ['score-asc','score-desc','id'].includes(sort) ? sort : 'recent';
    patch.explorerPage = 1;
  }
  if (route.name === 'conversation' && (prev.name !== 'conversation' || prev.params.id !== route.params.id)) {
    patch.highlight = { indices: [], range: null };
    patch.cardChecklistId = null;
    patch.transcriptQuery='';
    patch.criteriaFilter='all';
  }
  if (route.name === 'review') {
    const ap = s.appeals.find((a) => a.id === route.params.id);
    if (ap && (!s.review || s.review.appealId !== ap.id)) patch.review = { appealId: ap.id, answer: ap.original_answer, reason: '' };

  }
  if (route.name === 'editor' && s.ready) {
    const id = route.params.id;
    const want = id === 'new' ? null : id;
    if (!s.draft || s.draft.based_on !== want || (id === 'new' && s.draft.family_id)) {
      const base=s.checklists.find(c=>c.id===id);
      if(id!=='new'&&!base) { patch.route={name:'notfound',params:{}}; }
      else {patch.draft = editor.newDraft(id === 'new' ? null : base); patch.draftBaseline=draftStamp(patch.draft);}
    }
  }
  routeChanged = route.name !== prev.name || JSON.stringify(route.params) !== JSON.stringify(prev.params);
  store.set(patch);
  if (route.name === 'review') ensureReviewContext(route.params.id);
  if (route.name === 'compare' && s.ready) {
    const c = s.compare;
    if (!c || c.from !== route.params.from || c.to !== route.params.to || (!c.loading && !c.data && !c.error)) loadCompare(route.params.from, route.params.to);
  }
}
window.addEventListener('hashchange', onRoute);

const NAV = [
  ['overview', '#/overview', 'Обзор', 'sparkle'],
  ['conversations', '#/conversations', 'Диалоги', 'chat'],
  ['appeals', '#/appeals', 'Апелляции', 'scale'],
  ['checklists', '#/checklists', 'Чек-листы', 'doc'],
];
const NAV_OF = { conversation: 'conversations', review: 'appeals', editor: 'checklists', compare: 'checklists' };
const THEME_LABEL = { auto: 'Тема: как в системе', light: 'Тема: светлая', dark: 'Тема: тёмная' };
const THEME_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

function navView(s) {
  const cur = NAV_OF[s.route.name] || s.route.name;
  const pending = s.appeals.filter((a) => a.status === 'pending').length;
  return html`<div class="hdr-inner">
    <a class="brand" href="#/overview" aria-label="CQA — обзор"><span class="brand-symbol">${icon('sparkle')}</span><span><b>CQA<span class="brand-period">.</span></b><small>Conversation intelligence</small></span></a>
    <div class="workspace-label"><span class="workspace-avatar">F</span><span><b>Freedom workspace</b><small>Контроль качества</small></span></div>
    <span class="nav-section-label">Рабочее пространство</span>
    <nav class="tabs" aria-label="Разделы"><ul>${NAV.map(([k, href, label, ic]) => html`<li><a href="${href}" ${k === cur ? html`aria-current="page" class="on"` : ''}>
      ${icon(ic)}<span>${label}</span>${k === 'appeals' && pending ? html`<span class="count" aria-label="${pending} на рассмотрении">${pending}</span>` : ''}</a></li>`)}</ul></nav>
    <div class="sidebar-context"><b>Доказательства за каждой оценкой</b><p>Диалоги, критерии и решения в одном пространстве.</p><span>RU · KZ · EN</span></div>
    <div class="hdr-tools"><span class="connection-status"><i class="status-dot ${s.error?'status-error':''}"></i>${config.USE_MOCK ? 'Демо-данные' : !s.ready ? 'Подключение…' : s.error ? 'Нет подключения' : 'API подключён'}</span>
      <button type="button" class="icon-btn theme" data-action="theme" aria-label="${THEME_LABEL[s.theme]}. Переключить тему" title="${THEME_LABEL[s.theme]}">${icon(THEME_ICON[s.theme])}</button>
    </div><div class="sidebar-footer">Conversation Quality Analytics</div>
  </div>`;
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
    case 'compare': return compareView.view(s);
    case 'conversations': return list.view(s);
    default: return html`<div class="page-head"><h2>Страница не найдена</h2></div><section class="card">${emptyState('inbox','Такой страницы нет','Перейдите к обзору или откройте список диалогов.',html`<a class="btn p" href="#/overview">Открыть обзор</a>`)}</section>`;
  }
}

function modalView(s, m) {
  if (m.type === 'command') return commandView(s,m);
  if (m.type === 'appeal') return appeals.appealModalView(s, m);
  if (m.type === 'criterion') return editor.criterionModalView(s, m);
  if (m.type === 'apply') return editor.applyModalView(s, m);
  if (m.type === 'compare-pick') return compareView.pickModalView(s, m);
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

// Stable semantic identity preserves focus through state updates, including controls without IDs.
function focusKey(el) {
  if (el.id) return `id:${el.id}`;
  const parent = el.parentElement?.closest('[id], [data-criterion-index], form[data-submit]');
  const identity = [...el.attributes].filter(a => a.name.startsWith('data-') || ['name','href','type','data-submit'].includes(a.name)).map(a => [a.name,a.value]);
  if (el.matches('input[type=radio],input[type=checkbox]')) identity.push(['value',el.value]);
  if (!identity.length) identity.push(['label',el.getAttribute('aria-label')||el.textContent]);
  return JSON.stringify([el.tagName, parent?.id || parent?.dataset.criterionIndex || parent?.dataset.submit,identity]);
}
function captureFocus() {
  const a = document.activeElement;
  if (!a || !$root.contains(a) || a === $main) return null;
  const f = { key:focusKey(a) };
  try { f.start=a.selectionStart; f.end=a.selectionEnd; } catch { /* not a text input */ }
  return f;
}
function restoreFocus(f) {
  if (!f) return;
  const el = [...$root.querySelectorAll('button,input,select,textarea,a,summary,[tabindex]')].find(el=>focusKey(el)===f.key);
  if (!el || el === document.activeElement || el.disabled) return;
  el.focus({preventScroll:true});
  if (typeof f.start === 'number') { try { el.setSelectionRange(f.start,f.end); } catch { /* not a text input */ } }
}
let previousNav = '', previousMain = '';

function render(s) {
  const focus = captureFocus();
  // Тема ставится на корень компонента (.cqa-app), а не на документ — не трогаем страницу-хост в D365.
  if (s.theme === 'auto') delete $root.dataset.theme; else $root.dataset.theme = s.theme;

  const nextNav = String(navView(s));
  if (nextNav !== previousNav) { $nav.innerHTML = nextNav; previousNav = nextNav; }
  // Элементы с data-keep (аудиоплеер) переживают перерисовку: позиция и воспроизведение не сбрасываются.
  const keep = new Map([...$main.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el]));
  const sectionLabel = NAV.find(([k]) => k === (NAV_OF[s.route.name] || s.route.name))?.[2] || 'Диалоги';
  const contextHref = explorerHref(s.filters,s.explorerSort);
  const nextMain = String(html`<div class="workspace-topbar"><div><span>Рабочее пространство</span>${icon('arrowRight')}<a href="${s.route.name==='conversation'?contextHref:s.route.name==='review'?'#/appeals':s.route.name==='editor'?'#/checklists':'#/'+(NAV_OF[s.route.name]||s.route.name)}">${sectionLabel}</a>${['conversation','review','editor'].includes(s.route.name)?html`${icon('arrowRight')}<b>${s.route.name==='conversation'?s.route.params.id:s.route.name==='review'?'Рассмотрение':'Редактор'}</b>`:''}</div><button type="button" class="command-trigger" data-action="command-open" aria-label="Быстрый переход">${icon('search')}<span>Быстрый переход</span><kbd>⌘ K</kbd></button></div><div class="page-content">${mainView(s)}</div>`);
  if (nextMain !== previousMain) {
    const openDetails = !routeChanged ? [...$main.querySelectorAll('details[open]')].map(el=>[el.className,el.closest('[id]')?.id]) : [];
    const transcriptScroll = $main.querySelector('.transcript-card')?.scrollTop || 0;
    $main.innerHTML = nextMain;
    previousMain = nextMain;
    for (const el of $main.querySelectorAll('details')) if (openDetails.some(([name,id])=>name===el.className&&id===el.closest('[id]')?.id)) el.open=true;
    const transcriptPanel=$main.querySelector('.transcript-card');
    if(transcriptPanel&&!routeChanged) transcriptPanel.scrollTop=transcriptScroll;
  }
  $main.querySelectorAll('[data-keep]').forEach((el) => {
    const old = keep.get(el.dataset.keep);
    if (old) el.replaceWith(old);
  });

  refreshAudioUI($main);

  // Модальное окно перерисовывается только при смене объекта modal (не теряет ввод).
  const m = s.modal;
  if (m !== lastModal || (m && m.type === 'apply' && s.applying !== lastApplying)) {
    const opening = m && !lastModal;
    lastModal = m;
    lastApplying = s.applying;
    if (m) {
      const dlgFocus = opening ? null : captureFocus();
      if (opening) opener = focus;
      $dialog.dataset.kind = m.type;
      $dialog.getAnimations().forEach(animation => animation.cancel());
      $dialog.setAttribute('aria-label', m.type === 'command' ? 'Быстрый переход' : m.type === 'criterion' ? 'Редактирование критерия' : m.type === 'appeal' ? 'Подать апелляцию' : m.type === 'compare-pick' ? 'Сравнить версии чек-листа' : 'Массовая оценка');
      $dialog.innerHTML = String(modalView(s, m));
      if (!$dialog.open) $dialog.showModal();
      if (opening) $dialog.querySelector('input:not([type=hidden]),select,textarea,button')?.focus();
      else restoreFocus(dlgFocus);
    } else {
      const close = () => {
        if (store.get().modal) return;
        if ($dialog.open) $dialog.close();
        $dialog.innerHTML = '';
        restoreFocus(opener);
        opener = null;
      };
      if ($dialog.open && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        $dialog.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.96)'}],
          {duration:150,easing:'cubic-bezier(.22,1,.36,1)'}).finished.then(close, () => {});
      } else close();
    }
  }

  $toast.className = s.toast ? `toast show ${s.toast.tone || ''}` : 'toast';
  $toast.textContent = s.toast ? s.toast.text : '';

  const selectVisible=$main.querySelector('#select-visible');
  if(selectVisible&&!selectVisible.checked){const checks=[...$main.querySelectorAll('.conv-select')]; selectVisible.indeterminate=checks.some(el=>el.checked);}
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

let theme = 'auto';
try { theme = localStorage.getItem('cqa.theme') || 'auto'; } catch { /* ignore */ }
store.set({ config, theme }, { silent: true });
installWorkspaceInteractions($root);
store.subscribe(render);
onRoute();
loadAll().then(onRoute);
