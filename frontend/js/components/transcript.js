import { html } from '../html.js';
import { icon } from '../icons.js';
import { ROLE, replicaNo } from '../results.js';
import { store } from '../store.js';
import { syncAudioUI } from '../design/interactions.js';

/** Секунды от начала для метки времени: ISO 8601 или "MM:SS" / "HH:MM:SS". null — не удалось. */
export function parseTs(ts) {
  if (typeof ts !== 'string') return null;
  if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(ts.trim())) {const parts=ts.trim().split(':').map(Number);return parts.slice(1).some(n=>n>=60)?null:parts.reduce((a,n)=>a*60+n,0);}
  // У звонков бывает 7 знаков долей секунды — оставляем 3 для надёжного разбора (сама метка не меняется).
  const t = Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(t) ? null : t / 1000;
}

/** Смещения реплик относительно первой реплики с распознаваемой меткой. */
export function offsets(transcript) {
  const abs = transcript.map((r) => parseTs(r.timestamp));
  const relative=i=>/^\d{1,2}(:\d{1,2}){1,2}$/.test(String(transcript[i].timestamp).trim());
  const base = abs.find((x,i) => x !== null&&!relative(i));
  return abs.map((x, i) => {
    if (x === null) return null;
    // MM:SS is already an audio offset; only absolute clock timestamps need a baseline.
    return relative(i) ? x : base===undefined ? null : Math.max(0,x-base);
  });
}

export const fmtOffset = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function transcriptView(conv, { from = 0, to = Infinity, highlight = { indices: [], range: null }, audio = true, query = '' } = {}) {
  const t = conv.transcript || [];
  const offs = offsets(t);
  const hasAudio = audio && !!conv.audio_url;
  const inRange = (i) => highlight.range && i >= highlight.range[0] && i <= highlight.range[1];
  const last = Math.min(t.length - 1, to);
  const list = [];
  const needle=query.trim().toLocaleLowerCase();
  const marked=text=>{const value=String(text),parts=[];let start=0,index;while(needle&&(index=value.toLocaleLowerCase().indexOf(needle,start))>=0){parts.push(html`${value.slice(start,index)}<mark>${value.slice(index,index+needle.length)}</mark>`);start=index+needle.length;}parts.push(html`${value.slice(start)}`);return parts;};
  for (let i = Math.max(0, from); i <= last; i++) {
    const r = t[i];
    if(needle&&!String(r.text).toLocaleLowerCase().includes(needle))continue;
    const role = ROLE[r.speaker] ? r.speaker : 'system';
    const hl = highlight.indices.includes(i);
    const rng = inRange(i);
    const canSeek = hasAudio && offs[i] !== null && (role === 'client' || role === 'operator');
    list.push(html`<li class="msg ${role}${hl ? ' hl' : ''}${rng ? ' rng' : ''}" id="r-${i}" tabindex="-1"
        aria-label="Реплика ${replicaNo(i)}, ${ROLE[role] || r.speaker}${hl ? ', доказательство' : ''}${rng ? ', проверенный участок' : ''}">
      <div class="bubble">
        <div class="meta"><span class="no">#${replicaNo(i)}</span><span class="role">${ROLE[role] || r.speaker}</span><time title="${r.timestamp}" aria-label="${r.timestamp}">${conv.channel==='voice call'&&offs[i]!=null?fmtOffset(offs[i]):String(r.timestamp??'').includes('T')?String(r.timestamp).split('T')[1].slice(0,8):String(r.timestamp??'')}</time>
          ${hl ? html`<span class="tag">${icon('quote')}доказательство</span>` : ''}</div>
        <p>${marked(r.text)}</p>
        ${canSeek ? html`<button type="button" class="seek" data-action="seek" data-index="${i}" aria-label="Перемотать запись к реплике ${replicaNo(i)} (${fmtOffset(offs[i])})">${icon('play')}к записи · ${fmtOffset(offs[i])}</button>` : ''}
      </div>
    </li>`);
  }
  return html`
    ${hasAudio ? html`<div class="audio"><div class="audio-head">${icon('phone')}<span>${conv.audio_kind==='test-tone'?'Синтетический аудиотест':'Запись звонка'}</span><time data-audio-time>00:00</time></div>
      <div class="audio-timeline" role="group" aria-label="Навигация по репликам звонка">${t.map((r,i)=>({r,i})).filter(({r,i})=>offs[i]!=null&&['operator','client'].includes(r.speaker)).filter((_,i,items)=>i % Math.max(1,Math.ceil(items.length/80))===0).map(({r,i})=>html`<button type="button" class="timeline-bar ${r.speaker}" style="--bar-height:${Math.min(48,10+Math.sqrt(String(r.text).length)*2)}px" data-action="seek" data-index="${i}" title="#${replicaNo(i)} · ${fmtOffset(offs[i])}" aria-label="Реплика ${replicaNo(i)}, ${fmtOffset(offs[i])}"></button>`)}</div>
      <progress data-audio-progress max="100" value="0" aria-label="Позиция воспроизведения"></progress>
      <audio id="call-audio" data-keep="audio:${conv.conversation_id}:${conv.audio_url}" src="${conv.audio_url}" controls preload="metadata"></audio>
      ${conv.audio_kind==='test-tone'?html`<p class="hint">Тестовый сигнал с секундными отметками, без речи. Проверяет плеер и перемотку; текст диалога не озвучен.</p>`:''}
      <p class="hint">Шкала реплик по транскрипту, не звуковая волна. Нажмите столбец для перехода.</p>
      <p class="audio-error" data-audio-error role="alert" hidden>Запись недоступна. Проверьте срок действия ссылки; транскрипт и доказательства доступны ниже. <button type="button" data-action="audio-retry">Повторить загрузку</button></p><p class="audio-warning" data-audio-warning role="status" hidden></p></div>` : ''}
    ${from > 0 ? html`<p class="hint center">Реплики 1–${from} скрыты</p>` : ''}
    ${needle?html`<p class="transcript-match" role="status">Найдено реплик: ${list.length}${!list.length?' · измените запрос или очистите поиск':''}</p>`:''}
    <ol class="transcript" aria-label="Транскрипт диалога">${list}</ol>
    ${last < t.length - 1 ? html`<p class="hint center">Ещё реплик после #${replicaNo(last)}: ${t.length - 1 - last}</p>` : ''}
    ${t.length === 0 ? html`<p class="hint">Транскрипт пуст.</p>` : ''}`;
}

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function focusReplicas(indices, range = null) {
  store.set({ highlight: { indices, range }, transcriptQuery:'' });
  const first = indices.length ? Math.min(...indices) : range ? range[0] : null;
  if (first === null) return;
  const el = document.getElementById(`r-${first}`);
  if (!el) return;
  el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
  // Вспышка добавляется вне разметки, поэтому последующие перерисовки её не повторяют.
  const targets = indices.length ? indices : [first];
  targets.forEach((i) => {
    const m = document.getElementById(`r-${i}`);
    if (!m) return;
    m.classList.remove('flash');
    void m.offsetWidth;
    m.classList.add('flash');
    m.addEventListener('animationend', () => m.classList.remove('flash'), { once: true });
  });
}

export function seekReplica(index) {
  const s = store.get();
  const conv = s.conversations.find((c) => c.conversation_id === s.route.params.id) || s.reviewConversations?.[s.route.params.id];
  const audio = document.getElementById('call-audio');
  if (!conv || !audio) return;
  const off = offsets(conv.transcript)[index];
  if (off == null || !Number.isFinite(off)) return;
  const seek = () => {
    try {
      const duration=Number.isFinite(audio.duration)?audio.duration:null;
      if(audio.dataset)audio.dataset.seekWarning=duration!==null&&off>duration?`Метка реплики ${replicaNo(index)} (${fmtOffset(off)}) выходит за длительность записи (${fmtOffset(duration)}). Проверьте синхронизацию транскрипта и аудио.`:'';
      audio.currentTime=duration!==null?Math.min(off,duration):off;
      syncAudioUI(audio);
    }
    catch { /* Metadata may not be ready; loadedmetadata will retry. */ }
  };
  seek();
  if (audio.readyState === 0) audio.addEventListener('loadedmetadata', seek, { once: true });
}

export const handlers = {
  click: {
    'audio-retry'(){const audio=document.getElementById('call-audio');if(audio){delete audio.dataset.seekWarning;audio.load();syncAudioUI(audio);}},
    seek(el) {
      const i = Number(el.dataset.index);
      seekReplica(i);
      focusReplicas([i]);
    },
    jump(el) {
      const indices = (el.dataset.indices || '').split(',').filter((x) => x !== '').map(Number);
      const range = el.dataset.from !== undefined ? [Number(el.dataset.from), Number(el.dataset.to)] : null;
      focusReplicas(indices, range);
      const first = indices.length ? Math.min(...indices) : range?.[0];
      if (first !== undefined) seekReplica(first);
    },
  },
};
