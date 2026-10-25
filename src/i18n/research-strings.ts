import type { InterfaceLanguage } from "./ui-language";

export type ResearchStringKey = keyof typeof en;

const en = {
  title: "Web research",
  eyebrow: "ON-DEMAND SOURCES",
  intro: "Ask a current question. LOOI searches the web and shows the sources it used.",
  questionLabel: "Question",
  questionPlaceholder: "What should I look up?",
  costNotice:
    "OpenAI Web Search costs about $0.01 per search-tool call, plus Luna input and output tokens. OpenAI may make more than one call, so the total varies.",
  dataNotice:
    "Your question is the only user-provided content sent to OpenAI. Conversation, memory, camera images and robot controls are not included.",
  idleNote: "Nothing is sent until you choose Search the web.",
  search: "Search the web",
  searching: "Searching…",
  cancel: "Cancel search",
  answer: "Answer",
  sources: "Sources",
  cancelled: "Search stopped. No new answer was added.",
  queryEmpty: "Enter a question with at least two characters.",
  queryTooLong: "Keep the question to 600 characters or fewer.",
  errorMissingKey: "Save your OpenAI API key in Settings before searching.",
  errorAuth: "OpenAI did not accept this API key. Check it in Settings.",
  errorRateLimit: "OpenAI is rate limiting requests. Wait a moment, then try again.",
  errorTimeout: "The search took too long and was stopped. Try a shorter question.",
  errorNetwork: "Could not reach OpenAI. Check the connection and try again.",
  errorApi: "OpenAI could not complete this search. Check API access or credits, then try again.",
  errorResponse: "The search returned an unreadable response. Please try again.",
  errorNoCitations: "No verifiable source links came back, so the answer was not shown. Try again.",
  openSource: "Open source: {title}",
  linkError: "Could not open this source link.",
} as const;

type ResearchStrings = Record<ResearchStringKey, string>;

const uk: ResearchStrings = {
  title: "Пошук в інтернеті",
  eyebrow: "ДЖЕРЕЛА НА ЗАПИТ",
  intro: "Поставте актуальне запитання. LOOI пошукає в інтернеті й покаже використані джерела.",
  questionLabel: "Запитання",
  questionPlaceholder: "Що знайти?",
  costNotice:
    "OpenAI Web Search коштує приблизно $0,01 за виклик пошукового інструмента, плюс токени вводу й відповіді Luna. OpenAI може виконати кілька викликів, тому сума змінюється.",
  dataNotice:
    "До OpenAI надсилається лише введене вами запитання. Розмови, пам’ять, зображення з камери й керування роботом не додаються.",
  idleNote: "Дані не надсилаються, доки ви не натиснете «Шукати в інтернеті».",
  search: "Шукати в інтернеті",
  searching: "Шукаю…",
  cancel: "Скасувати пошук",
  answer: "Відповідь",
  sources: "Джерела",
  cancelled: "Пошук зупинено. Нової відповіді не додано.",
  queryEmpty: "Введіть запитання щонайменше з двох символів.",
  queryTooLong: "Запитання має містити не більше ніж 600 символів.",
  errorMissingKey: "Перед пошуком збережіть ключ OpenAI у Налаштуваннях.",
  errorAuth: "OpenAI не прийняв цей ключ API. Перевірте його в Налаштуваннях.",
  errorRateLimit: "OpenAI обмежує частоту запитів. Зачекайте трохи й повторіть спробу.",
  errorTimeout: "Пошук тривав надто довго, його зупинено. Спробуйте коротший запит.",
  errorNetwork: "Не вдалося з’єднатися з OpenAI. Перевірте мережу й повторіть спробу.",
  errorApi: "OpenAI не зміг виконати пошук. Перевірте доступ до API або кошти й повторіть спробу.",
  errorResponse: "Не вдалося прочитати відповідь пошуку. Спробуйте ще раз.",
  errorNoCitations: "Не отримано перевірених посилань на джерела, тому відповідь не показано. Спробуйте ще раз.",
  openSource: "Відкрити джерело: {title}",
  linkError: "Не вдалося відкрити посилання на джерело.",
};

const ru: ResearchStrings = {
  title: "Поиск в интернете",
  eyebrow: "ИСТОЧНИКИ ПО ЗАПРОСУ",
  intro: "Задайте актуальный вопрос. LOOI поищет в интернете и покажет использованные источники.",
  questionLabel: "Вопрос",
  questionPlaceholder: "Что найти?",
  costNotice:
    "OpenAI Web Search стоит около $0,01 за вызов инструмента поиска плюс токены ввода и ответа Luna. OpenAI может выполнить несколько вызовов, поэтому итоговая сумма меняется.",
  dataNotice:
    "В OpenAI отправляется только введённый вами вопрос. Разговор, память, снимки камеры и управление роботом не добавляются.",
  idleNote: "Данные не отправляются, пока вы не нажмёте «Искать в интернете».",
  search: "Искать в интернете",
  searching: "Ищу…",
  cancel: "Отменить поиск",
  answer: "Ответ",
  sources: "Источники",
  cancelled: "Поиск остановлен. Новый ответ не добавлен.",
  queryEmpty: "Введите вопрос длиной не менее двух символов.",
  queryTooLong: "Вопрос должен содержать не больше 600 символов.",
  errorMissingKey: "Перед поиском сохраните ключ OpenAI в настройках.",
  errorAuth: "OpenAI не принял этот API-ключ. Проверьте его в настройках.",
  errorRateLimit: "OpenAI ограничивает частоту запросов. Подождите и попробуйте ещё раз.",
  errorTimeout: "Поиск занял слишком много времени, поэтому он остановлен. Попробуйте сократить вопрос.",
  errorNetwork: "Не удалось подключиться к OpenAI. Проверьте сеть и попробуйте ещё раз.",
  errorApi: "OpenAI не смог выполнить поиск. Проверьте доступ к API или баланс и попробуйте ещё раз.",
  errorResponse: "Не удалось прочитать ответ поиска. Попробуйте ещё раз.",
  errorNoCitations: "Нет проверяемых ссылок на источники, поэтому ответ не показан. Попробуйте ещё раз.",
  openSource: "Открыть источник: {title}",
  linkError: "Не удалось открыть ссылку на источник.",
};

const translations: Record<InterfaceLanguage, ResearchStrings> = { en, uk, ru };

export function createResearchTranslator(language: InterfaceLanguage) {
  return (key: ResearchStringKey, params?: Record<string, string | number>) =>
    tResearch(language, key, params);
}

export function tResearch(
  language: InterfaceLanguage,
  key: ResearchStringKey,
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
