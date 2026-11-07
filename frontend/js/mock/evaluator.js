// Deterministic demo scoring; modified criteria use synthetic fallback answers.

import { calculate, validAnswer, round2 } from '../scoring.js';
import { SEED_CRITERIA } from '../checklist.seed.js';
import { MIXED_RESPONSES, MIXED_CHECKLIST } from './scenarios.js';

const A = (answer, evidence, explanation, extra = {}) => ({ answer, evidence, explanation, checked_range: null, na_reason: null, ...extra });
const NA = (evidence, na_reason, explanation = 'Критерий неприменим по условию N/A.') => A('na', evidence, explanation, { na_reason });

const SCRIPTS = {
  'chat-ru-001': {
    c1: A('yes', [4], 'В первом ответе оператор поздоровался на языке клиента и назвал имя.'),
    c2: NA([2], 'Клиент сразу указал сумму, срок и номер заявки — данных для ответа хватало с самого начала.'),
    c3: A('yes', [4, 5, 6], 'Оператор запросил ИИН и кодовое слово и подтвердил личность до того, как раскрыть статус заявки.'),
    c4: A(15, [7, 8, 9], 'Основной вопрос решён: отправлен повторный запрос и назван срок. Вопрос клиента о причине задержки остался без ответа — второстепенная деталь.'),
    c5: A('yes', [4], 'Оператор извинился за ожидание и сразу перешёл к проблеме клиента.'),
    c6: A(10, [6, 7], 'Ответы ясные и последовательные; об ожидании около двух минут оператор предупредил заранее.'),
    c7: A('yes', [9], 'Оператор подсказал дальнейшие действия с номером обращения и попрощался.'),
    c8: A('no', [], 'В репликах оператора нет оскорблений, предложений услуг в обход компании и раскрытия конфиденциальной информации.', { checked_range: [4, 9] }),
  },
  'call-ru-002': {
    c1: A('yes', [1], 'Оператор назвал компанию, своё имя и поздоровался в первой реплике.'),
    c2: A('no', [3, 5], 'Клиент упомянул неисполненную заявку, но оператор не уточнил её номер и суть проблемы.', { checked_range: [2, 7] }),
    c3: NA([4], 'Оператор не раскрывал данных счёта и не выполнял защищённых действий — идентификация не требовалась.'),
    c4: A(0, [5], 'Ответа по существу нет: заявка не проверена, вместо решения — предложение перевести деньги оператору лично.'),
    c5: A('no', [3, 7], 'Пренебрежительная реакция на жалобу: «Не кричите», «Как хотите».'),
    c6: A(4, [3, 5, 7], 'Оператор уходит от темы и противоречит себе, клиенту приходится переспрашивать.'),
    c7: A('no', [7, 8], 'Звонок завершён оператором без итога, предложения помощи и прощания.', { checked_range: [6, 8] }),
    c8: A('yes', [5], 'Предложение перевести деньги оператору лично для инвестирования — платная услуга в обход компании.'),
  },
  'chat-kz-014': {
    c1: A('no', [1], 'Первая реплика оператора пришла через 3:37 и не содержит приветствия и представления.', { checked_range: [1, 1] }),
    c2: A('no', [3], 'Клиент упомянул квитанцию о платеже, но оператор не запросил её и не уточнил детали платежа.', { checked_range: [1, 4] }),
    c3: NA([0], 'Оператор не раскрывал данных счёта и не выполнял защищённых действий — идентификация не требовалась.'),
    c4: A(5, [2, 4], 'Есть только общая подсказка «напишите в банк», клиенту непонятно, как действовать.'),
    c5: A('no', [4], 'Недовольство клиента проигнорировано, ответ «Білмеймін» без попытки помочь.'),
    c6: A(4, [1, 2, 3], 'Ожидание не объявлено, ответы обрывочные — клиенту пришлось переспросить срок.'),
    c7: A('no', [4, 5], 'Чат закрыт оператором без итога и прощания.', { checked_range: [4, 5] }),
    c8: A('no', [], 'Оскорблений, предложений в обход компании и раскрытия данных не выявлено.', { checked_range: [1, 4] }),
  },
  'chat-kz-027': {
    c1: A('yes', [3], 'Оператор поздоровался на казахском, как клиент, и представился.'),
    c2: A('yes', [3, 4], 'До ответа оператор уточнил тариф клиента и биржу.'),
    c3: NA([1], 'Общий вопрос о тарифах не требует идентификации.'),
    c4: A(20, [5], 'Дана точная комиссия по тарифу клиента и ссылка на полный тарифный план.'),
    c5: A('yes', [3, 7], 'Оператор вежлив, ответ адресован конкретному вопросу клиента.'),
    c6: A(10, [3, 5], 'Ответы ясные и последовательные, явного ожидания не было.'),
    c7: A('yes', [7], 'Оператор предложил помощь по другим вопросам и попрощался.'),
    c8: A('no', [], 'Нарушений не выявлено.', { checked_range: [3, 7] }),
  },
  'chat-en-031': {
    c1: A('yes', [1], 'Оператор поздоровался на английском и представился в первом ответе.'),
    c2: A('yes', [1, 2], 'До ответа уточнила устройство и версию приложения.'),
    c3: NA([0], 'Технический сбой приложения: данные счёта не раскрывались, идентификация не требовалась.'),
    c4: A(15, [3, 4, 5], 'Сбой устранён, но вопрос клиента о сохранности списков наблюдения при переустановке остался без ответа.'),
    c5: A('yes', [1], 'Оператор посочувствовал и сразу занялся проблемой.'),
    c6: A(7, [3, 5], 'Одна заметная неточность: вопрос клиента в реплике 5 пропущен, но диалог понятен.'),
    c7: A('yes', [5], 'Оператор предложил дальнейшую помощь и попрощался.'),
    c8: A('no', [], 'Нарушений не выявлено.', { checked_range: [1, 5] }),
  },
  'chat-en-045': {
    c1: A('yes', [4], 'Оператор поздоровался на английском и представился.'),
    c2: A('yes', [4, 5], 'Оператор дважды попросил клиента описать вопрос.'),
    c3: NA([6], 'Запрос не прозвучал, защищённых действий не было — идентификация не требовалась.'),
    c4: NA([2, 6], 'Клиент покинул чат, не сформулировав запрос.'),
    c5: A('yes', [4, 5], 'Оператор вежлив и через минуту напомнил о себе.'),
    c6: A(10, [5], 'Реплики ясные, клиенту не пришлось переспрашивать.'),
    c7: NA([6, 7], 'Клиент покинул чат — завершить диалог не было возможности.'),
    c8: A('no', [], 'Нарушений не выявлено.', { checked_range: [4, 5] }),
  },
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const desc = (steps) => [...steps].map(Number).sort((a, b) => b - a);

/** Подгоняет заготовленный ответ под изменённый критерий (другая шкала, тип, запрет N/A). */
function adapt(scripted, seed, criterion) {
  const a = scripted.answer;
  if (validAnswer(criterion, a)) return scripted;
  if (a === 'na') return null;
  let frac;
  if (seed.type === 'scale') frac = a / Math.max(...seed.scale_steps);
  else frac = a === 'yes' ? 1 : 0;
  if (criterion.type === 'scale') {
    const steps = desc(criterion.scale_steps);
    const max = steps[0] || 0;
    const best = steps.reduce((b, s) => (Math.abs(s / max - frac) < Math.abs(b / max - frac) ? s : b), steps[0]);
    return { ...scripted, answer: best };
  }
  return { ...scripted, answer: frac >= 0.5 ? 'yes' : 'no' };
}

function generic(conv, criterion) {
  const ops = conv.transcript.map((r, i) => (r.speaker === 'operator' ? i : -1)).filter((i) => i >= 0);
  const from = ops[0] ?? 0;
  const to = ops[ops.length - 1] ?? Math.max(0, conv.transcript.length - 1);
  const h = hash(conv.conversation_id + '|' + criterion.id + '|' + criterion.title);
  const pick = ops.length ? [ops[h % ops.length]] : [];
  const note = 'Mock-оценка: реальное обоснование вернёт модель на бэкенде.';
  if (criterion.type === 'scale') {
    const steps = desc(criterion.scale_steps);
    const step = steps[Math.min(steps.length - 1, h % 3 === 0 ? 1 : 0)];
    return A(step, pick, `Критерий «${criterion.title}»: выбрана ступень ${step} по репликам оператора. ${note}`);
  }
  const bad = criterion.is_flag ? h % 5 === 0 : h % 4 === 0;
  const answer = bad ? (criterion.is_flag ? 'yes' : 'no') : criterion.is_flag ? 'no' : 'yes';
  const missed = answer === 'no'; // пропущенное действие или проверка без нарушений — показываем проверенный участок
  return A(answer, answer === 'no' && !criterion.is_flag ? [] : pick,
    `Критерий «${criterion.title}»: ${criterion.is_flag ? (answer === 'yes' ? 'нарушение выявлено' : 'нарушение не выявлено') : answer === 'yes' ? 'действие выполнено' : 'ожидаемое действие не найдено'}. ${note}`,
    missed ? { checked_range: [from, to] } : {});
}

export function evaluate(conv, checklist, evaluationId, createdAt) {
  const script = SCRIPTS[conv.conversation_id] || MIXED_RESPONSES[conv.conversation_id] || {};
  const items = checklist.criteria.map((c) => {
    const seed = [...SEED_CRITERIA,...MIXED_CHECKLIST.criteria].find((s) => s.id === c.id);
    let res = null;
    if (script[c.id] && seed && seed.title === c.title) res = adapt(script[c.id], seed, c);
    if (!res) res = generic(conv, c);
    return { criterion_id: c.id, ...res };
  });
  const answers = Object.fromEntries(items.map((i) => [i.criterion_id, i.answer]));
  const calc = calculate(checklist.criteria, answers);
  return {
    id: evaluationId,
    conversation_id: conv.conversation_id,
    checklist_id: checklist.id,
    checklist_version: checklist.version,
    created_at: createdAt,
    total: calc.total,
    gross_flag: calc.gross_flag,
    sections: calc.sections.map(({ section, points, max, percent }) => ({ section, points, max, percent })),
    items: items.map((it) => {
      const row = calc.rows.find((r) => r.criterion_id === it.criterion_id);
      return {
        id: `${evaluationId}:${it.criterion_id}`,
        criterion_id: it.criterion_id,
        answer: it.answer,
        points: round2(row.points),
        explanation: it.explanation,
        evidence: it.evidence,
        checked_range: it.checked_range,
        na_reason: it.answer === 'na' ? it.na_reason || 'Условие N/A выполнено.' : null,
      };
    }),
  };
}
