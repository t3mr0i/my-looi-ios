import type { InterfaceLanguage } from "./ui-language";
const en = {
  title: "Connect accounts",
  open: "Connect through Nous",
  intro:
    "Your Hermes uses Nous for email and calendar connections. This page checks accounts and setup; it does not read emails or events.",
  check: "Check connection status",
  checking: "Checking Nous…",
  serverLogin:
    "This Hermes is not signed in to Nous yet. Ask the person who runs it to sign in to their Nous account first.",
  unsupported:
    "This Hermes needs an update before it can manage Nous connections here. Your research tasks still work.",
  identityWarning:
    "Only connect your email if this Nous account belongs to you. Its owner can use the connected accounts.",
  confirmIdentity: "This is my Nous account",
  account: "This Hermes uses the Nous account",
  gmail: "Google Mail",
  googlecalendar: "Google Calendar",
  unavailable:
    "Nous does not offer this connection for this account right now.",
  connect: "Connect account",
  connected: "Connected through Nous",
  pending: "Not connected yet",
  startFailed:
    "The start could not be confirmed. Check the connection status before starting again.",
  error: "Could not check Nous. Try checking again when you have a connection.",
  privacy:
    "Nous and its integration service handle the sign-in. In the browser, check which account and permissions you are choosing. Connecting does not give LOOI permission to send email or change events.",
  browserTitle: "Continue in your browser",
  browserHost: "Sign-in website",
  browser: "Open sign-in",
  browserHelp:
    "After signing in, return here and check the connection status. Closing the browser does not confirm a connection.",
  manage: "Manage accounts in Nous",
  manageHelp:
    "Disconnecting an account in Nous can affect other Hermes apps using that account too.",
};
type Strings = { [K in keyof typeof en]: string };
const de: Strings = {
  title: "Konten verbinden",
  open: "Über Nous verbinden",
  intro:
    "Dein Hermes nutzt Nous für E-Mail und Kalender. Diese Seite prüft Konten und Einrichtung. Sie liest keine Mails oder Termine.",
  check: "Verbindungsstatus prüfen",
  checking: "Nous wird geprüft …",
  serverLogin:
    "Dieser Hermes ist noch nicht bei Nous angemeldet. Bitte die Person, die ihn betreibt, zuerst ihr Nous-Konto anzumelden.",
  unsupported:
    "Dieser Hermes braucht ein Update, damit du hier Nous-Verbindungen verwalten kannst. Deine Rechercheaufgaben funktionieren weiter.",
  identityWarning:
    "Verbinde deine Mail nur, wenn dieses Nous-Konto dir gehört. Die Person, der es gehört, kann die verbundenen Konten verwenden.",
  confirmIdentity: "Das ist mein Nous-Konto",
  account: "Dieser Hermes verwendet das Nous-Konto",
  gmail: "Google Mail",
  googlecalendar: "Google Calendar",
  unavailable: "Nous bietet diese Verbindung für dieses Konto gerade nicht an.",
  connect: "Konto verbinden",
  connected: "Über Nous verbunden",
  pending: "Noch nicht verbunden",
  startFailed:
    "Der Start konnte nicht bestätigt werden. Prüfe den Verbindungsstatus, bevor du es erneut versuchst.",
  error:
    "Nous konnte nicht geprüft werden. Versuche es mit bestehender Internetverbindung erneut.",
  privacy:
    "Nous und dessen Integrationsdienst übernehmen die Anmeldung. Prüfe im Browser, welches Konto und welche Rechte du auswählst. Das Verbinden erlaubt LOOI noch nicht, Mails zu verschicken oder Termine zu ändern.",
  browserTitle: "Im Browser weitermachen",
  browserHost: "Webseite für die Anmeldung",
  browser: "Anmeldung öffnen",
  browserHelp:
    "Kehre nach der Anmeldung zurück und prüfe den Verbindungsstatus. Ein geschlossener Browser bestätigt noch keine Verbindung.",
  manage: "Konten bei Nous verwalten",
  manageHelp:
    "Wenn du ein Konto bei Nous trennst, kann das auch andere Hermes-Apps betreffen, die dieses Konto nutzen.",
};
const uk: Strings = {
  title: "Підключити облікові записи",
  open: "Підключити через Nous",
  intro:
    "Твій Hermes використовує Nous для пошти й календаря. Ця сторінка перевіряє підключення, не читаючи листів чи подій.",
  check: "Перевірити стан",
  checking: "Перевірка Nous…",
  serverLogin:
    "Цей Hermes ще не ввійшов у Nous. Попроси людину, яка ним керує, спочатку ввійти у свій обліковий запис Nous.",
  unsupported:
    "Цей Hermes потрібно оновити для керування підключеннями Nous. Дослідницькі завдання працюють як раніше.",
  identityWarning:
    "Підключай пошту, лише якщо цей обліковий запис Nous належить тобі. Його власник може використовувати підключені облікові записи.",
  confirmIdentity: "Це мій обліковий запис Nous",
  account: "Цей Hermes використовує обліковий запис Nous",
  gmail: "Google Mail",
  googlecalendar: "Google Calendar",
  unavailable:
    "Nous зараз не пропонує це підключення для цього облікового запису.",
  connect: "Підключити обліковий запис",
  connected: "Підключено через Nous",
  pending: "Ще не підключено",
  startFailed:
    "Не вдалося підтвердити початок. Перевір стан перед повторною спробою.",
  error: "Не вдалося перевірити Nous. Спробуй знову, коли буде інтернет.",
  privacy:
    "Вхід обробляють Nous та його сервіс інтеграції. Перевір обліковий запис і дозволи в браузері. Підключення ще не дозволяє LOOI надсилати листи чи змінювати події.",
  browserTitle: "Продовжити в браузері",
  browserHost: "Сайт для входу",
  browser: "Відкрити вхід",
  browserHelp:
    "Після входу повернися й перевір стан. Закриття браузера не підтверджує підключення.",
  manage: "Керувати обліковими записами в Nous",
  manageHelp:
    "Відключення в Nous може вплинути на інші програми Hermes, які використовують цей обліковий запис.",
};
const ru: Strings = {
  title: "Подключить аккаунты",
  open: "Подключить через Nous",
  intro:
    "Твой Hermes использует Nous для почты и календаря. Эта страница проверяет подключение, не читая писем и событий.",
  check: "Проверить состояние",
  checking: "Проверка Nous…",
  serverLogin:
    "Этот Hermes ещё не вошёл в Nous. Попроси человека, который им управляет, сначала войти в свой аккаунт Nous.",
  unsupported:
    "Этот Hermes нужно обновить для управления подключениями Nous. Исследовательские задания работают как раньше.",
  identityWarning:
    "Подключай почту, только если этот аккаунт Nous принадлежит тебе. Его владелец может использовать подключённые аккаунты.",
  confirmIdentity: "Это мой аккаунт Nous",
  account: "Этот Hermes использует аккаунт Nous",
  gmail: "Google Mail",
  googlecalendar: "Google Calendar",
  unavailable: "Nous сейчас не предлагает это подключение для этого аккаунта.",
  connect: "Подключить аккаунт",
  connected: "Подключён через Nous",
  pending: "Ещё не подключён",
  startFailed:
    "Не удалось подтвердить начало. Проверь состояние перед повторной попыткой.",
  error: "Не удалось проверить Nous. Попробуй снова, когда будет интернет.",
  privacy:
    "Вход обрабатывают Nous и его сервис интеграции. Проверь аккаунт и разрешения в браузере. Подключение ещё не позволяет LOOI отправлять письма или менять события.",
  browserTitle: "Продолжить в браузере",
  browserHost: "Сайт для входа",
  browser: "Открыть вход",
  browserHelp:
    "После входа вернись и проверь состояние. Закрытие браузера не подтверждает подключение.",
  manage: "Управлять аккаунтами в Nous",
  manageHelp:
    "Отключение в Nous может затронуть другие приложения Hermes, использующие этот аккаунт.",
};
export function nousText(language: InterfaceLanguage) {
  return (key: keyof typeof en): string => ({ en, de, uk, ru })[language][key];
}
