import { html } from '../html.js';
import { fmtScore } from '../results.js';
import { explorerHref } from './explorer.js';

export function distribution(rows) {
  const buckets = [{key:'high',label:'Высокое',range:'80–100',tone:'ok',count:0},{key:'attention',label:'Требует внимания',range:'60–<80',tone:'wn',count:0},{key:'low',label:'Низкое',range:'0–<60',tone:'rd',count:0}];
  for (const row of rows) {
    const score = row.R?.final.total;
    if (score == null) continue;
    buckets[score >= 80 ? 0 : score >= 60 ? 1 : 2].count++;
  }
  return buckets;
}
export function trend(rows) {
  const days = new Map();
  for (const r of rows) {
    if (r.R?.final.total == null || !r.ev?.created_at) continue;
    const date = new Date(r.ev.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0,10);
    const values = days.get(key) || []; values.push(r.R.final.total); days.set(key, values);
  }
  return [...days].sort(([a],[b]) => a.localeCompare(b)).slice(-14).map(([date,values]) => ({date,value:values.reduce((a,b)=>a+b,0)/values.length,count:values.length}));
}
const shortDate = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { day:'numeric', month:'short', timeZone:'UTC' });
export function trendChart(rows, filters = {}) {
  const points = trend(rows), width = 640, height = 184, left = 36, right = 18, top = 14, bottom = 26;
  if (!points.length) return html`<div class="chart-empty"><span>Пока нет данных для графика</span><p class="hint">Оцените первый диалог. Здесь появятся средние баллы по дням.</p></div>`;
  const first = Date.parse(points[0].date), span = Date.parse(points.at(-1).date) - first;
  const y = value => top + (100-value)/100*(height-top-bottom);
  const coords = points.map(p => ({...p,x:span ? left+(Date.parse(p.date)-first)/span*(width-left-right) : (left+width-right)/2,y:y(p.value)}));
  const line = coords.map(p=>`${p.x},${p.y}`).join(' ');
  return html`<div class="trend-chart"><svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Средний итог по дням оценки, шкала от 0 до 100. Значения доступны в таблице под графиком.">
    ${[0,50,100].map(v=>html`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-tick" x="${left-10}" y="${y(v)+4}" text-anchor="end">${v}</text>`)}
    <line class="chart-threshold" x1="${left}" x2="${width-right}" y1="${y(80)}" y2="${y(80)}"/>
    ${points.length>1?html`<polyline class="chart-line" points="${line}"/>`:''}
    ${coords.map(p=>html`<a href="${explorerHref({...filters,from:p.date,to:p.date})}" aria-label="${shortDate(p.date)}: ${fmtScore(p.value)} баллов, ${p.count} оценок. Открыть диалоги."><circle class="chart-point" cx="${p.x}" cy="${p.y}" r="5"/><title>${shortDate(p.date)} · ${fmtScore(p.value)} · ${p.count} оценок</title></a>`)}
    <text class="chart-tick" x="${left}" y="${height-3}">${shortDate(points[0].date)}</text>
    ${span?html`<text class="chart-tick" x="${width-right}" y="${height-3}" text-anchor="end">${shortDate(points.at(-1).date)}</text>`:''}
    </svg><div class="chart-caption"><span><i></i>80 баллов · граница высокого качества</span><span>${points.length===1?'Один день наблюдений':'Последние 14 дней с оценками'} · UTC</span></div>
    <details class="chart-data"><summary>Значения по дням</summary><div class="tw"><table class="table"><caption class="sr">Средние баллы по дням последних оценок</caption><thead><tr><th scope="col">Дата (UTC)</th><th scope="col">Средний балл</th><th scope="col">Диалоги</th></tr></thead><tbody>${points.map(p=>html`<tr><td>${p.date}</td><td>${fmtScore(p.value)}</td><td><a href="${explorerHref({...filters,from:p.date,to:p.date})}">${p.count} · открыть</a></td></tr>`)}</tbody></table></div></details></div>`;
}
