// Безопасная сборка HTML. Всё, что подставляется в html`...`, экранируется,
// кроме результатов других html`...` (вложенные шаблоны) — это единственный способ попасть в innerHTML.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

class SafeHtml {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

function fmt(v) {
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += fmt(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Только для строк-констант из кода (SVG-иконки). Никогда не передавайте сюда данные пользователя. */
export const trustedConstant = (s) => new SafeHtml(String(s));

/** Атрибут-флаг: html`<button ${attr('disabled', cond)}>` */
export const attr = (name, on) => new SafeHtml(on ? ` ${name}` : '');
