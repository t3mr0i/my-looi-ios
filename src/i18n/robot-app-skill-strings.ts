import type { InterfaceLanguage } from "./ui-language";

const en = {
  title: "App skills", detail: "Let LOOI find and use the right app",
  intro: "LOOI can choose the right app during your conversation.",
  enabled: "Let AI use apps", enabledHelp: "LOOI searches the catalog and starts a suitable app during your conversation.",
  installTitle: "Ready when needed", installHelp: "Python apps install on your companion when you first need them.",
  keepTitle: "Keep your apps", keepHelp: "Apps stay installed until you remove them yourself.",
  webTitle: "Web apps", webHelp: "Web apps open directly in their original interface.",
  browse: "Find apps", setup: "Connect companion", current: "Current app", stop: "Stop app",
  idle: "Ready to find an app", resolving: "Finding app…", preparing: "Preparing connection…", installing: "Installing app…", starting: "Starting app…", running: "App running", browser: "Opening original app", browserReleased: "Close the original app view to finish.", complete: "App finished", stopping: "Stopping app…", stopped: "App stopped", failed: "Could not start the app. Try again.", off: "AI app selection is off",
  stopFailed: "Could not confirm that the app stopped. Try again.", unavailable: "App status is unavailable. Try again.",
  loadError: "Could not load app skill settings.", saveError: "Could not save this setting.", retry: "Try again", resetSetting: "Reset setting",
} as const;
type Strings = { [K in keyof typeof en]: string };
const de: Strings = {
  title: "App-Skills", detail: "LOOI findet und nutzt die passende App",
  intro: "LOOI kann im Gespräch die passende App für dich auswählen.",
  enabled: "KI darf Apps nutzen", enabledHelp: "LOOI durchsucht den Katalog und startet im Gespräch eine passende App.",
  installTitle: "Bereit, wenn du sie brauchst", installHelp: "Python-Apps werden beim ersten Einsatz auf deinem Companion installiert.",
  keepTitle: "Apps bleiben erhalten", keepHelp: "Apps bleiben installiert, bis du sie selbst entfernst.",
  webTitle: "Web-Apps", webHelp: "Web-Apps starten direkt in ihrer originalen Oberfläche.",
  browse: "Apps entdecken", setup: "Companion verbinden", current: "Aktuelle App", stop: "App stoppen",
  idle: "Bereit für eine passende App", resolving: "App wird gesucht…", preparing: "Verbindung wird vorbereitet…", installing: "App wird installiert…", starting: "App wird gestartet…", running: "App läuft", browser: "Original-App wird geöffnet", browserReleased: "Schließe die Ansicht der Original-App zum Beenden.", complete: "App beendet", stopping: "App wird gestoppt…", stopped: "App gestoppt", failed: "Die App konnte nicht gestartet werden. Versuche es erneut.", off: "Die KI-App-Auswahl ist aus",
  stopFailed: "Das Stoppen der App konnte nicht bestätigt werden. Versuche es erneut.", unavailable: "Der App-Status ist gerade nicht verfügbar. Versuche es erneut.",
  loadError: "App-Skill-Einstellungen konnten nicht geladen werden.", saveError: "Diese Einstellung konnte nicht gespeichert werden.", retry: "Erneut versuchen", resetSetting: "Einstellung zurücksetzen",
};
const uk: Strings = {
  title: "Навички застосунків", detail: "LOOI знаходить і використовує потрібний застосунок",
  intro: "LOOI може вибрати застосунок із каталогу, що відповідає твоєму запиту.",
  enabled: "Дозволити ШІ використовувати застосунки", enabledHelp: "LOOI шукає в каталозі й запускає потрібний застосунок під час розмови.",
  installTitle: "Готові, коли потрібні", installHelp: "Python-застосунки автоматично встановлюються на підключеному companion під час першого використання.",
  keepTitle: "Застосунки зберігаються", keepHelp: "Застосунки зберігаються, доки ти їх не видалиш.",
  webTitle: "Вебзастосунки", webHelp: "Вебзастосунки відкривають свій оригінальний інтерфейс для використання.",
  browse: "Знайти застосунки", setup: "Підключити companion", current: "Поточний застосунок", stop: "Зупинити застосунок",
  idle: "Готовий знайти застосунок", resolving: "Пошук застосунку…", preparing: "Підготовка з’єднання…", installing: "Встановлення застосунку…", starting: "Запуск застосунку…", running: "Застосунок працює", browser: "Відкриття оригінального застосунку", browserReleased: "Закрий вікно оригінального застосунку для завершення.", complete: "Застосунок завершено", stopping: "Зупинка застосунку…", stopped: "Застосунок зупинено", failed: "Не вдалося запустити застосунок. Спробуй ще раз.", off: "Вибір застосунків ШІ вимкнено",
  stopFailed: "Не вдалося підтвердити зупинку застосунку. Спробуй ще раз.", unavailable: "Статус застосунку зараз недоступний. Спробуй ще раз.",
  loadError: "Не вдалося завантажити налаштування навичок.", saveError: "Не вдалося зберегти налаштування.", retry: "Спробувати ще раз", resetSetting: "Скинути налаштування",
};
const ru: Strings = {
  title: "Навыки приложений", detail: "LOOI находит и использует нужное приложение",
  intro: "LOOI может выбрать приложение из каталога, подходящее к твоему запросу.",
  enabled: "Разрешить ИИ использовать приложения", enabledHelp: "LOOI ищет в каталоге и запускает подходящее приложение во время разговора.",
  installTitle: "Готовы, когда нужны", installHelp: "Python-приложения автоматически устанавливаются на подключённом companion при первом использовании.",
  keepTitle: "Приложения сохраняются", keepHelp: "Приложения остаются установленными, пока ты их не удалишь.",
  webTitle: "Веб-приложения", webHelp: "Веб-приложения открывают свой оригинальный интерфейс для использования.",
  browse: "Найти приложения", setup: "Подключить companion", current: "Текущее приложение", stop: "Остановить приложение",
  idle: "Готов найти приложение", resolving: "Поиск приложения…", preparing: "Подготовка соединения…", installing: "Установка приложения…", starting: "Запуск приложения…", running: "Приложение работает", browser: "Открытие оригинального приложения", browserReleased: "Закрой окно оригинального приложения для завершения.", complete: "Приложение завершено", stopping: "Остановка приложения…", stopped: "Приложение остановлено", failed: "Не удалось запустить приложение. Попробуй ещё раз.", off: "Выбор приложений ИИ выключен",
  stopFailed: "Не удалось подтвердить остановку приложения. Попробуй ещё раз.", unavailable: "Статус приложения сейчас недоступен. Попробуй ещё раз.",
  loadError: "Не удалось загрузить настройки навыков.", saveError: "Не удалось сохранить настройку.", retry: "Попробовать ещё раз", resetSetting: "Сбросить настройку",
};
export type RobotAppSkillStringKey = keyof typeof en;
export function createRobotAppSkillsTranslator(language: InterfaceLanguage) {
  const strings: Strings = language === "de" ? de : language === "uk" ? uk : language === "ru" ? ru : en;
  return (key: RobotAppSkillStringKey): string => strings[key];
}
