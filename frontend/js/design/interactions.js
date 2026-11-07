import { html } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';

const routes=[['Обзор','Аналитика и качество','#/overview','sparkle'],['Диалоги','Поиск, оценка и доказательства','#/conversations','chat'],['Апелляции','Очередь и решения проверяющего','#/appeals','scale'],['Чек-листы','Критерии и версии','#/checklists','doc']];
export function commandView(s,m) {
  const q=(m.query||'').trim().toLowerCase();
  const items=routes.filter(r=>r.slice(0,2).join(' ').toLowerCase().includes(q));
  const conversations=q?s.conversations.filter(c=>c.conversation_id.toLowerCase().includes(q)).slice(0,5):[];
  return html`<div class="command-palette"><div class="command-search">${icon('search')}<input id="command-query" data-input="command-query" value="${m.query||''}" placeholder="Раздел или ID диалога" aria-label="Поиск раздела или диалога"><button type="button" class="ghost" data-action="modal-close">Esc</button></div><h3 class="sr">Быстрый переход</h3><div class="command-results">${items.map(([title,desc,href,ic])=>html`<a href="${href}" data-command-link>${icon(ic)}<span><b>${title}</b><small>${desc}</small></span>${icon('arrowRight')}</a>`)}${conversations.map(c=>html`<a href="#/conversations/${encodeURIComponent(c.conversation_id)}" data-command-link>${icon('chat')}<span><b>${c.conversation_id}</b><small>${c.language} · ${c.transcript.length} реплик</small></span>${icon('arrowRight')}</a>`)}${!items.length&&!conversations.length?html`<p class="hint">Ничего не найдено</p>`:''}</div><p class="command-footer">↑ ↓ выбор · Enter переход · Esc закрыть</p></div>`;
}

export function moveCriterion(criteria,from,to) {
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=criteria.length||to>=criteria.length) return criteria;
  const result=[...criteria], [item]=result.splice(from,1);result.splice(to,0,item);return result;
}

export function installWorkspaceInteractions(root) {
  document.addEventListener('keydown',e=>{
    const commandKey=['ArrowDown','ArrowUp'].includes(e.key)||!e.target.matches('input,textarea')&&['Home','End'].includes(e.key);
    if(store.get().modal?.type==='command'&&commandKey){const links=[...root.querySelectorAll('[data-command-link]')];if(links.length){e.preventDefault();const index=links.indexOf(document.activeElement);const target=e.key==='Home'?0:e.key==='End'?links.length-1:index<0?(e.key==='ArrowUp'?links.length-1:0):(index+(e.key==='ArrowUp'?-1:1)+links.length)%links.length;links[target].focus();}}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();store.set({modal:store.get().modal?.type==='command'?null:{type:'command',query:''}});}
  });
  root.addEventListener('click',e=>{if(e.target.closest('[data-command-link]'))store.set({modal:null});});
  let from=null;
  root.addEventListener('dragstart',e=>{
    const handle=e.target.closest('[data-drag-criterion]');if(!handle)return;
    from=Number(handle.dataset.dragCriterion);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(from));handle.closest('.ed-item')?.classList.add('is-dragging');
  });
  root.addEventListener('dragover',e=>{if(from!==null&&e.target.closest('[data-criterion-index]')){e.preventDefault();e.dataTransfer.dropEffect='move';}});
  root.addEventListener('drop',e=>{
    const target=e.target.closest('[data-criterion-index]');if(from===null||!target)return;e.preventDefault();
    const draft=store.get().draft;if(draft)store.set({draft:{...draft,criteria:moveCriterion(draft.criteria,from,Number(target.dataset.criterionIndex))}});from=null;
  });
  root.addEventListener('dragend',()=>{from=null;root.querySelectorAll('.is-dragging').forEach(el=>el.classList.remove('is-dragging'));});
  for(const event of ['timeupdate','loadedmetadata','durationchange','seeked','emptied','error']) root.addEventListener(event,e=>{if(e.target.id==='call-audio')syncAudioUI(e.target);},true);
}

/** Native media nodes survive state renders; synchronize their freshly rendered context. */
export function syncAudioUI(audio) {
  const panel=audio.closest?.('.audio');if(!panel)return;
  const duration=Number.isFinite(audio.duration)?audio.duration:0;
  const progress=panel.querySelector('[data-audio-progress]');if(progress)progress.value=duration?audio.currentTime/duration*100:0;
  const clock=panel.querySelector('[data-audio-time]');if(clock)clock.textContent=`${Math.floor(audio.currentTime/60).toString().padStart(2,'0')}:${Math.floor(audio.currentTime%60).toString().padStart(2,'0')}`;
  const error=panel.querySelector('[data-audio-error]');if(error)error.hidden=!audio.error;
  const warning=panel.querySelector('[data-audio-warning]');if(warning){warning.textContent=audio.dataset.seekWarning||'';warning.hidden=!audio.dataset.seekWarning;}
}
export function refreshAudioUI(root) { root.querySelectorAll('#call-audio').forEach(syncAudioUI); }
