import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { interpretBehaviorText } = loadTypeScript("src/behavior/behavior-policy.ts");
const intent = (text) => interpretBehaviorText(text);

for (const text of ["подожди", "let’s continue later", "I'll be right back", "I will be right back"])
  assert.equal(intent(text).pause, true, `${text} should pause`);
for (const text of ["продовжуй", "я повернувся", "continue", "let’s continue"])
  assert.equal(intent(text).resume, true, `${text} should resume`);
assert.equal(intent("let’s continue later").resume, false, "a later continuation is a pause, not a resume");
for (const text of ["Lass gut sein", "Bitte lass gut sein!", "Lass es gut sein, bitte.", "Lassen wir es gut sein…"]) {
  assert.equal(intent(text).drop, true, `${text} should close a pending task`);
  assert.equal(intent(text).gameStop, true, `${text} should stop an active game`);
  assert.equal(intent(text).pause, false, `${text} is a close, not a pause`);
}
for (const text of ["Lass uns später weitermachen", "Wir machen später weiter.", "Bitte, lass uns später weitermachen, bitte!", "Lass gut sein, wir machen später weiter.", "Lass es gut sein; lass uns später weitermachen."]) {
  assert.equal(intent(text).pause, true, `${text} should pause for later`);
  assert.equal(intent(text).resume, false, `${text} must not resume immediately`);
  assert.equal(intent(text).drop, false, `${text} must preserve the pending task`);
  assert.equal(intent(text).gameStop, false, `${text} must not stop a game`);
}
assert.equal(intent("Ich bin wieder da!").resume, true, "a clear return should resume an ordinary pending intention");
for (const text of ["später", "Lass gut sein, wir machen später weiter?", "Lass gut sein, wir machen nicht später weiter.", "Lass gut sein?", "Bitte lass gut sein?", "Lass gut sein nicht", "Nicht lass gut sein", "Wenn ich sage, lass gut sein", "Er meinte, lass gut sein", 'Er sagte: "Lass gut sein"', "Lass uns später weitermachen?", "Wir machen später weiter?", "Lass uns nicht später weitermachen", "Ich bin nicht wieder da", "Ich bin wieder da?", 'Er sagte: "Ich bin wieder da"']) {
  const result = intent(text);
  assert.equal(result.pause || result.resume || result.drop || result.gameStop, false, `${text} must not cross a conversation boundary`);
}
assert.equal(intent("Vergiss die Aufgabe").drop, true);
assert.equal(intent("Vergiss die Aufgabe").gameStop, false, "task-specific drop commands do not stop games");
for (const text of ["привет", "привіт"])
  assert.equal(intent(text).greeting, true, `${text} should be recognized as a greeting`);
for (const text of ["молодец", "вийшло"])
  assert.equal(intent(text).success, true, `${text} should be recognized as success`);

assert.equal(intent("hello").greeting, true);
assert.equal(intent("hold on a second").pause, true);
assert.equal(intent("where were we?").resume, false, "questions must not resume an intention");
assert.equal(intent("I guess two").guess, 2);
assert.equal(intent("2").guess, 2);
assert.equal(intent("может два").guess, 2);
assert.equal(intent("not two").guess, null, "negated guesses are not answers");
assert.equal(intent("I have 2 dogs and 3 cats").guess, null, "narrative numbers are not guesses");

for (const text of ["Don't continue yet", "Soll ich weitermachen?", 'Er sagte: "Mach weiter"', "where were we?"])
  assert.equal(intent(text).resume, false, `${text} must not resume an intention`);
for (const text of ["Mach weiter", "Weiter", "Let's continue", "продолжай"])
  assert.equal(intent(text).resume, true, `${text} should resume an intention`);
for (const text of ["Nicht vergessen: die Aufgabe", "Vergiss nicht die Aufgabe", "Don't forget it", 'Er sagte: "Vergiss die Aufgabe"'])
  assert.equal(intent(text).drop, false, `${text} must not discard an intention`);
for (const text of ["Vergiss die Aufgabe", "Vergiss das", "Forget it", "неважно"])
  assert.equal(intent(text).drop, true, `${text} should discard an intention`);
for (const text of ["Warte kurz", "Warte bitte kurz", "let’s continue later", "подожди"])
  assert.equal(intent(text).pause, true, `${text} should pause an intention`);
for (const text of ["Don't wait", "Warte kurz?", "Warte nicht", 'Er sagte: "Warte kurz"', "не жди"])
  assert.equal(intent(text).pause, false, `${text} must not pause an intention`);
assert.equal(intent("Let's play a guessing game").gameStart, true);
assert.equal(intent("давай сыграем в угадайку").gameStart, true);
assert.equal(intent("stop the game").gameStop, true);
assert.equal(intent("не начинай игру").gameStart, false);

for (const text of ['"let’s play a game"', "Don't start a game", "Can we play a game?", "He said 'stop the game'"])
  assert.equal(intent(text).gameStart || intent(text).gameStop, false, `${text} is not a game command`);
for (const text of ['"don’t nod so much"', "He said 'don't nod so much'"])
  assert.equal(intent(text).style, null, `${text} is not a style correction`);
assert.equal(intent("don't nod so much").style, "less_nod");
for (const text of ["Sei lebendiger", "Bitte sei ein bisschen verspielter.", "Be more playful.", "Будь більш жвавим"]) {
  assert.equal(intent(text).style, "lively_playful", `${text} explicitly chooses a livelier style`);
}
for (const text of ["Sei ruhiger", "Bitte sprich etwas ruhiger.", "Be calmer", "Будь спокойнее", "Будь спокійнішим"]) {
  assert.equal(intent(text).style, "calmer", `${text} explicitly chooses a calmer style`);
}
for (const text of ["Sei wieder normal", "Sei wieder du selbst", "Rede wie vorher", "Be your usual self"]) {
  assert.equal(intent(text).style, "default_personality", `${text} restores the default character`);
}
for (const text of ["Sei heute lebendiger", "Sei lebendiger für dieses Spiel", "Sei nicht lebendiger", "Sollst du ruhiger sein?", 'Er sagte: "Sei ruhiger"', "Wenn ich sage, sei ruhiger", "Don't be calmer", "Be more playful tomorrow", "Make it lively"]) {
  assert.equal(intent(text).style, null, `${text} does not change the durable style`);
}

for (const text of [
  "No, I meant the blue box.",
  "Nein, ich meinte die blaue Schachtel.",
  "Нет, я имел в виду синюю коробку.",
  "Ні, я мав на увазі синю коробку.",
]) assert.equal(intent(text).correction, true, `${text} should repair the previous reference`);
for (const text of [
  "Correction to Gerda: It landed beside the tree.",
  "Please correct the memory about Gerda: It did not fly.",
  "Could you fix the memory about Gerda: It landed beside the tree?",
  "Bitte korrigiere die Erinnerung an Gerda: Sie flog nicht.",
  "Kannst du die Erinnerung an Gerda korrigieren: Sie landete am Baum?",
  "Исправление к Герда: Она приземлилась у дерева.",
  "Пожалуйста исправь память о Герда: Она приземлилась у дерева.",
  "Можешь исправить память о Герда: Она приземлилась у дерева?",
  "Виправлення до Герда: Вона приземлилася біля дерева.",
  "Будь ласка виправ запис про Герда: Вона приземлилася біля дерева.",
  "Можеш виправити запис про Герда: Вона приземлилася біля дерева?",
]) assert.equal(intent(text).correction, true, `${text} should fence stale responses before a saved-memory correction`);
for (const text of [
  'He said "Correction to Gerda: It landed beside the tree."',
  'Er sagte „Bitte korrigiere die Erinnerung an Gerda.“',
  "Do not correct the memory about Gerda: It landed beside the tree.",
  "Korrigiere die Erinnerung an Gerda nicht: Sie landete neben dem Baum.",
  "Can you fix the camera?",
  "What would a correction to the memory about Gerda change?",
  "Если я скажу исправь память о Герда, что будет?",
]) assert.equal(intent(text).correction, false, `${text} does not request a memory repair`);
for (const text of [
  "Nein, die blaue Schachtel ist nicht richtig.",
  "Нет, эта коробка неправильная.",
  "Ні, ця коробка не та.",
  'Er sagte: "Nein, ich meinte die blaue Schachtel."',
  "He said: Нет, я имел в виду синюю коробку.",
  "Nein, war es die blaue Schachtel?",
  "Нет, это синяя коробка?",
]) assert.equal(intent(text).correction, false, `${text} is not an explicit correction marker`);

assert.equal(intent("Greet me with a nod").greetingRitual, "nod");
assert.equal(intent("Always greet me cheerfully").greetingRitual, "happy_bob");
assert.equal(intent("Begrüß mich mit einem Nicken").greetingRitual, "nod");
assert.equal(intent("Stop greeting gestures").greetingRitual, "off");
assert.equal(intent("Keine Begrüßungsgesten mehr").greetingRitual, "off");
for (const text of [
  "Don't greet me with a nod",
  "Could you greet me with a nod?",
  'Er sagte: "Greet me with a nod"',
  "'Greet me with a nod'",
]) assert.equal(intent(text).greetingRitual, null, `${text} is not an explicit greeting ritual preference`);

for (const text of ["подождишь", "приветствие", "молодецкий", "вийшлов" ]) {
  const result = intent(text);
  assert.equal(result.pause || result.greeting || result.success, false, `${text} must not match inside a longer word`);
}

console.log("Behavior policy multilingual intent tests: PASS");
