import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { LANG, CHANNEL, activeChecklist, checklistLabel, fmtScore, fmtDate, scoreTone } from '../results.js';
import { rowsFor } from './conversations-list.js';
import { meter, emptyState } from './ui.js';
import { distribution, trendChart } from '../design/analytics.js';
import { explorerHref, sortRows } from '../design/explorer.js';
import { resetDemo, toast, fail } from '../actions.js';

export function view(s) {
  const scope = s.overviewFilters || {language:'',channel:''};
  const rows = rowsFor(s).filter(r=>(!scope.language||r.conv.language===scope.language)&&(!scope.channel||r.conv.channel===scope.channel));
  const done = rows.filter(r=>r.R), totals = done.map(r=>r.R.final.total).filter(t=>t!=null);
  const avg = totals.length?totals.reduce((a,b)=>a+b,0)/totals.length:null;
  const flagged = done.filter(r=>r.R.final.gross_flag), low = done.filter(r=>r.R.final.total!=null&&r.R.final.total<60);
  const pending = s.appeals.filter(a=>a.status==='pending').length, act = activeChecklist(s), buckets = distribution(done);
  const attention = sortRows(done.filter(r=>r.R.final.gross_flag||r.R.final.total!=null&&r.R.final.total<80),'score-asc').slice(0,4);
  const recent = sortRows(done).slice(0,5), sections = {};
  for (const r of done) for (const x of r.R.final.sections||[]) if(x.max>0) (sections[x.section] ||= []).push(x.percent);
  const opt = (v,label,current) => html`<option value="${v}" ${attr('selected',v===current)}>${label}</option>`;
  return html`
    <div class="page-head"><div><h2>Обзор качества</h2><p class="sub">От общей картины к диалогам, которые требуют внимания.</p></div><a class="btn p" href="${explorerHref(scope)}">Открыть диалоги ${icon('arrowRight')}</a></div>
    <div class="overview-context"><span>${icon('doc')}Загруженный набор · <b>${rows.length} диалогов</b></span><div class="row"><label class="sr" for="overview-lang">Язык обзора</label><select id="overview-lang" data-change="overview-filter" data-key="language">${opt('','Все языки',scope.language)}${Object.entries(LANG).map(([k,v])=>opt(k,v,scope.language))}</select><label class="sr" for="overview-channel">Канал обзора</label><select id="overview-channel" data-change="overview-filter" data-key="channel">${opt('','Все каналы',scope.channel)}${Object.entries(CHANNEL).map(([k,v])=>opt(k,v,scope.channel))}</select></div></div>
    <section class="metric-strip" aria-label="Ключевые показатели">
      <a href="${explorerHref(scope)}"><span>Средний итог ${icon('arrowRight')}</span><strong class="t-${scoreTone(avg)}">${fmtScore(avg)}<em>/ 100</em></strong><small>по ${totals.length} последним оценкам</small></a>
      <a href="${explorerHref({...scope,status:'none'})}"><span>Покрытие оценки ${icon('arrowRight')}</span><strong>${rows.length?Math.round(done.length/rows.length*100):0}<em>%</em></strong><small>${done.length} из ${rows.length} · ${rows.length-done.length} без оценки</small></a>
      <a href="${explorerHref({...scope,quality:'low'},'score-asc')}"><span>Низкое качество ${icon('arrowRight')}</span><strong class="${low.length?'t-rd':''}">${low.length}</strong><small>итог ниже 60 баллов</small></a>
      <a href="${explorerHref({...scope,status:'flag'})}"><span>Грубые нарушения ${icon('arrowRight')}</span><strong class="${flagged.length?'t-rd':''}">${flagged.length}</strong><small>проверяются независимо от балла</small></a>
    </section>
    <div class="overview-primary">
      <section class="card quality-summary"><div class="card-head"><div><h3>Динамика качества</h3><p class="hint">Средний итог с учётом решений проверяющего</p></div><span class="b ne">0–100 баллов</span></div>${trendChart(done,scope)}<p class="chart-footnote">По датам последних оценок каждого диалога. Повторные оценки заменяют предыдущие; это не полная история изменений.</p></section>
      <section class="card attention-panel"><div class="card-head"><h3>Проверить в первую очередь</h3><span class="b ${attention.length?'wn':'ne'}">${done.filter(r=>r.R.final.gross_flag||r.R.final.total!=null&&r.R.final.total<80).length}</span></div>
        ${attention.length?html`<p class="hint">Нарушения и результаты ниже 80 баллов</p><div class="attention-list">${attention.map(r=>html`<a href="#/conversations/${encodeURIComponent(r.conv.conversation_id)}"><span><b>${r.conv.conversation_id}</b><small>${r.R.final.gross_flag?html`${icon('flag')}Грубое нарушение`:`${r.conv.language} · ${CHANNEL[r.conv.channel]||r.conv.channel}`}</small></span><strong class="t-${scoreTone(r.R.final.total)}">${fmtScore(r.R.final.total)}</strong>${icon('arrowRight')}</a>`)}</div>`:emptyState('check',done.length?'Нет приоритетных проверок':'Начните с первой оценки',done.length?'Нарушений и результатов ниже 80 не найдено.':'Выберите диалог и запустите оценку по чек-листу.',!done.length?html`<a class="btn" href="${explorerHref(scope)}">Оценить первый диалог</a>`:'')}
        <a class="review-queue" href="#/appeals">${icon('scale')}Апелляции на рассмотрении <b>${pending}</b>${icon('arrowRight')}</a>
      </section>
    </div>
    <div class="analytics-grid">
      <section class="card quality-distribution"><div class="card-head"><h3>Распределение качества</h3><span class="hint">${totals.length} оценок</span></div>
        ${totals.length?html`<div class="distribution-track" aria-hidden="true">${buckets.filter(b=>b.count).map(b=>html`<i class="segment-${b.tone}" style="flex:${b.count}"></i>`)}</div>`:html`<p class="hint">Распределение появится после первой оценки.</p>`}
        <ul class="distribution-legend">${buckets.map(b=>html`<li><a href="${explorerHref({...scope,quality:b.key})}"><span><i class="dot-${b.tone}"></i>${b.label}<small>${b.range}</small></span><b>${b.count}<small>${totals.length?Math.round(b.count/totals.length*100):0}%</small></b>${icon('arrowRight')}</a></li>`)}</ul>
      </section>
      <section class="card"><div class="card-head"><h3>Качество по секциям</h3>${icon('doc')}</div><ul class="bars">${Object.entries(sections).sort(([,a],[,b])=>a.reduce((x,y)=>x+y,0)/a.length-b.reduce((x,y)=>x+y,0)/b.length).map(([name,values])=>{
        const value=values.reduce((a,b)=>a+b,0)/values.length;
        return html`<li class="wide"><span class="bar-name">${name}</span>${meter(value,{label:name})}<b class="bar-val">${fmtScore(value)}%</b></li>`;
      })}</ul>${!Object.keys(sections).length?html`<p class="hint">Разбивка появится после оценки.</p>`:''}<div class="active-policy"><span class="hint">Активный чек-лист</span><a href="#/checklists">${checklistLabel(act)} ${icon('arrowRight')}</a></div></section>
      <section class="card recent-evaluations"><div class="card-head"><h3>Последние оценки</h3><a href="${explorerHref(scope)}" class="text-action">Все диалоги ${icon('arrowRight')}</a></div>
        ${recent.length?html`<div class="recent-list">${recent.map(r=>html`<a href="#/conversations/${encodeURIComponent(r.conv.conversation_id)}"><span class="recent-icon">${icon(r.conv.channel==='voice call'?'phone':'chat')}</span><span><b>${r.conv.conversation_id}</b><small>${r.conv.language} · ${fmtDate(r.ev.created_at)}</small></span><strong class="t-${scoreTone(r.R.final.total)}">${fmtScore(r.R.final.total)}</strong>${icon('arrowRight')}</a>`)}</div>`:emptyState('inbox','Пока нет оценок','Выберите диалоги и запустите анализ.')}
      </section>
      <section class="card"><div class="card-head"><h3>Сравнение по основному языку</h3><span class="hint">Текущий набор</span></div><div class="tw"><table class="table language-comparison"><caption class="sr">Количество и средний итог по языкам</caption><thead><tr><th scope="col">Язык</th><th scope="col">Оценено</th><th scope="col">Средний итог</th></tr></thead><tbody>${Object.entries(LANG).filter(([l])=>!scope.language||scope.language===l).map(([l,label])=>{const group=rows.filter(r=>r.conv.language===l), values=group.map(r=>r.R?.final.total).filter(v=>v!=null),mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;return html`<tr><th scope="row"><a href="${explorerHref({...scope,language:l})}"><span class="language-code">${l}</span>${label}</a></th><td>${group.filter(r=>r.R).length} / ${group.length}</td><td class="t-${scoreTone(mean)}"><b>${fmtScore(mean)}</b></td></tr>`;})}</tbody></table></div><p class="hint">Последняя оценка каждого диалога с учётом пересмотра.</p></section>
    </div>
    ${!s.config?.USE_MOCK?html`<div class="demo-details"><a class="btn" href="?mock=1#/overview">Открыть синтетические сценарии</a><p class="hint">Тестовые диалоги, двуязычные обращения и апелляции хранятся отдельно от API.</p></div>`:html`<details class="demo-details"><summary>Демонстрационные данные</summary><p class="hint">Локальная демонстрация. Изменения сохраняются только в этом браузере.</p><button type="button" class="d" data-action="reset-demo">${icon('trash')}Сбросить демо-данные</button></details>`}`;
}
export const handlers={change:{'overview-filter'(el){store.set({overviewFilters:{...store.get().overviewFilters,[el.dataset.key]:el.value}});}},click:{async 'reset-demo'(){if(!window.confirm('Сбросить демо-данные?'))return;try{await resetDemo();toast('Демо-данные сброшены');}catch(e){fail(e);}}}};
