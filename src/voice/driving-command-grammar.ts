import type { ListeningLanguage } from "../language/listening-language";
import type { DrivingCommand } from "./driving-command";

export type DrivingGrammarBundle = {
  phrases: string[];
  commandByPhrase: Map<string, DrivingCommand>;
};

function normalizePhrase(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:()\[\]{}"“”'`~]+/gu, " ")
    .replace(/[\-–—]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function addPhrase(
  map: Map<string, DrivingCommand>,
  phrase: string,
  command: DrivingCommand
): void {
  const normalized = normalizePhrase(phrase);
  if (!normalized || map.has(normalized)) return;
  map.set(normalized, command);
}

function addNaturalVariants(
  map: Map<string, DrivingCommand>,
  command: DrivingCommand,
  bases: string[],
  prefixes: string[],
  suffixes: string[]
): void {
  for (const base of bases) {
    addPhrase(map, base, command);
    for (const prefix of prefixes) addPhrase(map, `${prefix} ${base}`, command);
    for (const suffix of suffixes) addPhrase(map, `${base} ${suffix}`, command);
    // A smaller cross-product covers the very natural "давай X пожалуйста"
    // shape without exploding the graph with every possible filler combination.
    for (const prefix of prefixes.slice(0, 5)) {
      for (const suffix of suffixes.slice(0, 2)) {
        addPhrase(map, `${prefix} ${base} ${suffix}`, command);
      }
    }
  }
}

const STOP_ALL_LANGUAGES = [
  "стоп", "стой", "остановись", "останови", "останови движение", "тормози", "замри", "хватит", "достаточно", "прекрати", "прекрати движение", "не едь", "не езди",
  "стій", "зупинись", "зупини", "зупини рух", "гальмуй", "завмри", "досить", "припини", "припини рух", "не їдь",
  "stop", "halt", "freeze", "brake", "hold", "enough", "stop moving", "stop now", "don't move", "do not move",
  "stopp", "anhalten", "halte an", "bleib stehen", "stehen bleiben", "bremsen", "bremse", "beweg dich nicht", "nicht weiterfahren",
];

export function buildDrivingCommandGrammar(language: ListeningLanguage): DrivingGrammarBundle {
  const commandByPhrase = new Map<string, DrivingCommand>();

  // Safety words are intentionally multilingual at all times.
  for (const phrase of STOP_ALL_LANGUAGES) addPhrase(commandByPhrase, phrase, { kind: "stop" });

  if (language === "ru") {
    const prefixes = [
      "давай", "ну давай", "ну", "теперь", "а теперь", "теперь давай", "а теперь давай",
      "давай ка", "ну ка", "ладно", "хорошо", "окей", "робот", "робот давай", "робот теперь",
      "луи", "луи давай", "луи теперь", "макс", "макс давай", "макс теперь", "луй", "уй", "пожалуйста", "давай пожалуйста", "эй робот",
    ];
    const suffixes = ["пожалуйста", "сейчас", "быстро"];

    addNaturalVariants(commandByPhrase, { kind: "stop" }, [
      "стоп", "стой", "остановись", "останови", "останови движение", "тормози", "замри", "хватит", "достаточно", "прекрати", "прекрати движение", "не едь", "не езди",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "forward" }, [
      "вперед", "вперёд", "прямо", "едь вперед", "едь вперёд", "езжай вперед", "езжай вперёд", "поезжай вперед", "поезжай вперёд", "двигайся вперед", "двигайся вперёд", "поехали вперед", "поехали вперёд", "едь прямо", "езжай прямо", "продолжай вперед", "продолжай вперёд", "двигай вперед", "двигай вперёд",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "backward" }, [
      "назад", "обратно", "едь назад", "езжай назад", "поезжай назад", "двигайся назад", "двигай назад", "поехали назад", "едь обратно", "езжай обратно", "поезжай обратно", "сдай назад", "сдавай назад", "двигайся обратно", "отъедь назад", "отъезжай назад",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "left", degrees: 90 }, [
      "влево", "налево", "лево", "поворот налево", "поворот влево", "поверни налево", "поверни влево", "повернись налево", "повернись влево", "поворачивай налево", "поворачивай влево", "крути налево", "крути влево", "сверни налево", "сверни влево", "развернись налево", "развернись влево",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 90 }, [
      "вправо", "направо", "право", "поворот направо", "поворот вправо", "поверни направо", "поверни вправо", "повернись направо", "повернись вправо", "поворачивай направо", "поворачивай вправо", "крути направо", "крути вправо", "сверни направо", "сверни вправо", "развернись направо", "развернись вправо",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 180 }, [
      "развернись", "разверни", "разворот", "сделай разворот", "сделай полный разворот", "развернись назад", "повернись назад", "кругом", "на сто восемьдесят", "поверни на сто восемьдесят", "развернись на сто восемьдесят", "сделай сто восемьдесят",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 1 }, [
      "кивни", "кивни головой", "подтверди", "подтверди головой", "скажи да головой", "сделай кивок", "один кивок",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 2 }, [
      "кивни два раза", "дважды кивни", "два кивка", "сделай два кивка",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 3 }, [
      "кивни три раза", "трижды кивни", "три кивка", "сделай три кивка",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "happy_bob", count: 1 }, [
      "покачай головой", "помаши головой", "покивай головой", "подвигай головой",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "dance" }, [
      "танцуй", "потанцуй", "станцуй", "станцуй мне", "покажи танец", "сделай танец", "покрутись", "покружись", "давай танцевать",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "sleep" }, [
      "спи", "засни", "усни", "иди спать", "ложись спать", "пора спать",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: true }, [
      "включи свет", "свет включи", "зажги свет", "включи подсветку", "зажги подсветку",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: false }, [
      "выключи свет", "свет выключи", "погаси свет", "выключи подсветку", "погаси подсветку",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "exit" }, [
      "закончили", "всё закончили", "все закончили", "хватит управлять", "обычный режим", "поговорим", "давай поговорим", "вернись к разговору", "режим разговора",
    ], ["", "ну", "давай"], ["", "пожалуйста"]);
  } else if (language === "uk") {
    const prefixes = [
      "давай", "ну давай", "ну", "тепер", "а тепер", "тепер давай", "а тепер давай",
      "ну ж бо", "гаразд", "добре", "окей", "робот", "робот давай", "робот тепер",
      "луї", "луї давай", "луї тепер", "макс", "макс давай", "макс тепер", "луі", "будь ласка", "давай будь ласка", "ей робот",
    ];
    const suffixes = ["будь ласка", "зараз", "швидко"];

    addNaturalVariants(commandByPhrase, { kind: "stop" }, [
      "стоп", "стій", "зупинись", "зупини", "зупини рух", "гальмуй", "завмри", "досить", "припини", "припини рух", "не їдь",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "forward" }, [
      "вперед", "прямо", "їдь вперед", "їдь прямо", "їдь уперед", "поїдь вперед", "поїдь уперед", "рухайся вперед", "рухайся уперед", "поїхали вперед", "поїхали уперед", "продовжуй вперед", "продовжуй уперед",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "backward" }, [
      "назад", "обратно", "їдь назад", "поїдь назад", "рухайся назад", "поїхали назад", "здай назад", "здавай назад", "від'їдь назад", "від'їжджай назад",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "left", degrees: 90 }, [
      "вліво", "наліво", "ліворуч", "поворот наліво", "поворот вліво", "поверни наліво", "поверни вліво", "повернись наліво", "повернись вліво", "повертай наліво", "повертай вліво", "крути наліво", "крути вліво", "зверни наліво", "зверни вліво",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 90 }, [
      "вправо", "направо", "праворуч", "поворот направо", "поворот вправо", "поверни направо", "поверни вправо", "повернись направо", "повернись вправо", "повертай направо", "повертай вправо", "крути направо", "крути вправо", "зверни направо", "зверни вправо",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 180 }, [
      "розвернись", "розверни", "розворот", "зроби розворот", "зроби повний розворот", "розвернись назад", "повернись назад", "кругом", "на сто вісімдесят", "поверни на сто вісімдесят", "розвернись на сто вісімдесят",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 1 }, [
      "кивни", "кивни головою", "підтверди", "підтверди головою", "скажи так головою", "зроби кивок",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 2 }, [
      "кивни два рази", "двічі кивни", "два кивки", "зроби два кивки",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 3 }, [
      "кивни три рази", "тричі кивни", "три кивки", "зроби три кивки",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "happy_bob", count: 1 }, [
      "похитай головою", "помахай головою", "покивай головою", "порухай головою",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "dance" }, [
      "танцюй", "потанцюй", "станцюй", "станцюй мені", "покажи танець", "зроби танець", "покрутись", "покружляй", "давай танцювати",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "sleep" }, [
      "спи", "засни", "засинай", "іди спати", "лягай спати", "час спати",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: true }, [
      "увімкни світло", "включи світло", "світло увімкни", "запали світло", "увімкни підсвітку",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: false }, [
      "вимкни світло", "світло вимкни", "погаси світло", "вимкни підсвітку",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "exit" }, [
      "закінчили", "все закінчили", "досить керувати", "звичайний режим", "поговорімо", "давай поговоримо", "повернись до розмови", "режим розмови",
    ], ["", "ну", "давай"], ["", "будь ласка"]);
  } else if (language === "de") {
    const prefixes = [
      "", "bitte", "jetzt", "los", "jetzt bitte", "okay", "na los", "also",
      "louis", "louis bitte", "louis jetzt", "hey louis", "looi", "looi bitte",
    ];
    const suffixes = ["bitte", "jetzt", "sofort"];

    addNaturalVariants(commandByPhrase, { kind: "stop" }, [
      "stopp", "stop", "halt", "anhalten", "halte an", "bleib stehen", "stehen bleiben",
      "bremse", "bremsen", "beweg dich nicht", "beweg dich keinen schritt", "nicht weiterfahren",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "forward" }, [
      "vorwärts", "vorwaerts", "nach vorne", "nach vorn", "geradeaus", "fahr vorwärts",
      "fahre vorwärts", "fahr nach vorne", "fahre nach vorne", "fahr geradeaus", "fahre geradeaus",
      "beweg dich nach vorne", "beweg dich nach vorn", "fahr los", "vorwärts fahren",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "backward" }, [
      "rückwärts", "rueckwaerts", "zurück", "zurueck", "nach hinten", "fahr rückwärts",
      "fahre rückwärts", "fahr zurück", "fahre zurück", "fahr nach hinten", "fahre nach hinten",
      "setz zurück", "setze zurück", "beweg dich zurück",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "left", degrees: 90 }, [
      "links", "nach links", "linksdrehung", "links drehen", "dreh nach links", "dreh dich nach links",
      "biege links ab", "bieg links ab", "lenk nach links", "schwenk nach links",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 90 }, [
      "rechts", "nach rechts", "rechtsdrehung", "rechts drehen", "dreh nach rechts", "dreh dich nach rechts",
      "biege rechts ab", "bieg rechts ab", "lenk nach rechts", "schwenk nach rechts",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 180 }, [
      "dreh dich um", "dreh um", "drehe dich um", "drehe um", "wende", "wend dich",
      "mach eine kehrtwende", "mach kehrt", "umdrehen", "dreh dich um 180 grad", "um 180 grad drehen",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 1 }, [
      "nick", "nicke", "nick mit dem kopf", "nicke mit dem kopf", "mach einen nick", "nick einmal",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 2 }, [
      "nick zweimal", "nicke zweimal", "nicke zwei mal", "zweimal nicken", "nicke zwei mal mit dem kopf",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 3 }, [
      "nick dreimal", "nicke dreimal", "nicke drei mal", "dreimal nicken", "nicke drei mal mit dem kopf",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "happy_bob", count: 1 }, [
      "schüttle den kopf", "schuettle den kopf", "beweg den kopf", "bewege den kopf", "wackle mit dem kopf",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "dance" }, [
      "tanz", "tanze", "tanz für mich", "tanze für mich", "zeig mir einen tanz", "mach einen tanz",
      "dreh dich und tanz", "tanze für mich",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "sleep" }, [
      "schlaf", "schlafe", "geh schlafen", "schlaf ein", "geh ins bett", "zeit zum schlafen", "gute nacht",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: true }, [
      "licht an", "mach das licht an", "schalte das licht ein", "schalte licht ein", "mach licht an",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: false }, [
      "licht aus", "mach das licht aus", "schalte das licht aus", "schalte licht aus", "mach licht aus",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "exit" }, [
      "fertig", "fahrmodus beenden", "fahrsteuerung beenden", "normaler modus", "zurück zum gespräch",
      "zurück zum gespraech", "lass uns reden", "wir reden weiter", "gesprächsmodus", "gespraechsmodus",
    ], ["", "okay", "bitte"], ["", "bitte"]);
  } else {
    const prefixes = [
      "go", "please", "okay", "ok", "well", "now", "now please", "and now", "now let's",
      "let's", "come on", "alright", "robot", "robot please", "robot now", "looi", "looi please", "max", "max please", "max now",
      "looi now", "hey robot",
    ];
    const suffixes = ["please", "now", "quickly"];

    addNaturalVariants(commandByPhrase, { kind: "stop" }, [
      "stop", "halt", "freeze", "brake", "hold", "enough", "stop moving", "stop now", "don't move", "do not move",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "forward" }, [
      "forward", "ahead", "straight", "go forward", "go ahead", "drive forward", "move forward", "keep going forward", "go straight", "drive straight", "move straight",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "move", direction: "backward" }, [
      "back", "backward", "go back", "go backward", "drive back", "drive backward", "move back", "move backward", "reverse", "back up", "go in reverse",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "left", degrees: 90 }, [
      "left", "turn left", "go left", "rotate left", "pivot left", "make a left turn", "turn to the left", "spin left",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 90 }, [
      "right", "turn right", "go right", "rotate right", "pivot right", "make a right turn", "turn to the right", "spin right",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "turn", direction: "right", degrees: 180 }, [
      "turn around", "u turn", "make a u turn", "one eighty", "turn one eighty", "turn 180 degrees", "rotate one eighty", "face the other way", "turn back around",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 1 }, [
      "nod", "nod your head", "confirm", "confirm with your head", "say yes with your head", "one nod",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 2 }, [
      "nod twice", "nod two times", "two nods", "give me two nods",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "nod", count: 3 }, [
      "nod three times", "three nods", "give me three nods",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "gesture", gesture: "happy_bob", count: 1 }, [
      "bob your head", "wave your head", "move your head", "happy head bob",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "dance" }, [
      "dance", "do a dance", "dance for me", "show me a dance", "spin and dance", "do your dance",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "sleep" }, [
      "sleep", "go to sleep", "fall asleep", "time to sleep", "go to bed",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: true }, [
      "lights on", "light on", "turn on the light", "turn the light on", "switch on the light",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "light", enabled: false }, [
      "lights off", "light off", "turn off the light", "turn the light off", "switch off the light",
    ], prefixes, suffixes);
    addNaturalVariants(commandByPhrase, { kind: "exit" }, [
      "done", "finish driving", "stop driving", "normal mode", "conversation mode", "let's talk", "back to conversation", "exit driving mode",
    ], ["", "okay", "please"], ["", "please"]);
  }

  const phrases = Array.from(commandByPhrase.keys());
  phrases.push("[unk]");
  return { phrases, commandByPhrase };
}

export function normalizeDrivingGrammarResult(text: string): string {
  return normalizePhrase(text);
}
