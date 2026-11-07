// Чистый расчёт итога по чек-листу. Без DOM, без состояния — используется и в браузере, и в node-тестах.
//
// calculate(criteria, answers) -> { total, sections, gross_flag, rows, applicable_weight }
//   criteria: массив критериев чек-листа (порядок = порядок отображения)
//   answers:  { [criterion_id]: "yes" | "no" | "na" | number }
//
// Правила (см. чек-лист, «Порядок расчёта»):
// 1. is_flag-критерии в баллы не входят; «yes» по ним ставит gross_flag, итог НЕ обнуляется.
// 2. Ответ "na" исключает критерий.
// 3. W = сумма весов применимых критериев; вес после перераспределения = weight / W * 100.
// 4. yesno: yes = 1 × вес, no = 0; scale: ступень / максимальная ступень × вес.
// 5. total округляется до 2 знаков; при W = 0 total = null.
// 6. sections считаются по тем же правилам внутри секции.
// Отсутствующий или недопустимый ответ не исключает критерий (иначе итог незаметно вырастет):
// критерий остаётся применимым, даёт 0 баллов, а строка помечается error.

export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function maxStep(criterion) {
  const steps = (criterion.scale_steps || []).map(Number).filter(Number.isFinite);
  return steps.length ? Math.max(...steps) : 0;
}

/** Допустимые значения ответа для критерия (порядок: от лучшего к худшему, затем na). */
export function allowedAnswers(criterion) {
  let base;
  if (criterion.type === 'scale') {
    base = [...(criterion.scale_steps || [])].map(Number).sort((a, b) => b - a);
  } else {
    base = criterion.is_flag ? ['no', 'yes'] : ['yes', 'no'];
  }
  return criterion.allow_na ? [...base, 'na'] : base;
}

export function validAnswer(criterion, answer) {
  if (!criterion) return false;
  if (answer === 'na') return !!criterion.allow_na;
  if (criterion.type === 'scale') {
    if (typeof answer !== 'number' || !Number.isFinite(answer)) return false;
    return (criterion.scale_steps || []).map(Number).includes(answer);
  }
  return answer === 'yes' || answer === 'no';
}

/** Доля полного веса за ответ (0..1). */
function fraction(criterion, answer) {
  if (criterion.type === 'scale') {
    const m = maxStep(criterion);
    return m > 0 ? answer / m : 0;
  }
  return answer === 'yes' ? 1 : 0;
}

export function calculate(criteria, answers) {
  answers = answers || {};
  const rows = criteria.map((c) => {
    const has = Object.prototype.hasOwnProperty.call(answers, c.id);
    const answer = has ? answers[c.id] : undefined;
    const valid = has && validAnswer(c, answer);
    const error = !has ? 'missing' : !valid ? 'invalid' : null;
    const na = valid && answer === 'na';
    return {
      criterion_id: c.id,
      section: c.section || '',
      answer,
      is_flag: !!c.is_flag,
      applicable: !c.is_flag && !na,
      weight: c.is_flag ? 0 : Number(c.weight) || 0,
      effective_weight: 0,
      fraction: null,
      points: 0,
      error,
    };
  });

  const W = rows.reduce((s, r) => s + (r.applicable ? r.weight : 0), 0);

  for (const r of rows) {
    if (!r.applicable || W === 0) continue;
    const c = criteria.find((x) => x.id === r.criterion_id);
    r.effective_weight = (r.weight / W) * 100;
    r.fraction = r.error ? 0 : fraction(c, r.answer);
    r.points = r.fraction * r.effective_weight;
  }

  const gross_flag = rows.some((r) => r.is_flag && !r.error && r.answer === 'yes');
  const total = W === 0 ? null : round2(rows.reduce((s, r) => s + r.points, 0));

  const sections = [];
  for (const r of rows) {
    let s = sections.find((x) => x.section === r.section);
    if (!s) {
      s = { section: r.section, points: 0, max: 0, percent: null, gross_flag: false };
      sections.push(s);
    }
    s.points += r.points;
    s.max += r.effective_weight;
    if (r.is_flag && !r.error && r.answer === 'yes') s.gross_flag = true;
  }
  for (const s of sections) {
    s.points = round2(s.points);
    s.max = round2(s.max);
    s.percent = s.max > 0 ? round2((s.points / s.max) * 100) : null;
  }

  return { total, sections, gross_flag, rows, applicable_weight: W };
}

/** Проверка чек-листа перед сохранением. Возвращает массив текстов ошибок (пустой — всё ок). */
export function validateChecklist(criteria) {
  const errors = [];
  if (!criteria.length) errors.push('Добавьте хотя бы один критерий.');
  const sum = criteria.filter((c) => !c.is_flag).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  if (Math.abs(sum - 100) > 1e-9) errors.push(`Сумма весов критериев с баллами должна быть 100 (сейчас ${round2(sum)}).`);
  const ids = new Set();
  criteria.forEach((c, i) => {
    const n = `Критерий ${i + 1}`;
    if (ids.has(c.id)) errors.push(`${n}: повторяющийся id «${c.id}».`);
    ids.add(c.id);
    if (!String(c.title || '').trim()) errors.push(`${n}: нет названия.`);
    if (!String(c.section || '').trim()) errors.push(`${n}: не указана секция.`);
    if (!c.is_flag && !(Number(c.weight) > 0)) errors.push(`${n}: вес должен быть больше 0.`);
    if (c.type === 'scale') {
      const st = (c.scale_steps || []).map(Number);
      if (st.length < 2) errors.push(`${n}: у шкалы должно быть минимум 2 ступени.`);
      if (st.some((x) => !Number.isFinite(x) || x < 0)) errors.push(`${n}: ступени шкалы должны быть неотрицательными числами.`);
      if (new Set(st).size !== st.length) errors.push(`${n}: ступени шкалы не должны повторяться.`);
      if (!(Math.max(...st) > 0)) errors.push(`${n}: верхняя ступень шкалы должна быть больше 0.`);
    }
    if (c.allow_na && !String(c.na_condition || '').trim()) errors.push(`${n}: для N/A укажите условие.`);
  });
  return errors;
}
