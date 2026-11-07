import { trustedConstant } from './html.js';

const P = {
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  half: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  minus: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16.5 16.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  arrowRight: '<path d="M4.5 12h14M13.5 6.5l5.5 5.5-5.5 5.5"/>',
  arrowLeft: '<path d="M19.5 12h-14M10.5 6.5L5 12l5.5 5.5"/>',
  up: '<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>',
  down: '<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4.5 19.5l1-4.5L16 4.5l3.5 3.5L9 18.5z"/><path d="M13.5 7l3.5 3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  quote: '<path d="M6 17c-1-1-1.5-2.3-1.5-4 0-3 1.8-5.3 4.5-6.5l.8 1.3C8.2 8.7 7.4 9.8 7.3 11H10v6zM15 17c-1-1-1.5-2.3-1.5-4 0-3 1.8-5.3 4.5-6.5l.8 1.3c-1.6.9-2.4 2-2.5 3.2H19v6z" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  range: '<path d="M9 4H6v16h3M15 4h3v16h-3"/>',
  inbox: '<path d="M3.5 13.5l2.5-8h12l2.5 8v5h-17z"/><path d="M3.5 13.5h5l1 2h5l1-2h5"/>',
  doc: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 16h6"/>',
  scale: '<path d="M12 4v16M5 20h14M5.5 8h13M5.5 8l-2.5 6a2.8 2.8 0 0 0 5 0zM18.5 8l-2.5 6a2.8 2.8 0 0 0 5 0z"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5v3.5h-3.5"/>',
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  sparkle: '<path d="M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z"/>',
};

const CLS = /^[a-z0-9 -]*$/;

export function icon(name, cls = '') {
  const body = P[name] || P.circle;
  const c = CLS.test(cls) ? cls : '';
  return trustedConstant(`<svg class="ic${c ? ' ' + c : ''}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
}
