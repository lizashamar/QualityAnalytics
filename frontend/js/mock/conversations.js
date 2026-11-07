// Демо-диалоги в формате API (record). Метки времени — как придут с бэкенда:
// у чатов "MM:SS", у звонков ISO 8601 с поясом. audio_url "mock-audio:<сек>" mock-слой
// заменяет на синтетическую WAV-запись (blob), чтобы перемотка работала без файлов.

export const MOCK_CONVERSATIONS = [
  {
    conversation_id: 'chat-ru-001',
    channel: 'agent chat',
    language: 'RU',
    audio_url: null,
    transcript: [
      { timestamp: '00:00', speaker: 'system', text: 'Чат начат из личного кабинета' },
      { timestamp: '00:00', speaker: 'bot', text: 'Здравствуйте! Я виртуальный помощник. Опишите вопрос, и я переключу вас на специалиста.' },
      { timestamp: '00:06', speaker: 'client', text: 'Здравствуйте. Подала заявку на вывод 150 000 ₸ на карту три дня назад, деньги так и не пришли. Заявка №W-4521.' },
      { timestamp: '00:07', speaker: 'system', text: 'Чат передан оператору' },
      { timestamp: '00:41', speaker: 'operator', text: 'Здравствуйте! Меня зовут Алия, я специалист поддержки Freedom Broker. Сожалею, что вам пришлось ждать. Чтобы посмотреть заявку, подтвердите, пожалуйста, ИИН и кодовое слово.' },
      { timestamp: '01:05', speaker: 'client', text: 'ИИН 900101300123, кодовое слово — «Алатау».' },
      { timestamp: '01:20', speaker: 'operator', text: 'Спасибо, личность подтверждена. Проверяю заявку, это займёт около двух минут.' },
      { timestamp: '03:02', speaker: 'operator', text: 'Заявка W-4521 задержалась на стороне банка-получателя. Я отправила повторный запрос, деньги поступят в течение 1 рабочего дня. Номер обращения — 77812.' },
      { timestamp: '03:20', speaker: 'client', text: 'Хорошо, а почему вообще так долго?' },
      { timestamp: '03:31', speaker: 'operator', text: 'Если до завтра деньги не придут, напишите нам с номером обращения 77812 — проверим в приоритете. Всего доброго!' },
      { timestamp: '03:35', speaker: 'system', text: 'Чат завершён оператором' },
    ],
  },
  {
    conversation_id: 'call-ru-002',
    channel: 'voice call',
    language: 'RU',
    audio_url: 'mock-audio:75',
    transcript: [
      { timestamp: '2026-11-04T10:15:00+05:00', speaker: 'system', text: 'Входящий звонок на линию поддержки' },
      { timestamp: '2026-11-04T10:15:03+05:00', speaker: 'operator', text: 'Freedom Broker, служба поддержки, Тимур, здравствуйте.' },
      { timestamp: '2026-11-04T10:15:09+05:00', speaker: 'client', text: 'Здравствуйте. Мне три дня не отвечают на письма, это безобразие!' },
      { timestamp: '2026-11-04T10:15:20+05:00', speaker: 'operator', text: 'Не кричите. Я не обязан отвечать за чужие письма.' },
      { timestamp: '2026-11-04T10:15:31+05:00', speaker: 'client', text: 'Вы мне хамите? У меня на счёте висит неисполненная заявка на покупку облигаций.' },
      { timestamp: '2026-11-04T10:15:45+05:00', speaker: 'operator', text: 'Слушайте, заявки — это не ко мне. Если хотите нормальную доходность, переведите мне лично на карту, я вложу ваши деньги выгоднее.' },
      { timestamp: '2026-11-04T10:16:02+05:00', speaker: 'client', text: 'Что? Я этот разговор записываю.' },
      { timestamp: '2026-11-04T10:16:08+05:00', speaker: 'operator', text: 'Как хотите.' },
      { timestamp: '2026-11-04T10:16:12+05:00', speaker: 'system', text: 'Звонок завершён оператором' },
    ],
  },
  {
    conversation_id: 'chat-kz-014',
    channel: 'agent chat',
    language: 'KZ',
    audio_url: null,
    transcript: [
      { timestamp: '00:03', speaker: 'client', text: 'Сәлеметсіз бе, шотқа ақша салдым, бірақ балансқа түспеді. Не істеу керек?' },
      { timestamp: '03:40', speaker: 'operator', text: 'Күте тұрыңыз.' },
      { timestamp: '04:05', speaker: 'operator', text: 'Жақын арада түседі.' },
      { timestamp: '04:20', speaker: 'client', text: 'Нақты қашан? Төлем екі сағат бұрын жасалды, түбіртегі бар.' },
      { timestamp: '04:50', speaker: 'operator', text: 'Білмеймін, банкке жазыңыз.' },
      { timestamp: '04:55', speaker: 'system', text: 'Чат оператормен жабылды' },
    ],
  },
  {
    conversation_id: 'chat-kz-027',
    channel: 'agent chat',
    language: 'KZ',
    audio_url: null,
    transcript: [
      { timestamp: '00:00', speaker: 'bot', text: 'Сәлеметсіз бе! Мен виртуалды көмекшімін. Сұрағыңызды жазыңыз.' },
      { timestamp: '00:08', speaker: 'client', text: 'Сәлем. Тарифтер туралы білгім келеді: шетелдік акцияларды сатып алу комиссиясы қанша?' },
      { timestamp: '00:09', speaker: 'system', text: 'Чат операторға ауыстырылды' },
      { timestamp: '00:35', speaker: 'operator', text: 'Сәлеметсіз бе! Менің атым Ұлжан, Freedom Broker қолдау қызметі. Қай тарифті қолданасыз және қай биржада сауда жасағыңыз келеді?' },
      { timestamp: '01:02', speaker: 'client', text: 'Тариф «Стандарт», АҚШ биржасы.' },
      { timestamp: '01:30', speaker: 'operator', text: 'Рақмет. «Стандарт» тарифінде АҚШ биржасындағы әр мәміле үшін комиссия — сомадан 0,1%, ең аз мөлшері 1,2 $. Толық кесте: freedombroker.kz/tariffs.' },
      { timestamp: '01:48', speaker: 'client', text: 'Түсінікті, рақмет! Өте көмектестіңіз.' },
      { timestamp: '01:55', speaker: 'operator', text: 'Басқа сұрағыңыз болса, жазыңыз. Сау болыңыз, күніңіз сәтті өтсін!' },
    ],
  },
  {
    conversation_id: 'chat-en-031',
    channel: 'agent chat',
    language: 'EN',
    audio_url: null,
    transcript: [
      { timestamp: '00:02', speaker: 'client', text: 'Hi, the app crashes every time I open my portfolio.' },
      { timestamp: '00:20', speaker: 'operator', text: "Hello, I'm Maria from Freedom Broker support. Sorry about that! Which device and app version are you using?" },
      { timestamp: '00:45', speaker: 'client', text: 'iPhone 14, version 5.2.1' },
      { timestamp: '01:10', speaker: 'operator', text: "Thanks. Please update to 5.2.3 from the App Store, and if it still crashes reinstall the app — I've also emailed you the guide." },
      { timestamp: '01:40', speaker: 'client', text: 'It works now, thanks! Will my watchlists survive a reinstall though?' },
      { timestamp: '01:50', speaker: 'operator', text: 'Glad to hear it works. Anything else I can help with? Have a great day, goodbye!' },
    ],
  },
  {
    conversation_id: 'chat-en-045',
    channel: 'agent chat',
    language: 'EN',
    audio_url: null,
    transcript: [
      { timestamp: '00:00', speaker: 'system', text: 'Chat started from the mobile app' },
      { timestamp: '00:00', speaker: 'bot', text: "Hi! I'm the Freedom Broker assistant. How can I help?" },
      { timestamp: '00:12', speaker: 'client', text: 'hello' },
      { timestamp: '00:13', speaker: 'system', text: 'Chat transferred to an operator' },
      { timestamp: '00:30', speaker: 'operator', text: 'Hello! My name is Arman, Freedom Broker support. How can I help you today?' },
      { timestamp: '01:30', speaker: 'operator', text: "Are you still there? Please describe your question and I'll be happy to help." },
      { timestamp: '04:30', speaker: 'system', text: 'Client left the chat' },
      { timestamp: '04:31', speaker: 'system', text: 'Chat closed automatically due to inactivity' },
    ],
  },
];

/** Диалоги, оценённые при первом запуске демо (остальные — «Не оценён»). */
export const PRE_EVALUATED = ['chat-ru-001', 'call-ru-002', 'chat-kz-014', 'chat-en-031'];
