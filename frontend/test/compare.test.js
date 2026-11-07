// node test/compare.test.js — сравнение версий чек-листа (логика mock-режима, повторяет backend/app/compare.py)
import assert from 'node:assert/strict';
import { diffCriteria, compareEvaluations } from '../js/compare.js';
import { SEED_CRITERIA } from '../js/checklist.seed.js';
import { calculate } from '../js/scoring.js';

const v1 = structuredClone(SEED_CRITERIA);
const v2 = structuredClone(SEED_CRITERIA);
v2.find((c) => c.id === 'c1').weight = 15;
v2.find((c) => c.id === 'c4').weight = 15;
v2.find((c) => c.id === 'c6').scale_steps = [0, 4, 7, 10]; // тот же набор — не изменение

const d = diffCriteria(v1, v2);
assert.deepEqual(d.changed.map((x) => x.criterion_id), ['c1', 'c4']);
assert.deepEqual(d.changed[0].changes, [{ field: 'weight', label: 'Вес', from: 10, to: 15 }]);
assert.equal(d.added.length + d.removed.length, 0);
assert.equal(d.unchanged, 6);

const ans = { c1: 'yes', c2: 'na', c3: 'na', c4: 15, c5: 'yes', c6: 7, c7: 'yes', c8: 'no' };
const ev = (id, answers) => ({ id, items: Object.entries(answers).map(([criterion_id, answer]) => ({ criterion_id, answer })) });
const from = { a: { ev: ev('ev-1', ans), criteria: v1 }, b: { ev: ev('ev-2', ans), criteria: v1 } };
const to = { a: { ev: ev('ev-3', { ...ans, c5: 'no' }), criteria: v2 } };
const r = compareEvaluations(from, to);
assert.equal(r.summary.compared, 1);
assert.equal(r.summary.not_evaluated_in_to, 1);
const row = r.rows[0];
assert.equal(row.total_from, 85.38);
assert.equal(row.total_to, calculate(v2, { ...ans, c5: 'no' }).total);
assert.equal(row.delta, Math.round((row.total_to - row.total_from) * 100) / 100);
assert.deepEqual(row.changed_criteria.map((c) => c.criterion_id), ['c5']);
assert.ok(row.points_changed.some((c) => c.criterion_id === 'c1'));
assert.equal(r.summary.declined, 1);
assert.equal(compareEvaluations(from, {}).summary.compared, 0);
console.log('Compare checks passed: diff, totals from snapshots, changed answers, not evaluated in target');
