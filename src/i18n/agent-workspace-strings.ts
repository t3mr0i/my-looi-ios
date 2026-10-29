import type { InterfaceLanguage } from "./ui-language";

const en = {
  title: "Your assistant",
  intro:
    "Let LOOI help with your day. Try it first, or connect your own Hermes.",
  tryTitle: "Try it out",
  tryHelp: "Explore a day plan, emails and an invitation with made-up data.",
  tryAction: "Try with examples",
  connectTitle: "Connect Hermes",
  connectHelp:
    "Already have your own Hermes? Use the connection code from its owner.",
  connectAction: "Set up Hermes",
  back: "Back",
  home: "Back to LOOI",
  exampleBadge: "Example data",
  exampleMailNotice: "A made-up email. Nothing is sent.",
  openMail: "Open email",
  exampleNotice:
    "Everything here is made up. No account is connected and nothing is sent.",
  day: "My day",
  mail: "Emails",
  appointment: "Plan a meeting",
  runDay: "Show my day",
  runMail: "Show example emails",
  runAppointment: "Prepare invitation",
  dayIntro: "What does my morning look like?",
  dayResult: "Two things are planned. There is time for a break in between.",
  eventOne: "09:00 · Work on the project",
  eventTwo: "11:00 · Workshop with Mira",
  exampleDay: "Example day · Europe/Berlin",
  mailIntro: "Read an email and prepare a reply.",
  mailAccount: "Example inbox",
  sender: "From",
  recipient: "To",
  subject: "Subject",
  received: "Example day · 08:30",
  senderName: "Mira Example",
  subjectOne: "Our workshop",
  bodyOne:
    "Hi!\n\nShall we meet at 11 to work on our robot project? Please bring your sketches.\n\nSee you soon!\nMira",
  subjectTwo: "Materials for our project",
  bodyTwo:
    "Hi!\n\nThe cardboard and coloured pens are ready. We can start after the break.\n\nMira",
  draftTitle: "Your reply draft",
  draftHelp:
    "You can edit this text. It stays on this screen and is never sent.",
  draftPlaceholder: "Write a reply…",
  prepareReply: "Prepare a reply",
  replyText: "Hi Mira, 11 works for me. I'll bring my sketches!",
  closeMail: "Back to emails",
  appointmentIntro:
    "LOOI prepares the details. You check them before anything changes.",
  eventTitle: "Robot workshop",
  eventTime: "Example day · 11:00–11:30 · Europe/Berlin",
  calendar: "Calendar",
  exampleCalendar: "Example calendar",
  attendee: "Guest",
  inviteEffect:
    "A real invitation would email this person. This example sends no email.",
  review: "Check invitation",
  reviewTitle: "Is everything correct?",
  approve: "Approve example",
  approved: "Example approved. No invitation was sent.",
  uncertainAction: "Try a connection problem",
  uncertainTitle: "Result unknown",
  uncertainHelp:
    "A real connection could stop after sending. Check the calendar before trying again. This example did not send anything.",
  restart: "Start this example again",
  leaveExamples: "Back to assistant",
  privateNote:
    "Personal results belong on the screen. Reading them aloud needs a separate choice.",
  setupTitle: "Set up Hermes",
  setupIntro:
    "Hermes works on tasks for LOOI. Someone you trust runs it on their own server.",
  stepCode: "1. Paste the code",
  stepReview: "2. Check the connection",
  codeLabel: "Connection code",
  codePlaceholder: "LOOI1.…",
  codeHelp:
    "Ask the person who runs your Hermes for this code. Keep it private: it grants access to their tasks.",
  noCode: "No code yet? You can try the examples without one.",
  manual: "Enter address and access key instead",
  address: "Server address",
  key: "Access key",
  addressHelp:
    "Use the complete https:// address supplied by the server owner.",
  continue: "Continue",
  invalidCode:
    "This code is not valid. Ask for a new copy, or enter the address and key.",
  invalidManual:
    "Check the https:// address and access key. The key must have at least 32 letters, digits, dashes or underscores.",
  hostLabel: "Your tasks will go to",
  consent:
    "When you start a task, its text goes to this server and its AI provider. Choose a server whose owner you trust.",
  limits:
    "This connection supports research tasks. Google Mail and Calendar are not connected by this setup.",
  confirm: "Connect to this server",
  checking: "Checking connection…",
  connected: "Hermes is connected",
  connectedHelp:
    "You can now start research tasks. No task has been started by this check.",
  toTasks: "Go to tasks",
  editCode: "Use a different code",
  connectionFailed:
    "Could not connect. Check the code and internet connection, then try again.",
  authFailed:
    "The server did not accept this key. Ask its owner for a current code.",
  storageFailed:
    "The connection could not be saved on this device. Check the available storage and try again.",
  capabilityTitle: "What your Hermes can do",
  research: "Research and prepare plans",
  researchHelp:
    "Available through your connection. You start each task yourself.",
  accounts: "Google Mail and Calendar",
  unavailable:
    "Check which accounts Nous offers for this Hermes. Connecting alone does not enable email or calendar tools.",
  setupPaused: "Setup was paused. Paste the code again when you are ready.",
  schoolHelp:
    "If a school or parent manages your account, their permissions also apply.",
} as const;

type Strings = { [K in keyof typeof en]: string };
const de: Strings = {
  title: "Dein Assistent",
  intro:
    "LOOI hilft dir bei deinem Tag. Probiere es aus oder verbinde deinen eigenen Hermes.",
  tryTitle: "Erst mal ausprobieren",
  tryHelp:
    "Entdecke Tagesplan, E-Mails und eine Einladung mit erfundenen Daten.",
  tryAction: "Mit Beispielen ausprobieren",
  connectTitle: "Hermes verbinden",
  connectHelp:
    "Du hast schon einen eigenen Hermes? Nimm den Verbindungscode von der Person, die ihn betreibt.",
  connectAction: "Hermes einrichten",
  back: "Zurück",
  home: "Zu LOOI",
  exampleBadge: "Beispieldaten",
  exampleMailNotice: "Eine erfundene Mail. Nichts wird verschickt.",
  openMail: "Mail öffnen",
  exampleNotice:
    "Hier ist alles erfunden. Kein Konto ist verbunden und nichts wird verschickt.",
  day: "Mein Tag",
  mail: "E-Mails",
  appointment: "Termin planen",
  runDay: "Meinen Tag zeigen",
  runMail: "Beispiel-Mails zeigen",
  runAppointment: "Einladung vorbereiten",
  dayIntro: "Wie sieht mein Vormittag aus?",
  dayResult: "Zwei Dinge stehen an. Dazwischen bleibt Zeit für eine Pause.",
  eventOne: "09:00 · Am Projekt arbeiten",
  eventTwo: "11:00 · Workshop mit Mira",
  exampleDay: "Beispieltag · Europe/Berlin",
  mailIntro: "Lies eine Mail und bereite eine Antwort vor.",
  mailAccount: "Beispiel-Postfach",
  sender: "Von",
  recipient: "An",
  subject: "Betreff",
  received: "Beispieltag · 08:30",
  senderName: "Mira Beispiel",
  subjectOne: "Unser Workshop",
  bodyOne:
    "Hallo!\n\nTreffen wir uns um 11 Uhr für unser Roboterprojekt? Bring bitte deine Skizzen mit.\n\nBis gleich!\nMira",
  subjectTwo: "Material für unser Projekt",
  bodyTwo:
    "Hallo!\n\nDie Pappe und die bunten Stifte liegen bereit. Nach der Pause können wir loslegen.\n\nMira",
  draftTitle: "Dein Antwortentwurf",
  draftHelp:
    "Du kannst den Text ändern. Er bleibt auf dieser Seite und wird nie verschickt.",
  draftPlaceholder: "Schreibe eine Antwort …",
  prepareReply: "Antwort vorbereiten",
  replyText: "Hallo Mira, 11 Uhr passt. Ich bringe meine Skizzen mit!",
  closeMail: "Zurück zu den Mails",
  appointmentIntro:
    "LOOI bereitet die Angaben vor. Du prüfst sie, bevor sich etwas ändert.",
  eventTitle: "Roboter-Workshop",
  eventTime: "Beispieltag · 11:00–11:30 · Europe/Berlin",
  calendar: "Kalender",
  exampleCalendar: "Beispiel-Kalender",
  attendee: "Gast",
  inviteEffect:
    "Eine echte Einladung würde dieser Person eine E-Mail schicken. Dieses Beispiel verschickt nichts.",
  review: "Einladung prüfen",
  reviewTitle: "Stimmt alles?",
  approve: "Beispiel freigeben",
  approved: "Beispiel freigegeben. Es wurde keine Einladung verschickt.",
  uncertainAction: "Verbindungsproblem ausprobieren",
  uncertainTitle: "Ausgang noch unklar",
  uncertainHelp:
    "Eine echte Verbindung könnte nach dem Senden abbrechen. Prüfe dann den Kalender, bevor du es erneut versuchst. Dieses Beispiel hat nichts verschickt.",
  restart: "Dieses Beispiel neu starten",
  leaveExamples: "Zurück zum Assistenten",
  privateNote:
    "Persönliche Ergebnisse gehören zuerst auf den Bildschirm. Vorlesen wird gesondert ausgewählt.",
  setupTitle: "Hermes einrichten",
  setupIntro:
    "Hermes erledigt Aufgaben für LOOI. Eine Person, der du vertraust, betreibt ihn auf ihrem Server.",
  stepCode: "1. Code einfügen",
  stepReview: "2. Verbindung prüfen",
  codeLabel: "Verbindungscode",
  codePlaceholder: "LOOI1.…",
  codeHelp:
    "Du bekommst den Code von der Person, die deinen Hermes betreibt. Halte ihn geheim: Er gibt Zugriff auf deren Aufgaben.",
  noCode: "Noch keinen Code? Die Beispiele kannst du auch ohne ausprobieren.",
  manual: "Stattdessen Adresse und Zugangsschlüssel eingeben",
  address: "Serveradresse",
  key: "Zugangsschlüssel",
  addressHelp:
    "Nimm die vollständige https://-Adresse von der Person, die den Server betreibt.",
  continue: "Weiter",
  invalidCode:
    "Dieser Code stimmt nicht. Lass ihn dir noch einmal geben oder nutze Adresse und Schlüssel.",
  invalidManual:
    "Prüfe die https://-Adresse und den Zugangsschlüssel. Der Schlüssel braucht mindestens 32 Buchstaben, Ziffern, Bindestriche oder Unterstriche.",
  hostLabel: "Deine Aufgaben gehen an",
  consent:
    "Wenn du eine Aufgabe startest, geht ihr Text an diesen Server und dessen KI-Anbieter. Wähle einen Server, dessen Betreiber du vertraust.",
  limits:
    "Diese Verbindung kann Rechercheaufgaben übernehmen. Google Mail und Kalender werden damit noch nicht verbunden.",
  confirm: "Mit diesem Server verbinden",
  checking: "Verbindung wird geprüft …",
  connected: "Hermes ist verbunden",
  connectedHelp:
    "Du kannst jetzt Rechercheaufgaben starten. Die Prüfung hat keine Aufgabe gestartet.",
  toTasks: "Zu den Aufgaben",
  editCode: "Anderen Code verwenden",
  connectionFailed:
    "Die Verbindung klappt nicht. Prüfe den Code und deine Internetverbindung. Versuche es dann noch einmal.",
  authFailed:
    "Der Server nimmt diesen Schlüssel nicht an. Bitte die betreibende Person um einen aktuellen Code.",
  storageFailed:
    "Die Verbindung konnte auf diesem Gerät nicht gespeichert werden. Prüfe den freien Speicher und versuche es noch einmal.",
  capabilityTitle: "Das kann dein Hermes",
  research: "Recherchieren und Pläne vorbereiten",
  researchHelp:
    "Mit deiner Verbindung verfügbar. Du startest jede Aufgabe selbst.",
  accounts: "Google Mail und Kalender",
  unavailable:
    "Prüfe, welche Konten Nous für diesen Hermes anbietet. Das Verbinden allein schaltet noch keine Mail- oder Kalenderwerkzeuge frei.",
  setupPaused:
    "Die Einrichtung wurde unterbrochen. Füge den Code erneut ein, wenn du weitermachen möchtest.",
  schoolHelp:
    "Wenn deine Schule oder deine Eltern das Konto verwalten, gelten auch deren Freigaben.",
};
const uk: Strings = {
  title: "Твій помічник",
  intro:
    "LOOI допоможе спланувати день. Спробуй приклади або підключи власний Hermes.",
  tryTitle: "Спочатку спробувати",
  tryHelp: "План дня, листи та запрошення з вигаданими даними.",
  tryAction: "Спробувати приклади",
  connectTitle: "Підключити Hermes",
  connectHelp: "Вже маєш власний Hermes? Візьми код у людини, яка ним керує.",
  connectAction: "Налаштувати Hermes",
  back: "Назад",
  home: "До LOOI",
  exampleBadge: "Приклад даних",
  exampleMailNotice: "Вигаданий лист. Нічого не надсилається.",
  openMail: "Відкрити лист",
  exampleNotice:
    "Усі дані вигадані. Жоден обліковий запис не підключено, нічого не надсилається.",
  day: "Мій день",
  mail: "Листи",
  appointment: "Запланувати зустріч",
  runDay: "Показати мій день",
  runMail: "Показати приклади листів",
  runAppointment: "Підготувати запрошення",
  dayIntro: "Які плани на ранок?",
  dayResult: "Заплановано дві справи. Між ними є час на перерву.",
  eventOne: "09:00 · Робота над проєктом",
  eventTwo: "11:00 · Зустріч із Мірою",
  exampleDay: "Приклад дня · Europe/Berlin",
  mailIntro: "Прочитай лист і підготуй відповідь.",
  mailAccount: "Приклад поштової скриньки",
  sender: "Від",
  recipient: "Кому",
  subject: "Тема",
  received: "Приклад дня · 08:30",
  senderName: "Міра Приклад",
  subjectOne: "Наша зустріч",
  bodyOne:
    "Привіт!\n\nЗустрінемося об 11 для роботи над роботом? Візьми свої ескізи.\n\nДо зустрічі!\nМіра",
  subjectTwo: "Матеріали для проєкту",
  bodyTwo:
    "Привіт!\n\nКартон і кольорові ручки вже готові. Почнемо після перерви.\n\nМіра",
  draftTitle: "Чернетка відповіді",
  draftHelp:
    "Текст можна змінити. Він залишається на цій сторінці й ніколи не надсилається.",
  draftPlaceholder: "Напиши відповідь…",
  prepareReply: "Підготувати відповідь",
  replyText: "Привіт, Міро! Об 11 підходить. Візьму ескізи!",
  closeMail: "Назад до листів",
  appointmentIntro: "LOOI підготує дані. Ти перевіриш їх перед змінами.",
  eventTitle: "Робота над роботом",
  eventTime: "Приклад дня · 11:00–11:30 · Europe/Berlin",
  calendar: "Календар",
  exampleCalendar: "Приклад календаря",
  attendee: "Гість",
  inviteEffect:
    "Справжнє запрошення надіслало б лист цій людині. Цей приклад нічого не надсилає.",
  review: "Перевірити запрошення",
  reviewTitle: "Усе правильно?",
  approve: "Схвалити приклад",
  approved: "Приклад схвалено. Запрошення не надсилалося.",
  uncertainAction: "Спробувати збій з’єднання",
  uncertainTitle: "Результат невідомий",
  uncertainHelp:
    "Справжнє з’єднання може зникнути після надсилання. Перевір календар перед повтором. Цей приклад нічого не надсилав.",
  restart: "Почати приклад знову",
  leaveExamples: "Назад до помічника",
  privateNote:
    "Особисті результати спочатку на екрані. Озвучення обирається окремо.",
  setupTitle: "Налаштувати Hermes",
  setupIntro:
    "Hermes виконує завдання для LOOI. Його сервером керує людина, якій ти довіряєш.",
  stepCode: "1. Встав код",
  stepReview: "2. Перевір з’єднання",
  codeLabel: "Код підключення",
  codePlaceholder: "LOOI1.…",
  codeHelp:
    "Попроси код у людини, яка керує Hermes. Тримай його в таємниці: він дає доступ до її завдань.",
  noCode: "Ще немає коду? Приклади працюють без нього.",
  manual: "Ввести адресу та ключ доступу",
  address: "Адреса сервера",
  key: "Ключ доступу",
  addressHelp: "Використай повну https://-адресу від власника сервера.",
  continue: "Далі",
  invalidCode: "Код недійсний. Попроси нову копію або введи адресу та ключ.",
  invalidManual:
    "Перевір https://-адресу та ключ. Ключ має містити щонайменше 32 літери, цифри, дефіси чи підкреслення.",
  hostLabel: "Твої завдання надходитимуть сюди",
  consent:
    "Після запуску текст завдання передається цьому серверу та його постачальнику ШІ. Обирай сервер, власнику якого довіряєш.",
  limits:
    "Це підключення підтримує дослідницькі завдання. Google Mail і Календар ще не підключаються.",
  confirm: "Підключитися до сервера",
  checking: "Перевірка з’єднання…",
  connected: "Hermes підключено",
  connectedHelp:
    "Тепер можна запускати дослідницькі завдання. Перевірка не запустила жодного.",
  toTasks: "До завдань",
  editCode: "Використати інший код",
  connectionFailed:
    "Не вдалося підключитися. Перевір код та інтернет і спробуй знову.",
  authFailed: "Сервер не прийняв ключ. Попроси власника надати чинний код.",
  storageFailed:
    "Не вдалося зберегти підключення. Перевір вільне місце та спробуй знову.",
  capabilityTitle: "Що вміє твій Hermes",
  research: "Дослідження та підготовка планів",
  researchHelp: "Доступно через це підключення. Кожне завдання запускаєш ти.",
  accounts: "Google Mail і Календар",
  unavailable:
    "Перевір, які підключення пропонує Nous для цього Hermes. Саме підключення ще не вмикає поштові чи календарні інструменти.",
  setupPaused: "Налаштування призупинено. Встав код знову, коли будеш готовий.",
  schoolHelp:
    "Якщо обліковим записом керують школа чи батьки, діють і їхні дозволи.",
};
const ru: Strings = {
  title: "Твой помощник",
  intro:
    "LOOI поможет спланировать день. Попробуй примеры или подключи свой Hermes.",
  tryTitle: "Сначала попробовать",
  tryHelp: "План дня, письма и приглашение с вымышленными данными.",
  tryAction: "Попробовать примеры",
  connectTitle: "Подключить Hermes",
  connectHelp:
    "Уже есть свой Hermes? Возьми код у человека, который им управляет.",
  connectAction: "Настроить Hermes",
  back: "Назад",
  home: "К LOOI",
  exampleBadge: "Пример данных",
  exampleMailNotice: "Вымышленное письмо. Ничего не отправляется.",
  openMail: "Открыть письмо",
  exampleNotice:
    "Все данные вымышлены. Аккаунты не подключены, ничего не отправляется.",
  day: "Мой день",
  mail: "Письма",
  appointment: "Назначить встречу",
  runDay: "Показать мой день",
  runMail: "Показать примеры писем",
  runAppointment: "Подготовить приглашение",
  dayIntro: "Какие планы на утро?",
  dayResult: "Запланировано два дела. Между ними есть время на перерыв.",
  eventOne: "09:00 · Работа над проектом",
  eventTwo: "11:00 · Встреча с Мирой",
  exampleDay: "Пример дня · Europe/Berlin",
  mailIntro: "Прочитай письмо и подготовь ответ.",
  mailAccount: "Пример почтового ящика",
  sender: "От",
  recipient: "Кому",
  subject: "Тема",
  received: "Пример дня · 08:30",
  senderName: "Мира Пример",
  subjectOne: "Наша встреча",
  bodyOne:
    "Привет!\n\nВстретимся в 11 для работы над роботом? Возьми свои эскизы.\n\nДо встречи!\nМира",
  subjectTwo: "Материалы для проекта",
  bodyTwo:
    "Привет!\n\nКартон и цветные ручки готовы. Начнём после перерыва.\n\nМира",
  draftTitle: "Черновик ответа",
  draftHelp:
    "Текст можно изменить. Он остаётся на этой странице и никогда не отправляется.",
  draftPlaceholder: "Напиши ответ…",
  prepareReply: "Подготовить ответ",
  replyText: "Привет, Мира! В 11 подходит. Возьму эскизы!",
  closeMail: "Назад к письмам",
  appointmentIntro:
    "LOOI подготовит данные. Ты проверишь их перед изменениями.",
  eventTitle: "Работа над роботом",
  eventTime: "Пример дня · 11:00–11:30 · Europe/Berlin",
  calendar: "Календарь",
  exampleCalendar: "Пример календаря",
  attendee: "Гость",
  inviteEffect:
    "Настоящее приглашение отправило бы письмо этому человеку. Этот пример ничего не отправляет.",
  review: "Проверить приглашение",
  reviewTitle: "Всё правильно?",
  approve: "Одобрить пример",
  approved: "Пример одобрен. Приглашение не отправлялось.",
  uncertainAction: "Попробовать сбой соединения",
  uncertainTitle: "Результат неизвестен",
  uncertainHelp:
    "Настоящее соединение может оборваться после отправки. Проверь календарь перед повтором. Этот пример ничего не отправлял.",
  restart: "Начать пример заново",
  leaveExamples: "Назад к помощнику",
  privateNote:
    "Личные результаты сначала на экране. Озвучивание выбирается отдельно.",
  setupTitle: "Настроить Hermes",
  setupIntro:
    "Hermes выполняет задания для LOOI. Его сервером управляет человек, которому ты доверяешь.",
  stepCode: "1. Вставь код",
  stepReview: "2. Проверь соединение",
  codeLabel: "Код подключения",
  codePlaceholder: "LOOI1.…",
  codeHelp:
    "Попроси код у человека, который управляет Hermes. Храни его в тайне: он даёт доступ к его заданиям.",
  noCode: "Ещё нет кода? Примеры работают и без него.",
  manual: "Ввести адрес и ключ доступа",
  address: "Адрес сервера",
  key: "Ключ доступа",
  addressHelp: "Используй полный https://-адрес от владельца сервера.",
  continue: "Далее",
  invalidCode:
    "Код недействителен. Попроси новую копию или введи адрес и ключ.",
  invalidManual:
    "Проверь https://-адрес и ключ. Ключ должен содержать не менее 32 букв, цифр, дефисов или подчёркиваний.",
  hostLabel: "Твои задания будут отправлены сюда",
  consent:
    "После запуска текст задания передаётся этому серверу и его поставщику ИИ. Выбирай сервер, владельцу которого доверяешь.",
  limits:
    "Это подключение поддерживает исследовательские задания. Google Mail и Календарь пока не подключаются.",
  confirm: "Подключиться к серверу",
  checking: "Проверка соединения…",
  connected: "Hermes подключён",
  connectedHelp:
    "Теперь можно запускать исследовательские задания. Проверка не запустила ни одного.",
  toTasks: "К заданиям",
  editCode: "Использовать другой код",
  connectionFailed:
    "Не удалось подключиться. Проверь код и интернет и попробуй снова.",
  authFailed: "Сервер не принял ключ. Попроси владельца дать действующий код.",
  storageFailed:
    "Не удалось сохранить подключение. Проверь свободное место и попробуй снова.",
  capabilityTitle: "Что умеет твой Hermes",
  research: "Исследования и подготовка планов",
  researchHelp: "Доступно через это подключение. Каждое задание запускаешь ты.",
  accounts: "Google Mail и Календарь",
  unavailable:
    "Проверь, какие подключения Nous предлагает для этого Hermes. Само подключение ещё не включает почтовые или календарные инструменты.",
  setupPaused:
    "Настройка приостановлена. Вставь код снова, когда будешь готов.",
  schoolHelp:
    "Если аккаунтом управляют школа или родители, действуют и их разрешения.",
};

const translations = { en, de, uk, ru } satisfies Record<
  InterfaceLanguage,
  Strings
>;
export type AgentWorkspaceKey = keyof typeof en;
export function agentWorkspaceText(language: InterfaceLanguage) {
  return (key: AgentWorkspaceKey): string => translations[language][key];
}
