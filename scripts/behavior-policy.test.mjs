import assert from "node:assert/strict";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { interpretBehaviorText } = loadTypeScript("src/behavior/behavior-policy.ts");
const intent = (text) => interpretBehaviorText(text);

for (const text of ["подожди", "let’s continue later", "I'll be right back", "I will be right back"])
  assert.equal(intent(text).pause, true, `${text} should pause`);
for (const text of ["продовжуй", "я повернувся", "continue", "let’s continue"])
  assert.equal(intent(text).resume, true, `${text} should resume`);
assert.equal(intent("let’s continue later").resume, false, "a later continuation is a pause, not a resume");
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
