type SearchableEpisode = {
  title: string;
  detail: string;
  outcome: string;
  source: { evidence: string };
};

const MAX_EPISODE_SEARCH_RESULTS = 3;

// Lookup fillers clarify a request but contribute little identifying value.
// Search remains lexical and does not translate or infer episode identity.
const EPISODE_SEARCH_FILLERS = new Set([
  "weißt", "weisst", "du", "noch", "unsere", "unser", "unserem", "unseren", "unserer", "unseres",
  "wir", "uns", "eure", "euer", "eurem", "euren", "erinnerst", "erinnern", "erinnere", "dich", "mich",
  "was", "wie", "wo", "wann", "warum", "bitte", "mal", "damals", "gemeinsam", "gemeinsame", "zusammen",
  "erzähle", "erzaehle", "erzähl", "erzaehl", "sag", "sage", "mir", "über", "ueber", "mit", "von",
  "die", "der", "das", "den", "dem", "des", "ein", "eine", "einer", "einem", "einen", "und", "oder",
  "hat", "haben", "war", "waren", "ist", "sind", "damit", "dabei", "daran",
  "remember", "remind", "recall", "do", "does", "did", "you", "your", "our", "ours", "we", "us", "about",
  "what", "how", "when", "where", "which", "who", "tell", "me", "again", "the", "and", "with", "for",
  "from", "that", "this", "was", "were", "have", "had", "there", "then", "together", "shared", "story",
  "please", "something", "thing", "one", "any", "like", "back",
  "помнишь", "помнить", "вспомни", "вспоминаешь", "наша", "наше", "наш", "нашу", "наши", "наших", "нашим",
  "ты", "мы", "нам", "нас", "про", "что", "как", "когда", "где", "тогда", "это", "было", "были", "был",
  "вместе", "общий", "общая", "общие", "расскажи", "напомни", "мне", "пожалуйста", "история",
  "памятаєш", "пам'ятаєш", "памятати", "пам'ятати", "згадай", "наша", "наше", "наш", "нашу", "наші", "наших",
  "ти", "ми", "нам", "нас", "про", "що", "як", "коли", "де", "тоді", "це", "було", "були", "був",
  "разом", "спільний", "спільна", "спільні", "розкажи", "нагадай", "мені", "будь", "ласка", "історія",
]);

function searchTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (Array.from(term).length < 3 || EPISODE_SEARCH_FILLERS.has(term) || seen.has(term)) continue;
    seen.add(term);
    result.push(term);
  }
  return result;
}

export function searchEpisodeCandidates<T extends SearchableEpisode>(
  query: string,
  episodes: readonly T[],
): { matches: Array<{ episode: T; matchedTerms: string[] }>; totalMatches: number } {
  const queryTerms = searchTerms(query);
  if (queryTerms.length === 0) return { matches: [], totalMatches: 0 };

  const ranked: Array<{ episode: T; matchedTerms: string[]; score: number; index: number }> = [];
  episodes.forEach((episode, index) => {
    const bodyTerms = new Set(`${episode.title} ${episode.detail} ${episode.outcome} ${episode.source.evidence}`
      .normalize("NFKC")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean));
    const matchedTerms: string[] = [];
    let score = 0;
    for (const queryTerm of queryTerms) {
      let exact = false;
      let suffix = false;
      const queryLength = Array.from(queryTerm).length;
      for (const episodeTerm of bodyTerms) {
        if (episodeTerm === queryTerm) { exact = true; break; }
        if (queryLength >= 5 && Array.from(episodeTerm).length >= queryLength + 3 && episodeTerm.endsWith(queryTerm)) suffix = true;
      }
      if (exact || suffix) {
        matchedTerms.push(queryTerm);
        score += exact ? 2 : 1;
      }
    }
    if (matchedTerms.length > 0) ranked.push({ episode, matchedTerms, score, index });
  });

  ranked.sort((left, right) => right.score - left.score || right.index - left.index);
  return {
    matches: ranked.slice(0, MAX_EPISODE_SEARCH_RESULTS).map(({ episode, matchedTerms }) => ({ episode, matchedTerms })),
    totalMatches: ranked.length,
  };
}
