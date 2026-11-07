// Конфигурация. Источники (по убыванию приоритета):
//   1. query-параметры: ?api=<url>&group=<id>&mock=0|1
//      (в Dynamics 365 web resource параметры приходят в ?data=..., поддерживаем и это: ?data=api%3D...%26group%3D...)
//   2. window.CQA_CONFIG = { API_BASE, USE_MOCK, GROUP_ID } — задаётся до подключения app.js
//   3. значения по умолчанию: без API_BASE работаем в mock-режиме.

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const data = p.get('data');
  if (data) {
    for (const [k, v] of new URLSearchParams(data)) if (!p.has(k)) p.set(k, v);
  }
  return p;
}

function bool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

export function loadConfig() {
  const g = (typeof window !== 'undefined' && window.CQA_CONFIG) || {};
  const p = readParams();
  const API_BASE = String(p.get('api') ?? g.API_BASE ?? '').replace(/\/+$/, '');
  const GROUP_ID = p.get('group') ?? g.GROUP_ID ?? '';
  const explicitMock = bool(p.get('mock')) ?? bool(g.USE_MOCK);
  const USE_MOCK = explicitMock ?? !API_BASE;
  return Object.freeze({ API_BASE, GROUP_ID, USE_MOCK });
}

export const config = loadConfig();
