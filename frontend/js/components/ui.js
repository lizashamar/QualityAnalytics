// Общие визуальные элементы: круговой индикатор итога, шкала доли, пустое состояние, скелетон.
import { html, attr } from '../html.js';
import { icon } from '../icons.js';
import { scoreTone, fmtScore, TONE_LABEL } from '../results.js';

const R = 52;
const C = 2 * Math.PI * R;
const seen = new Set(); // анимируем заполнение только при первом показе значения (перерисовки не дёргают круг)

/** Круговой индикатор итога 0..100. key — чтобы анимация не повторялась при каждой перерисовке. */
export function scoreRing(value, { key = '', size = 'lg', label = 'Итоговый балл' } = {}) {
  const tone = scoreTone(value);
  const p = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const off = C * (1 - p);
  const k = `${key}|${value}`;
  const animate = !seen.has(k);
  seen.add(k);
  const text = value === null || value === undefined ? 'не рассчитывается' : `${fmtScore(value)} из 100`;
  return html`<div class="ring ring-${size} t-${tone}" role="img" aria-label="${label}: ${text}, ${TONE_LABEL[tone]}">
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle class="ring-track" cx="60" cy="60" r="${R}"/>
      <circle class="ring-val${animate ? ' ring-anim' : ''}" cx="60" cy="60" r="${R}"
        style="stroke-dasharray:${C.toFixed(2)};stroke-dashoffset:${off.toFixed(2)};--ring-from:${C.toFixed(2)};--ring-to:${off.toFixed(2)}"/>
    </svg>
    <div class="ring-center"><b>${value === null || value === undefined ? '—' : fmtScore(value)}</b>${size === 'lg' ? html`<span>из 100</span>` : ''}</div>
  </div>`;
}

/** Горизонтальная шкала доли (0..100), цвет — по доле, а не бренду. */
export function meter(percent, { label = '', hint = '' } = {}) {
  const tone = scoreTone(percent);
  const w = Math.max(0, Math.min(100, percent || 0));
  return html`<div class="meter t-${tone}" role="img" aria-label="${label}: ${fmtScore(percent)}%, ${TONE_LABEL[tone]}" title="${hint}">
    <i style="width:${w}%"></i></div>`;
}

export function emptyState(iconName, title, text, action = '') {
  return html`<div class="empty">${icon(iconName, 'ic-lg')}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}

export function skeleton(lines = 3) {
  return html`<div class="skeleton" aria-hidden="true">${Array.from({ length: lines }, (_, i) => html`<span style="width:${[92, 76, 84, 60, 70][i % 5]}%"></span>`)}</div>`;
}

export { attr };
