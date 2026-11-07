// Транскрипт: метки времени показываются как пришли; bot/system приглушены как контекст.
// Реплики адресуются индексом в массиве transcript (id="r-<индекс>"), людям показываем индекс+1.

import { html } from '../html.js';
import { ROLE, replicaNo } from '../results.js';
import { store } from '../store.js';

/** Секунды от начала для метки времени: ISO 8601 или "MM:SS" / "HH:MM:SS". null — не удалось. */
export function parseTs(ts) {
  if (typeof ts !== 'string') return null;
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(ts.trim())) return ts.trim().split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  // У звонков бывает 7 знаков долей секунды — оставляем 3 для надёжного разбора (сама метка не меняется).
  const t = Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(t) ? null : t / 1000;
}

/** Смещения реплик относительно первой реплики с распознаваемой меткой. */
export function offsets(transcript) {
  const abs = transcript.map((r) => parseTs(r.timestamp));
  const base = abs.find((x) => x !== null);
  return abs.map((x) => (x === null || base === undefined ? null : Math.max(0, x - base)));
}

const fmtOffset = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * @param conv record
 * @param opts.from / opts.to — показать только фрагмент (включительно)
 * @param opts.highlight — { indices: [], range: [from,to]|null }
 */
export function transcriptView(conv, { from = 0, to = Infinity, highlight = { indices: [], range: null }, audio = true } = {}) {
  const t = conv.transcript || [];
  const offs = offsets(t);
  const hasAudio = audio && !!conv.audio_url;
  const inRange = (i) => highlight.range && i >= highlight.range[0] && i <= highlight.range[1];
  const last = Math.min(t.length - 1, to);
  const list = [];
  for (let i = Math.max(0, from); i <= last; i++) {
    const r = t[i];
    const role = ROLE[r.speaker] ? r.speaker : 'system';
    const hl = highlight.indices.includes(i);
    const canSeek = hasAudio && offs[i] !== null && (role === 'client' || role === 'operator');
    list.push(html`<li class="msg ${role}${hl ? ' hl' : ''}${inRange(i) ? ' rng' : ''}" id="r-${i}" tabindex="-1"
        aria-label="Реплика ${replicaNo(i)}, ${ROLE[role] || r.speaker}${hl ? ', подсвечена как доказательство' : ''}">
      <div class="meta"><span class="no">#${replicaNo(i)}</span><span class="role">${ROLE[role] || r.speaker}</span><time>${r.timestamp}</time>
        ${canSeek ? html`<button type="button" class="link" data-action="seek" data-index="${i}" aria-label="Перемотать запись к реплике ${replicaNo(i)} (${fmtOffset(offs[i])})">▶ к записи · ${fmtOffset(offs[i])}</button>` : ''}
        ${hl ? html`<span class="tag">доказательство</span>` : ''}
      </div>
      <p>${r.text}</p>
    </li>`);
  }
  return html`
    ${hasAudio ? html`<div class="audio"><audio id="call-audio" data-keep="audio:${conv.conversation_id}:${conv.audio_url}" src="${conv.audio_url}" controls preload="metadata"></audio>
      <p class="mu small">Запись звонка. Кнопка «к записи» у реплики перематывает на её время от начала разговора.</p></div>` : ''}
    ${from > 0 ? html`<p class="mu small">… реплики 1–${from} скрыты</p>` : ''}
    <ol class="transcript" aria-label="Транскрипт диалога">${list}</ol>
    ${last < t.length - 1 ? html`<p class="mu small">… ещё ${t.length - 1 - last} реплик после #${replicaNo(last)}</p>` : ''}
    ${t.length === 0 ? html`<p class="mu">Транскрипт пуст.</p>` : ''}`;
}

/** Подсветить и прокрутить к реплике (используется ссылками-доказательствами). */
export function focusReplicas(indices, range = null) {
  store.set({ highlight: { indices, range } });
  const first = indices.length ? Math.min(...indices) : range ? range[0] : null;
  if (first === null) return;
  const el = document.getElementById(`r-${first}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }
}

export const handlers = {
  click: {
    seek(el) {
      const i = Number(el.dataset.index);
      const s = store.get();
      const conv = s.conversations.find((c) => c.conversation_id === s.route.params.id);
      const audio = document.getElementById('call-audio');
      if (!conv || !audio) return;
      const off = offsets(conv.transcript)[i];
      if (off === null) return;
      audio.currentTime = off;
      audio.play().catch(() => { /* автоплей может быть запрещён — позиция всё равно выставлена */ });
      focusReplicas([i]);
    },
    jump(el) {
      const indices = (el.dataset.indices || '').split(',').filter((x) => x !== '').map(Number);
      const range = el.dataset.from !== undefined ? [Number(el.dataset.from), Number(el.dataset.to)] : null;
      focusReplicas(indices, range);
    },
  },
};
