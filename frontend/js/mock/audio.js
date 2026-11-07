// Синтетическая «запись звонка» для mock-режима: тихий тон-метроном каждую секунду,
// чтобы перемотка к реплике была слышна. Генерируется в памяти — в репозитории нет бинарников.

const cache = new Map();

export function mockAudioUrl(seconds) {
  if (cache.has(seconds)) return cache.get(seconds);
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const inBeep = t % 1 < 0.08;
    const s = inBeep ? Math.sin(2 * Math.PI * (t % 10 < 0.08 ? 880 : 440) * t) * 18 : 0;
    v.setUint8(44 + i, 128 + Math.round(s));
  }
  const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  cache.set(seconds, url);
  return url;
}
