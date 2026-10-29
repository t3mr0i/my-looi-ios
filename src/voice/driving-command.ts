import type { ListeningLanguage } from "../language/listening-language";

export type DrivingCommand =
  | { kind: "stop" }
  | { kind: "move"; direction: "forward" | "backward" }
  | { kind: "turn"; direction: "left" | "right"; degrees: 90 | 180 }
  | { kind: "gesture"; gesture: "nod" | "happy_bob"; count: number }
  | { kind: "dance" }
  | { kind: "sleep" }
  | { kind: "light"; enabled: boolean }
  | { kind: "exit" };

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:()\[\]{}"“”'`~]+/gu, " ")
    .replace(/[\-–—]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripFillers(text: string, language: ListeningLanguage): string {
  const fillers: Record<ListeningLanguage, RegExp> = {
    ru: /^(?:(?:ну|давай|да|ага|эй|ой|пожалуйста|быстро|сейчас|уже|робот|луи|луй|макс|max|уи|уй)\s+)*/u,
    uk: /^(?:(?:ну|давай|так|ага|ей|ой|будь\s+ласка|швидко|зараз|вже|робот|луї|луі|макс|max)\s+)*/u,
    en: /^(?:(?:well|okay|ok|hey|please|quickly|now|already|robot|looi|louie|max)\s+)*/u,
    de: /^(?:(?:na|also|okay|ok|hey|bitte|jetzt|los|louis|louie|loui|looi|roboter)\s+)*/u,
  };
  return text.replace(fillers[language], "").trim();
}

/**
 * Deterministic on-device parser used while the wheels are moving.
 *
 * Safety rule: arbitrary speech never escapes this parser to remote STT/LLM.
 * Only this bounded physical-command vocabulary is executable without the
 * normal "Луи/Робот" address while driving. STOP aliases intentionally work
 * across all supported languages regardless of the selected listening language.
 */
export function parseDrivingCommandTranscript(
  transcript: string,
  language: ListeningLanguage
): DrivingCommand | null {
  const normalized = normalize(transcript);
  if (!normalized) return null;

  // Explicitly leave local physical-control mode. A plain "хватит" remains
  // an emergency STOP; exiting the session requires an unambiguous phrase.
  if (/^(?:вс[её]|закончили|хватит\s+управлять|обычный\s+режим|поговорим|давай\s+поговорим|все\s+команды\s+закончили)$/u.test(normalized)) {
    return { kind: "exit" };
  }
  if (/^(?:все|закінчили|досить\s+керувати|звичайний\s+режим|поговорімо|давай\s+поговоримо)$/u.test(normalized)) {
    return { kind: "exit" };
  }
  if (/^(?:done|finish\s+driving|stop\s+driving|normal\s+mode|conversation\s+mode|let'?s\s+talk)$/u.test(normalized)) {
    return { kind: "exit" };
  }
  if (/^(?:fertig|fahrmodus\s+beenden|fahrsteuerung\s+beenden|normaler\s+modus|zurück\s+zum\s+(?:gespräch|gespraech)|gesprächsmodus|gespraechsmodus)$/u.test(normalized)) {
    return { kind: "exit" };
  }

  // STOP is deliberately broad and multilingual. During a local control
  // session, an accidental stop is much safer than an ignored emergency command.
  const padded = ` ${normalized} `;
  if (
    /(?:^|\s)(?:стоп|стой|стій|stop|halt|stopp|anhalten|halte\s+an|bleib\s+stehen|stehen\s+bleiben|bremse|bremsen|beweg\s+dich\s+nicht|nicht\s+weiterfahren|замри|завмри|тормози|гальмуй|остановись|останови|зупинись|зупини|хватит|досить|достаточно|не\s+надо|не\s+треба|freeze|brake|enough|hold)(?:$|\s)/u.test(
      padded
    )
  ) {
    return { kind: "stop" };
  }

  // Local tiny Whisper sometimes maps a short Russian/Ukrainian STOP to a
  // phonetically nearby one-word transcript. These aliases are intentionally
  // accepted ONLY in driving mode. They must never be used by normal chat or
  // addressed-command parsing. The list is based on physical-device logs.
  const fuzzyStopToken = /^(?:ст[аоэеё]?[пй]|стое|стои|сто|степ|степо|степлые|стап|стопп|слой|слышь|ско|step|stap|stahp|stopp)$/u;
  const fuzzyWords = normalized.split(" ").filter(Boolean);
  if (
    (fuzzyWords.length >= 1 && fuzzyWords.length <= 3 && fuzzyWords.every((word) => fuzzyStopToken.test(word))) ||
    /^(?:стой|стоп)(?:\s+(?:стой|стоп)){1,2}$/u.test(normalized)
  ) {
    return { kind: "stop" };
  }

  const compact = stripFillers(normalized, language);
  const words = compact.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 7) return null;

  if (language === "ru") {
    if (/^(?:развернись|разверни|разворот|повернись\s+назад|кругом|на\s+сто\s+восемьдесят)$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 180 };
    }
    if (/^(?:впер[её]д|прямо|поехали|ед[ьъ]?\s+впер[её]д|двигайся\s+впер[её]д)$/u.test(compact)) {
      return { kind: "move", direction: "forward" };
    }
    if (/^(?:назад|обратно|ед[ьъ]?\s+назад|двигайся\s+назад)$/u.test(compact)) {
      return { kind: "move", direction: "backward" };
    }
    if (/^(?:влево|налево|лево|поверни\s+(?:влево|налево)|поворачивай\s+(?:влево|налево))$/u.test(compact)) {
      return { kind: "turn", direction: "left", degrees: 90 };
    }
    if (/^(?:вправо|направо|право|поверни\s+(?:вправо|направо)|поворачивай\s+(?:вправо|направо))$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 90 };
    }
    if (/^(?:кивни|подтверди|подтверждай|скажи\s+да\s+головой)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 1 };
    }
    if (/^(?:кивни\s+(?:два|2)\s+раза|дважды\s+кивни)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 2 };
    }
    if (/^(?:кивни\s+(?:три|3)\s+раза|трижды\s+кивни)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 3 };
    }
    if (/^(?:покачай\s+головой|помаши\s+головой|головой\s+помаши)$/u.test(compact)) {
      return { kind: "gesture", gesture: "happy_bob", count: 1 };
    }
    if (/^(?:потанцуй|танцуй|станцуй|танец|покрутись|покружись)$/u.test(compact)) {
      return { kind: "dance" };
    }
    if (/^(?:спи|засни|усни|иди\s+спать)$/u.test(compact)) {
      return { kind: "sleep" };
    }
    if (/^(?:включи\s+свет|свет\s+включи|зажги\s+свет)$/u.test(compact)) {
      return { kind: "light", enabled: true };
    }
    if (/^(?:выключи\s+свет|свет\s+выключи|погаси\s+свет)$/u.test(compact)) {
      return { kind: "light", enabled: false };
    }
  } else if (language === "uk") {
    if (/^(?:розвернись|розверни|розворот|кругом|на\s+сто\s+вісімдесят)$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 180 };
    }
    if (/^(?:вперед|прямо|поїхали|їдь\s+вперед|рухайся\s+вперед)$/u.test(compact)) {
      return { kind: "move", direction: "forward" };
    }
    if (/^(?:назад|їдь\s+назад|рухайся\s+назад)$/u.test(compact)) {
      return { kind: "move", direction: "backward" };
    }
    if (/^(?:вліво|наліво|ліворуч|поверни\s+(?:вліво|наліво|ліворуч)|повертай\s+(?:вліво|наліво|ліворуч))$/u.test(compact)) {
      return { kind: "turn", direction: "left", degrees: 90 };
    }
    if (/^(?:вправо|направо|праворуч|поверни\s+(?:вправо|направо|праворуч)|повертай\s+(?:вправо|направо|праворуч))$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 90 };
    }
    if (/^(?:кивни|підтверди|скажи\s+так\s+головою)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 1 };
    }
    if (/^(?:кивни\s+(?:два|2)\s+рази|двічі\s+кивни)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 2 };
    }
    if (/^(?:кивни\s+(?:три|3)\s+рази|тричі\s+кивни)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 3 };
    }
    if (/^(?:похитай\s+головою|помахай\s+головою)$/u.test(compact)) {
      return { kind: "gesture", gesture: "happy_bob", count: 1 };
    }
    if (/^(?:потанцюй|танцюй|станцюй|танець|покрутись)$/u.test(compact)) {
      return { kind: "dance" };
    }
    if (/^(?:спи|засни|засинай|іди\s+спати)$/u.test(compact)) {
      return { kind: "sleep" };
    }
    if (/^(?:увімкни\s+світло|включи\s+світло|світло\s+увімкни)$/u.test(compact)) {
      return { kind: "light", enabled: true };
    }
    if (/^(?:вимкни\s+світло|світло\s+вимкни)$/u.test(compact)) {
      return { kind: "light", enabled: false };
    }
  } else if (language === "de") {
    if (/^(?:dreh\s+dich\s+um|dreh\s+um|drehe\s+dich\s+um|drehe\s+um|wende|wend\s+dich|kehrtwende|umdrehen|180\s+grad\s+drehen)$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 180 };
    }
    if (/^(?:vorwärts|vorwaerts|nach\s+vorne|nach\s+vorn|geradeaus|fahr\s+(?:vorwärts|vorwaerts|nach\s+vorne|geradeaus)|fahre\s+(?:vorwärts|vorwaerts|nach\s+vorne|geradeaus)|beweg\s+dich\s+nach\s+vorn(?:e)?)$/u.test(compact)) {
      return { kind: "move", direction: "forward" };
    }
    if (/^(?:rückwärts|rueckwaerts|zurück|zurueck|nach\s+hinten|fahr\s+(?:rückwärts|rueckwaerts|zurück|zurueck|nach\s+hinten)|fahre\s+(?:rückwärts|rueckwaerts|zurück|zurueck|nach\s+hinten)|setz\s+zurück|setze\s+zurück|beweg\s+dich\s+zurück)$/u.test(compact)) {
      return { kind: "move", direction: "backward" };
    }
    if (/^(?:links|nach\s+links|links\s+drehen|dreh\s+(?:dich\s+)?nach\s+links|biege?\s+links\s+ab|lenk\s+nach\s+links)$/u.test(compact)) {
      return { kind: "turn", direction: "left", degrees: 90 };
    }
    if (/^(?:rechts|nach\s+rechts|rechts\s+drehen|dreh\s+(?:dich\s+)?nach\s+rechts|biege?\s+rechts\s+ab|lenk\s+nach\s+rechts)$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 90 };
    }
    if (/^(?:nick|nicke|nick\s+mit\s+dem\s+kopf|nicke\s+mit\s+dem\s+kopf|mach\s+einen\s+nick|nick\s+einmal)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 1 };
    }
    if (/^(?:nick\s+zweimal|nicke\s+zweimal|nicke\s+zwei\s+mal|zweimal\s+nicken)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 2 };
    }
    if (/^(?:nick\s+dreimal|nicke\s+dreimal|nicke\s+drei\s+mal|dreimal\s+nicken)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 3 };
    }
    if (/^(?:schüttle\s+den\s+kopf|schuettle\s+den\s+kopf|beweg\s+den\s+kopf|bewege\s+den\s+kopf|wackle\s+mit\s+dem\s+kopf)$/u.test(compact)) {
      return { kind: "gesture", gesture: "happy_bob", count: 1 };
    }
    if (/^(?:tanz|tanze|tanz\s+für\s+mich|tanze\s+für\s+mich|zeig\s+mir\s+einen\s+tanz|mach\s+einen\s+tanz)$/u.test(compact)) {
      return { kind: "dance" };
    }
    if (/^(?:schlaf|schlafe|geh\s+schlafen|schlaf\s+ein|geh\s+ins\s+bett|zeit\s+zum\s+schlafen|gute\s+nacht)$/u.test(compact)) {
      return { kind: "sleep" };
    }
    if (/^(?:licht\s+an|mach\s+(?:das\s+)?licht\s+an|schalte\s+(?:das\s+)?licht\s+ein|schalte\s+licht\s+ein)$/u.test(compact)) {
      return { kind: "light", enabled: true };
    }
    if (/^(?:licht\s+aus|mach\s+(?:das\s+)?licht\s+aus|schalte\s+(?:das\s+)?licht\s+aus)$/u.test(compact)) {
      return { kind: "light", enabled: false };
    }
  } else {
    if (/^(?:turn\s+around|u\s*turn|make\s+a\s+u\s*turn|one\s+eighty|turn\s+one\s+eighty)$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 180 };
    }
    if (/^(?:forward|ahead|go\s+forward|go\s+ahead|drive\s+forward|straight)$/u.test(compact)) {
      return { kind: "move", direction: "forward" };
    }
    if (/^(?:back|backward|go\s+back|go\s+backward|drive\s+back)$/u.test(compact)) {
      return { kind: "move", direction: "backward" };
    }
    if (/^(?:left|turn\s+left|go\s+left)$/u.test(compact)) {
      return { kind: "turn", direction: "left", degrees: 90 };
    }
    if (/^(?:right|turn\s+right|go\s+right)$/u.test(compact)) {
      return { kind: "turn", direction: "right", degrees: 90 };
    }
    if (/^(?:nod|confirm|say\s+yes\s+with\s+your\s+head)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 1 };
    }
    if (/^(?:nod\s+twice|nod\s+(?:two|2)\s+times)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 2 };
    }
    if (/^(?:nod\s+(?:three|3)\s+times)$/u.test(compact)) {
      return { kind: "gesture", gesture: "nod", count: 3 };
    }
    if (/^(?:bob\s+your\s+head|wave\s+your\s+head|head\s+bob)$/u.test(compact)) {
      return { kind: "gesture", gesture: "happy_bob", count: 1 };
    }
    if (/^(?:dance|do\s+a\s+dance|dance\s+for\s+me|spin\s+and\s+dance)$/u.test(compact)) {
      return { kind: "dance" };
    }
    if (/^(?:sleep|go\s+to\s+sleep|fall\s+asleep)$/u.test(compact)) {
      return { kind: "sleep" };
    }
    if (/^(?:lights\s+on|light\s+on|turn\s+on\s+the\s+light)$/u.test(compact)) {
      return { kind: "light", enabled: true };
    }
    if (/^(?:lights\s+off|light\s+off|turn\s+off\s+the\s+light)$/u.test(compact)) {
      return { kind: "light", enabled: false };
    }
  }

  return null;
}
