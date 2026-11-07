// Запуск: node test/scoring.test.js  (из папки frontend/, без зависимостей)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { calculate, validAnswer, allowedAnswers, validateChecklist } from '../js/scoring.js';
import { SEED_CRITERIA as C } from '../js/checklist.seed.js';

const by = (id) => C.find((c) => c.id === id);
const MAX = { c1: 'yes', c2: 'yes', c3: 'yes', c4: 20, c5: 'yes', c6: 10, c7: 'yes', c8: 'no' };
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  -', name); }
  catch (e) { console.error('FAIL -', name, '\n   ', e.message); process.exitCode = 1; }
}

test('seed: 8 критериев, веса без флага = 100', () => {
  assert.equal(C.length, 8);
  assert.deepEqual(C.map((c) => c.weight), [10, 15, 20, 20, 15, 15, 5, 0]);
  assert.equal(C.filter((c) => c.allow_na).map((c) => c.id).join(','), 'c2,c3,c4,c7');
  assert.deepEqual(validateChecklist(C), []);
});

test('c1 yes, c2 na, c3 na, c4=15, c5 yes, c6=7, c7 yes, c8 no -> 85.38 (W=65)', () => {
  const r = calculate(C, { c1: 'yes', c2: 'na', c3: 'na', c4: 15, c5: 'yes', c6: 7, c7: 'yes', c8: 'no' });
  assert.equal(r.applicable_weight, 65);
  assert.equal(r.total, 85.38);
  assert.equal(r.gross_flag, false);
});

test('все максимальные ответы -> 100', () => {
  const r = calculate(C, MAX);
  assert.equal(r.total, 100);
  assert.equal(r.gross_flag, false);
});

test('все минимальные, c8 yes -> 0 и gross_flag=true', () => {
  const r = calculate(C, { c1: 'no', c2: 'no', c3: 'no', c4: 0, c5: 'no', c6: 0, c7: 'no', c8: 'yes' });
  assert.equal(r.total, 0);
  assert.equal(r.gross_flag, true);
});

test('флаг не обнуляет итог', () => {
  const r = calculate(C, { ...MAX, c8: 'yes' });
  assert.equal(r.total, 100);
  assert.equal(r.gross_flag, true);
});

test('c4=20, c6=7, остальное максимум -> 95.5', () => {
  assert.equal(calculate(C, { ...MAX, c6: 7 }).total, 95.5);
});

test('только критерии с N/A, все "na" -> null', () => {
  const only = C.filter((c) => c.allow_na);
  const r = calculate(only, Object.fromEntries(only.map((c) => [c.id, 'na'])));
  assert.equal(r.total, null);
  assert.equal(r.applicable_weight, 0);
});

test('validAnswer: c4=12 невалиден; "na" у c1 невалиден, у c2 валиден', () => {
  assert.equal(validAnswer(by('c4'), 12), false);
  assert.equal(validAnswer(by('c4'), 15), true);
  assert.equal(validAnswer(by('c1'), 'na'), false);
  assert.equal(validAnswer(by('c2'), 'na'), true);
  assert.equal(validAnswer(by('c1'), 15), false);
  assert.equal(validAnswer(by('c4'), 'yes'), false);
});

test('секции: баллы, максимум и процент', () => {
  const r = calculate(C, { c1: 'yes', c2: 'na', c3: 'na', c4: 15, c5: 'yes', c6: 7, c7: 'yes', c8: 'no' });
  const s1 = r.sections.find((s) => s.section === 'Начало и понимание запроса');
  assert.equal(s1.max, 15.38); // 10/65*100
  assert.equal(s1.percent, 100);
  const s4 = r.sections.find((s) => s.section === 'Грубые нарушения');
  assert.equal(s4.max, 0);
  assert.equal(s4.percent, null);
  const sum = r.sections.reduce((a, s) => a + s.max, 0);
  assert.ok(Math.abs(sum - 100) < 0.05);
});

test('отсутствующий ответ не исключает критерий и даёт 0', () => {
  const { c3, ...rest } = MAX;
  const r = calculate(C, rest);
  assert.equal(r.total, 80);
  assert.equal(r.rows.find((x) => x.criterion_id === 'c3').error, 'missing');
});

test('allowedAnswers', () => {
  assert.deepEqual(allowedAnswers(by('c4')), [20, 15, 10, 5, 0, 'na']);
  assert.deepEqual(allowedAnswers(by('c1')), ['yes', 'no']);
});

// Общие кейсы с бэкендом (backend/tests/fixtures/scoring_cases.json) — паритет JS и Python.
const fixtures = new URL('../../backend/tests/fixtures/scoring_cases.json', import.meta.url);
if (existsSync(fixtures)) {
  const F = JSON.parse(readFileSync(fixtures, 'utf8'));
  for (const k of F.calculate) {
    test(`fixture: ${k.name}`, () => {
      const crit = k.only ? C.filter((c) => k.only.includes(c.id)) : C;
      const r = calculate(crit, k.answers);
      assert.equal(r.total, k.expect.total);
      assert.equal(r.gross_flag, k.expect.gross_flag);
      assert.equal(r.applicable_weight, k.expect.applicable_weight);
    });
  }
  for (const k of F.valid_answer) {
    test(`fixture: validAnswer ${k.criterion_id}=${JSON.stringify(k.answer)}`, () => assert.equal(validAnswer(by(k.criterion_id), k.answer), k.valid));
  }
}



const explicitCases = JSON.parse(readFileSync(new URL('../../backend/tests/fixtures/scoring_cases.json', import.meta.url), 'utf8')).explicit_scales;
for (const c of explicitCases) {
  test(`explicit: ${c.name}`, () => {
    const result = calculate(c.criteria, c.answers);
    assert.equal(result.total, c.total);
    assert.equal(result.gross_flag, c.gross_flag);
    assert.deepEqual(validateChecklist(c.criteria), []);
    const active = result.rows.filter((r) => r.applicable);
    if (active.length) assert.ok(Math.abs(active.reduce((sum, r) => sum + r.effective_weight, 0) - 100) < 1e-9);
  });
}
for (const maximum of [10, 20]) {
  test(`full integer scale 0..${maximum}`, () => {
    const c = { id: 's', evaluation_type: `scale_${maximum}`, weight: 100 };
    assert.equal(allowedAnswers(c).length, maximum + 1);
    for (let score = 0; score <= maximum; score++) {
      assert.equal(validAnswer(c, score), true);
      assert.equal(calculate([c], { s: score }).total, Math.round((score / maximum * 100 + Number.EPSILON) * 100) / 100);
    }
    for (const value of [-1, maximum + 1, true, Infinity, NaN, '5']) assert.equal(validAnswer(c, value), false);
  });
}
console.log(`\n${passed} total checks passed`);
