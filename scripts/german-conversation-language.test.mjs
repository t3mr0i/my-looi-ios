import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { getStoredPreferencesVersionInfo } from "./helpers/stored-preferences-version.mjs";

const load = createTypeScriptTreeLoader();
const responseLanguage = load("src/language/response-language.ts");
const listeningLanguage = load("src/language/listening-language.ts");
const responseMessages = load("src/language/response-messages.ts");
const ttsVoices = load("src/voice/tts-voices.ts");
const realtime = load("src/voice/realtime-config.ts");

assert.equal(responseLanguage.normalizeResponseLanguage("de"), "de");
assert.equal(listeningLanguage.normalizeListeningLanguage("de"), "de");
assert.ok(responseLanguage.RESPONSE_LANGUAGE_OPTIONS.some(({ id }) => id === "de"));
assert.ok(listeningLanguage.LISTENING_LANGUAGE_OPTIONS.some(({ id }) => id === "de"));

// Explicitly switch future speech; distinguish a full conversation request
// from a reply-only request and from a one-off translation.
assert.equal(responseLanguage.detectLanguageSwitchCommand("Sprich ab jetzt Deutsch mit mir"), "de");
assert.equal(responseLanguage.detectLanguageSwitchCommand("Antworte auf Deutsch"), "de");
assert.equal(responseLanguage.detectLanguageSwitchCommand("Sprich bitte auf Englisch mit mir"), "en");
assert.equal(responseLanguage.detectLanguageSwitchCommand("Antworte bitte auf Ukrainisch"), "uk");
assert.equal(responseLanguage.detectLanguageSwitchCommand("Übersetze das ins Deutsche"), null);
assert.equal(responseLanguage.detectLanguageSwitchCommand("Wie sagt man hello auf Deutsch?"), null);
assert.equal(responseLanguage.getLanguageSwitchAcknowledgement("de"), "Alles klar, ich spreche ab jetzt Deutsch.");
assert.equal(responseLanguage.getResponseLanguageName("de"), "German");

assert.equal(listeningLanguage.detectListeningLanguageSwitchCommand("Ändere die Eingabesprache auf Deutsch"), "de");
assert.equal(listeningLanguage.detectListeningLanguageSwitchCommand("Ändere die Sprache der Antworten auf Deutsch"), null);
assert.equal(responseLanguage.detectLanguageSwitchCommand("Ändere die Sprache der Antworten auf Deutsch"), "de");
assert.equal(listeningLanguage.detectListeningLanguageSwitchCommand("Hör mir ab jetzt auf Deutsch zu"), "de");
assert.equal(listeningLanguage.detectListeningLanguageSwitchCommand("Hör nicht auf Deutsch zu"), null);
assert.equal(listeningLanguage.detectListeningLanguageSwitchCommand("Höre mir auf Englisch zu"), "en");
assert.equal(listeningLanguage.detectListeningLanguageSwitchCommand("Höre mir auf Russisch zu"), "ru");
assert.equal(
  listeningLanguage.getListeningLanguageSwitchAcknowledgement("de", "de"),
  "Alles klar, ich höre ab jetzt Deutsch."
);

assert.match(responseMessages.getVoiceResponseMessage("de", "command-missing"), /Sag nach/);
assert.equal(ttsVoices.getTtsPreviewText("de"), "Hallo! So klingt meine Stimme jetzt.");

const update = realtime.buildRealtimeSessionUpdate({
  language: "de",
  listeningLanguage: "de",
  realtimeModelId: "gpt-realtime-mini",
  ttsVoiceId: "cedar",
  ttsSpeed: 1,
  speechGender: "masculine",
  robotName: "Louis",
  robotAddressAliases: ["Louis"],
  robotAddressRecognitionAliases: [],
});
assert.equal(update.session.audio.input.transcription.language, "de");
assert.match(update.session.audio.input.transcription.prompt, /speaking German/);
assert.match(update.session.instructions, /default language for normal replies: German/);
assert.match(update.session.instructions, /expected input\/listening language is German/);
assert.match(update.session.instructions, /Sprich ab jetzt Deutsch mit mir/);
assert.match(update.session.instructions, /Antworte auf Deutsch/);
assert.match(update.session.instructions, /Übersetze das ins Deutsche/);

const languageTool = update.session.tools.find(({ name }) => name === "set_language_preferences");
assert.deepEqual(languageTool.parameters.properties.response_language.enum, ["ru", "uk", "en", "de"]);
assert.deepEqual(languageTool.parameters.properties.listening_language.enum, ["ru", "uk", "en", "de"]);
assert.match(languageTool.description, /one-off translation/i);
assert.match(realtime.buildSharedCountdownInstructions("de"), /Drei\. Zwei\. Eins\. Los!/);

const store = readFileSync("src/store/user.ts", "utf8");
assert.match(store, /VoiceCommandLanguage = "ru" \| "uk" \| "en" \| "de"/);
assert.match(store, /raw\.language === "de"/);
const versions = getStoredPreferencesVersionInfo(store);
assert.equal(versions.currentVersion, versions.migrationVersion);
assert.ok(versions.supportedVersions.includes(versions.currentVersion));

console.log("German conversation language support: PASS");
