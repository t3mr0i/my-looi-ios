import type { InterfaceLanguage } from "./ui-language";

const en = {
  title: "Adaptive behavior",
  intro: "Choose whether LOOI can use conversation context to guide small reactions.",
  modeLabel: "Mode",
  modeOff: "Off",
  modeOffHelp: "No behavior requests are sent.",
  modeShadow: "Shadow",
  modeShadowHelp: "Sends requests and records results, with no effect on movement or speech behavior.",
  modeActive: "Active",
  modeActiveHelp: "May adjust attention and small gestures from the results.",
  modeA11y: "{mode} behavior mode",
  budgetLabel: "Daily app-side budget",
  budgetHelp: "Stops new requests at this estimated amount. Provider billing can differ; this is not a hard billing cap.",
  budgetOptionA11y: "Estimated daily budget {amount}",
  dataNotice: "When enabled, recent spoken text and robot context are sent to OpenAI. This can use your saved API key and incur charges.",
  visualLabel: "Allow requested snapshots",
  visualHelp: "Only a snapshot you explicitly request can be sent. This feature never captures images automatically or streams video.",
  compareLabel: "Compare possible reactions",
  compareHelp: "Consider more than one reaction when choosing what fits.",
  useLabel: "Recorded use",
  requests: "Requests",
  completed: "Completed",
  errors: "Errors",
  stale: "Stale results",
  recordedCost: "Recorded cost",
  posture: "Posture",
  postureAttend: "Attending",
  postureReflect: "Reflecting",
  postureYield: "Giving space",
  postureSettle: "Settling",
  gameTitle: "Guess a number",
  gameHelp: "Play a quick game. Available during an active conversation.",
  gameStart: "Start · 1–3",
  gameStop: "Stop game",
  gameA11yStart: "Start the number guessing game from one to three",
  gameA11yStop: "Stop the number guessing game",
  resetTitle: "Clear learned behavior?",
  resetMessage: "This removes learned behavior preferences. Your daily budget setting stays in place.",
  resetLearning: "Clear learning",
  resetDone: "Learned behavior preferences cleared.",
  cancel: "Cancel",
  selected: "Selected",
  countCapped: "999,999+",
} as const;

export type BehaviorStringKey = keyof typeof en;
type BehaviorStrings = Record<BehaviorStringKey, string>;

const uk: BehaviorStrings = {
  title: "Адаптивна поведінка",
  intro: "Виберіть, чи може LOOI використовувати контекст розмови для невеликих реакцій.",
  modeLabel: "Режим",
  modeOff: "Вимкнено",
  modeOffHelp: "Запити для поведінки не надсилаються.",
  modeShadow: "Тіньовий",
  modeShadowHelp: "Надсилає запити й записує результати, але не впливає на рухи чи мовлення.",
  modeActive: "Активний",
  modeActiveHelp: "За результатами може змінювати увагу та невеликі жести.",
  modeA11y: "Режим поведінки: {mode}",
  budgetLabel: "Денний бюджет у застосунку",
  budgetHelp: "Зупиняє нові запити після цієї оцінки. Рахунок провайдера може відрізнятися; це не жорсткий ліміт оплати.",
  budgetOptionA11y: "Орієнтовний денний бюджет: {amount}",
  dataNotice: "Увімкнений режим надсилає до OpenAI недавній мовлений текст і контекст робота. Використовується ваш збережений ключ API, можливі витрати.",
  visualLabel: "Дозволити запитані знімки",
  visualHelp: "Надіслати можна лише знімок, який ви явно попросили. Ця функція не знімає автоматично й не транслює відео.",
  compareLabel: "Порівнювати можливі реакції",
  compareHelp: "Розглядати кілька реакцій, щоб вибрати доречну.",
  useLabel: "Записане використання",
  requests: "Запити",
  completed: "Виконано",
  errors: "Помилки",
  stale: "Застарілі результати",
  recordedCost: "Записані витрати",
  posture: "Позиція",
  postureAttend: "Увага",
  postureReflect: "Роздуми",
  postureYield: "Дає простір",
  postureSettle: "Заспокоєння",
  gameTitle: "Вгадай число",
  gameHelp: "Швидка гра під час активної розмови.",
  gameStart: "Почати · 1–3",
  gameStop: "Зупинити гру",
  gameA11yStart: "Почати гру: вгадати число від одного до трьох",
  gameA11yStop: "Зупинити гру з числами",
  resetTitle: "Очистити вивчену поведінку?",
  resetMessage: "Вивчені налаштування поведінки буде видалено. Денний бюджет залишиться без змін.",
  resetLearning: "Очистити навчання",
  resetDone: "Вивчені налаштування поведінки очищено.",
  cancel: "Скасувати",
  selected: "Вибрано",
  countCapped: "999 999+",
};

const ru: BehaviorStrings = {
  title: "Адаптивное поведение",
  intro: "Выберите, может ли LOOI использовать контекст разговора для небольших реакций.",
  modeLabel: "Режим",
  modeOff: "Выключен",
  modeOffHelp: "Запросы для поведения не отправляются.",
  modeShadow: "Теневой",
  modeShadowHelp: "Отправляет запросы и записывает результаты, не влияя на движения и речь.",
  modeActive: "Активный",
  modeActiveHelp: "По результатам может менять внимание и небольшие жесты.",
  modeA11y: "Режим поведения: {mode}",
  budgetLabel: "Дневной бюджет в приложении",
  budgetHelp: "Останавливает новые запросы при достижении этой оценки. Счёт провайдера может отличаться; это не жёсткий лимит оплаты.",
  budgetOptionA11y: "Расчётный дневной бюджет: {amount}",
  dataNotice: "В активном режиме в OpenAI отправляются недавний произнесённый текст и контекст робота. Используется сохранённый API-ключ, возможны расходы.",
  visualLabel: "Разрешить запрошенные снимки",
  visualHelp: "Можно отправить только снимок, который вы явно запросили. Эта функция не делает снимки автоматически и не передаёт видео.",
  compareLabel: "Сравнивать возможные реакции",
  compareHelp: "Рассматривать несколько реакций, чтобы выбрать подходящую.",
  useLabel: "Записанное использование",
  requests: "Запросы",
  completed: "Выполнено",
  errors: "Ошибки",
  stale: "Устаревшие результаты",
  recordedCost: "Записанные расходы",
  posture: "Положение",
  postureAttend: "Внимание",
  postureReflect: "Размышление",
  postureYield: "Даёт пространство",
  postureSettle: "Успокоение",
  gameTitle: "Угадай число",
  gameHelp: "Быстрая игра во время активного разговора.",
  gameStart: "Начать · 1–3",
  gameStop: "Остановить игру",
  gameA11yStart: "Начать игру: угадать число от одного до трёх",
  gameA11yStop: "Остановить игру с числами",
  resetTitle: "Очистить изученное поведение?",
  resetMessage: "Изученные настройки поведения будут удалены. Дневной бюджет останется без изменений.",
  resetLearning: "Очистить обучение",
  resetDone: "Изученные настройки поведения очищены.",
  cancel: "Отмена",
  selected: "Выбрано",
  countCapped: "999 999+",
};

const translations: Record<InterfaceLanguage, BehaviorStrings> = { en, uk, ru };

export function createBehaviorTranslator(language: InterfaceLanguage) {
  return (key: BehaviorStringKey, params?: Record<string, string | number>) =>
    tBehavior(language, key, params);
}

export function tBehavior(
  language: InterfaceLanguage,
  key: BehaviorStringKey,
  params?: Record<string, string | number>
): string {
  let value = translations[language][key] ?? en[key];
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}
