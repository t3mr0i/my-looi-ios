/** Pure proposal/confirmation policy for one user-authorized shared object activity. */

export type SharedActivityPhase =
  | "checking"
  | "preparing"
  | "waiting_for_start"
  | "awaiting_result"
  | "completed";

export type SharedActivityStep = "checked" | "prepared" | "result";
export type SharedActivityPendingStep = "begin" | SharedActivityStep | "resume";
export type SharedActivityAcceptedStep = "begin" | SharedActivityStep | "resume" | null;

export interface SharedActivityConfirmation {
  step: SharedActivityStep;
  detail: string;
  evidence: string;
  sessionId: string;
  at: number;
}

export interface SharedActivityPending {
  step: SharedActivityPendingStep;
  detail: string;
  evidence: string;
  sessionId: string;
  proposedAt: number;
  question: string;
  askedAt: number | null;
}

export interface SharedActivity {
  kind: "object_trial";
  episodeId: string;
  title: string;
  phase: SharedActivityPhase;
  /** Set only after the user confirms the begin question. */
  confirmedAt: number | null;
  /** Records a fresh explicit start signal; it is never itself a physical action. */
  startedAt: number | null;
  confirmed: SharedActivityConfirmation[];
  pending: SharedActivityPending | null;
}

export type SharedActivityAction =
  | { type: "manage_shared_activity"; operation: "begin" | "resume" | "cancel"; id: string; evidence: string }
  | { type: "manage_shared_activity"; operation: "confirm_step"; id: string; step: "checked" | "prepared"; detail: string; evidence: string }
  | { type: "manage_shared_activity"; operation: "report_result"; id: string; detail: string; evidence: string };

export interface SharedActivitySource {
  userText: string;
  sessionId: string;
  language?: string;
  now: number;
  /** Canonical title from the root's current confirmed episode lookup. */
  episodeTitle: string;
  /** Parent PendingIntention is the single authority for pause/resume state. */
  paused: boolean;
}

export type SharedActivityActionResult =
  | {
      ok: true;
      status: "pending_confirmation";
      instruction: string;
      confirmationQuestion: string;
    }
  | { ok: true; status: "cancelled"; instruction: string }
  | {
      ok: false;
      status:
        | "no_activity"
        | "pending_exists"
        | "wrong_episode"
        | "wrong_phase"
        | "missing_evidence"
        | "missing_title"
        | "invalid_detail"
        | "detail_not_in_evidence"
        | "not_paused"
        | "activity_conflict"
        | "activity_not_ready"
        | "invalid_action";
      instruction?: string;
    };

export interface ProposeSharedActivityResult {
  activity: SharedActivity | null;
  result: SharedActivityActionResult;
}

const PENDING_TTL_MS = 120_000;
const MAX_TITLE_LENGTH = 80;
const MAX_DETAIL_LENGTH = 180;
const MAX_EVIDENCE_LENGTH = 240;
const MAX_SESSION_ID_LENGTH = 96;
const EPISODE_ID = /^ep_[a-z0-9_-]{1,48}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[’‘`]/gu, "'").replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function namesEpisode(text: string, title: string): boolean {
  const wanted = normalize(title);
  if (!wanted) return false;
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRegExp(wanted)}($|[^\\p{L}\\p{N}_-])`, "u").test(normalize(text));
  } catch {
    return normalize(text).includes(wanted);
  }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && EPISODE_ID.test(value);
}

function validSession(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_SESSION_ID_LENGTH;
}

function exactEvidence(source: SharedActivitySource, evidenceValue: unknown): string | null {
  if (typeof evidenceValue !== "string" || !evidenceValue.trim() || evidenceValue !== evidenceValue.trim()
    || evidenceValue.length > MAX_EVIDENCE_LENGTH || !source.userText.includes(evidenceValue)) return null;
  return evidenceValue;
}

function questionFor(
  step: SharedActivityPendingStep,
  title: string,
  detail: string,
  language?: string,
): string {
  const locale = normalize(typeof language === "string" ? language : "en").split(/[-_]/u)[0];
  const content = detail.replace(/[.!。！?？]+$/gu, "");
  if (step === "begin") {
    if (locale === "de") return `Sollen wir die gemeinsame Tätigkeit für ${title} starten?`;
    if (locale === "ru") return `Начать совместное занятие для ${title}?`;
    if (locale === "uk") return `Почати спільне заняття для ${title}?`;
    return `Should we start the shared activity for ${title}?`;
  }
  if (step === "resume") {
    if (locale === "de") return `Sollen wir mit der gemeinsamen Tätigkeit für ${title} weitermachen?`;
    if (locale === "ru") return `Продолжить совместное занятие для ${title}?`;
    if (locale === "uk") return `Продовжити спільне заняття для ${title}?`;
    return `Should we continue the shared activity for ${title}?`;
  }
  if (step === "checked") {
    if (locale === "de") return `Haben wir für ${title} das geprüft: ${content}?`;
    if (locale === "ru") return `Мы проверили это для ${title}: ${content}?`;
    if (locale === "uk") return `Ми перевірили це для ${title}: ${content}?`;
    return `Have we checked this for ${title}: ${content}?`;
  }
  if (step === "prepared") {
    if (locale === "de") return `Ist für ${title} alles vorbereitet: ${content}?`;
    if (locale === "ru") return `Для ${title} всё готово: ${content}?`;
    if (locale === "uk") return `Для ${title} усе готово: ${content}?`;
    return `Is everything ready for ${title}: ${content}?`;
  }
  if (locale === "de") return `Ist das das bestätigte Ergebnis für ${title}: ${content}?`;
  if (locale === "ru") return `Это подтверждённый результат для ${title}: ${content}?`;
  if (locale === "uk") return `Це підтверджений результат для ${title}: ${content}?`;
  return `Is this the confirmed result for ${title}: ${content}?`;
}

function isExactQuestion(text: string, question: string): boolean {
  if ((text.match(/[?？]/gu) ?? []).length !== 1) return false;
  const spoken = normalize(text);
  const expected = normalize(question);
  if (!expected) return false;
  const first = spoken.indexOf(expected);
  return first >= 0 && spoken.indexOf(expected, first + expected.length) < 0;
}

function affirmative(text: string): boolean {
  const raw = normalize(text);
  if (!raw || /[?？]/u.test(raw) || /["“”'‘’«»„]/u.test(raw)) return false;
  const value = raw.replace(/[,;:]+/gu, " ").replace(/[.!。！]+$/gu, "").replace(/\s+/gu, " ").trim();
  const accepted = new Set([
    "yes", "yeah", "yep", "yup", "sure", "absolutely", "correct", "confirmed", "confirm", "go ahead", "do it", "that's right", "that is right",
    "yes please", "ja", "genau", "stimmt", "richtig", "bestätigt", "bestätige", "einverstanden", "mach das", "tu das", "ja bitte", "genau bitte",
    "да", "так", "верно", "точно", "подтверждаю", "подтверждено", "согласен", "согласна", "делай", "да пожалуйста",
    "саме так", "вірно", "підтверджую", "підтверджено", "згоден", "згодна", "роби", "так будь ласка",
  ]);
  return accepted.has(value);
}

function copyActivity(activity: SharedActivity, changes: Partial<SharedActivity> = {}): SharedActivity {
  const next = { ...activity, ...changes };
  return {
    ...next,
    confirmed: next.confirmed.map((item) => ({ ...item })),
    pending: next.pending ? { ...next.pending } : null,
  };
}

function sourceValid(source: SharedActivitySource): boolean {
  return !!source && typeof source.userText === "string" && source.userText.length <= 4_000
    && validSession(source.sessionId) && finiteTime(source.now)
    && typeof source.paused === "boolean"
    && typeof source.episodeTitle === "string" && source.episodeTitle.trim().length > 0
    && source.episodeTitle.length <= MAX_TITLE_LENGTH;
}

function failure(activity: SharedActivity | null, status: Extract<SharedActivityActionResult, { ok: false }>['status']): ProposeSharedActivityResult {
  return { activity, result: { ok: false, status } };
}

function pendingResult(activity: SharedActivity, instruction: string): ProposeSharedActivityResult {
  return {
    activity,
    result: { ok: true, status: "pending_confirmation", instruction, confirmationQuestion: activity.pending!.question },
  };
}

/** Proposes one user-authorized activity change without committing its fact. */
export function proposeSharedActivity(
  activity: SharedActivity | null,
  action: SharedActivityAction,
  source: SharedActivitySource,
): ProposeSharedActivityResult {
  if (!sourceValid(source) || !action || action.type !== "manage_shared_activity" || !validId(action.id))
    return failure(activity, "invalid_action");

  if (action.operation === "begin") {
    if (activity && activity.phase !== "completed") return failure(activity, activity.pending ? "pending_exists" : "wrong_phase");
    if (source.paused) return failure(activity, "not_paused");
    if (!source.userText.includes(action.evidence)) return failure(activity, "missing_evidence");
    const evidence = exactEvidence(source, action.evidence);
    if (!evidence) return failure(activity, "missing_evidence");
    if (!namesEpisode(evidence, source.episodeTitle) || !namesEpisode(source.userText, source.episodeTitle)) return failure(activity, "missing_title");
    const title = cleanText(source.episodeTitle, MAX_TITLE_LENGTH);
    const next: SharedActivity = {
      kind: "object_trial",
      episodeId: action.id,
      title,
      phase: "checking",
      confirmedAt: null,
      startedAt: null,
      confirmed: [],
      pending: {
        step: "begin",
        detail: "",
        evidence,
        sessionId: source.sessionId,
        proposedAt: source.now,
        question: questionFor("begin", title, "", source.language),
        askedAt: null,
      },
    };
    return pendingResult(next, `Ask this exact question once, verbatim: “${next.pending!.question}” Then wait. Do not begin the activity unless the next turn clearly confirms it.`);
  }

  if (!activity) return failure(null, "no_activity");
  if (action.id !== activity.episodeId || source.episodeTitle !== activity.title) return failure(activity, "wrong_episode");
  if (action.operation !== "cancel" && activity.pending) return failure(activity, "pending_exists");
  const evidence = exactEvidence(source, action.evidence);
  if (!evidence) return failure(activity, "missing_evidence");

  if (action.operation === "cancel") {
    if (!namesEpisode(evidence, activity.title) || !namesEpisode(source.userText, activity.title)) return failure(activity, "missing_title");
    return { activity: null, result: { ok: true, status: "cancelled", instruction: "The shared activity is cancelled. Clear its parent PendingIntention." } };
  }

  if (action.operation === "resume") {
    if (!source.paused) return failure(activity, "not_paused");
    if (activity.phase === "completed") return failure(activity, "wrong_phase");
    if (!namesEpisode(evidence, activity.title) || !namesEpisode(source.userText, activity.title)) return failure(activity, "missing_title");
    const next = copyActivity(activity, {
      pending: {
        step: "resume",
        detail: "",
        evidence,
        sessionId: source.sessionId,
        proposedAt: source.now,
        question: questionFor("resume", activity.title, "", source.language),
        askedAt: null,
      },
    });
    return pendingResult(next, `Ask this exact question once, verbatim: “${next.pending!.question}” Then wait. The parent task remains paused until the next turn clearly confirms.`);
  }

  if (source.paused) return failure(activity, "not_paused");
  if (action.operation === "confirm_step") {
    if (action.step === "checked" && activity.phase !== "checking") return failure(activity, "wrong_phase");
    if (action.step === "prepared" && activity.phase !== "preparing") return failure(activity, "wrong_phase");
    if (action.step !== "checked" && action.step !== "prepared") return failure(activity, "invalid_action");
    return proposeMilestone(activity, action.step, action.detail, evidence, source);
  }
  if (action.operation === "report_result") {
    if (activity.phase !== "awaiting_result") return failure(activity, "wrong_phase");
    return proposeMilestone(activity, "result", action.detail, evidence, source);
  }
  return failure(activity, "invalid_action");
}

function proposeMilestone(
  activity: SharedActivity,
  step: SharedActivityStep,
  detailValue: unknown,
  evidence: string,
  source: SharedActivitySource,
): ProposeSharedActivityResult {
  const detail = cleanText(detailValue, MAX_DETAIL_LENGTH);
  if (!detail || detailValue !== detail || /[?？]/u.test(detail)) return failure(activity, "invalid_detail");
  if (!evidence.includes(detail) || !source.userText.includes(detail)) return failure(activity, "detail_not_in_evidence");
  const next = copyActivity(activity, {
    pending: {
      step,
      detail,
      evidence,
      sessionId: source.sessionId,
      proposedAt: source.now,
      question: questionFor(step, activity.title, detail, source.language),
      askedAt: null,
    },
  });
  return pendingResult(next, `Treat this as an unconfirmed proposal. Ask this exact question once, verbatim: “${next.pending!.question}” Save nothing unless the next turn clearly confirms it.`);
}

/** Marks only a single exact confirmation question that appears in the heard assistant transcript. */
export function hearSharedActivity(activity: SharedActivity | null, heardText: string, now: number): SharedActivity | null {
  if (!activity || !activity.pending || activity.pending.askedAt !== null || !finiteTime(now)) return activity;
  const pending = activity.pending;
  if (now < pending.proposedAt || now - pending.proposedAt >= PENDING_TTL_MS)
    return pending.step === "begin" ? null : clearPending(activity);
  if (!isExactQuestion(heardText, pending.question)) return activity;
  return copyActivity(activity, { pending: { ...pending, askedAt: now } });
}

/** Consumes at most the immediate same-session user turn after the question was heard. */
export function advanceSharedActivity(
  activity: SharedActivity | null,
  text: string,
  sessionId: string,
  now: number,
): { activity: SharedActivity | null; accepted: SharedActivityAcceptedStep } {
  if (!activity || !activity.pending) return { activity, accepted: null };
  const pending = activity.pending;
  const validAnswerWindow = finiteTime(now) && now >= pending.proposedAt
    && now - pending.proposedAt < PENDING_TTL_MS
    && pending.askedAt !== null && now >= pending.askedAt;
  if (!validAnswerWindow || sessionId !== pending.sessionId || !affirmative(text)) {
    const cleared = clearPending(activity);
    return { activity: pending.step === "begin" ? null : cleared, accepted: null };
  }

  if (pending.step === "begin") {
    return {
      activity: copyActivity(activity, { confirmedAt: now, pending: null }),
      accepted: "begin",
    };
  }
  if (pending.step === "resume") return { activity: copyActivity(activity, { pending: null }), accepted: "resume" };

  const confirmation: SharedActivityConfirmation = {
    step: pending.step,
    detail: pending.detail,
    evidence: pending.evidence,
    sessionId: pending.sessionId,
    at: now,
  };
  const phase: SharedActivityPhase = pending.step === "checked"
    ? "preparing"
    : pending.step === "prepared"
      ? "waiting_for_start"
      : "completed";
  return {
    activity: copyActivity(activity, {
      phase,
      confirmed: [...activity.confirmed, confirmation],
      pending: null,
      ...(pending.step === "result" ? { startedAt: null } : {}),
    }),
    accepted: pending.step,
  };
}

/** Converts a fresh, matching explicit signal into a wait-for-result phase only. */
export function markSharedActivityStart(activity: SharedActivity | null, episodeId: string, now: number): SharedActivity | null {
  if (!activity) return null;
  if (activity.episodeId !== episodeId || activity.phase !== "waiting_for_start"
    || activity.confirmedAt === null || activity.pending || !finiteTime(now)) return activity;
  return copyActivity(activity, { phase: "awaiting_result", startedAt: now });
}

/** Drops pending questions; resumption after app interruption requires a new start signal. */
export function pauseSharedActivity(activity: SharedActivity | null): SharedActivity | null {
  if (!activity || activity.confirmedAt === null) return null;
  return copyActivity(activity, {
    phase: activity.phase === "awaiting_result" ? "waiting_for_start" : activity.phase,
    startedAt: null,
    pending: null,
  });
}

function clearPending(activity: SharedActivity): SharedActivity {
  return copyActivity(activity, { pending: null });
}

function safeConfirmation(value: unknown, expectedStep: SharedActivityStep, notAfter: number): SharedActivityConfirmation | null {
  if (!isRecord(value) || value.step !== expectedStep) return null;
  const detail = cleanText(value.detail, MAX_DETAIL_LENGTH);
  const evidence = value.evidence;
  const sessionId = value.sessionId;
  const at = value.at;
  if (!detail || typeof value.detail !== "string" || value.detail !== detail || /[?？]/u.test(detail)
    || typeof evidence !== "string" || !evidence.trim() || evidence !== evidence.trim() || evidence.length > MAX_EVIDENCE_LENGTH
    || !validSession(sessionId) || !finiteTime(at) || at > notAfter) return null;
  return { step: expectedStep, detail, evidence, sessionId, at };
}

/** Restores only confirmed user facts. Pending prompts and start grants never survive restoration. */
export function restoreSharedActivity(value: unknown, now: number): SharedActivity | null {
  const confirmedAt = isRecord(value) ? value.confirmedAt : null;
  if (!isRecord(value) || value.kind !== "object_trial" || !validId(value.episodeId)
    || !finiteTime(now) || !finiteTime(confirmedAt) || confirmedAt > now) return null;
  const title = cleanText(value.title, MAX_TITLE_LENGTH);
  if (!title || typeof value.title !== "string" || value.title !== title || !Array.isArray(value.confirmed)) return null;

  const candidates: SharedActivityConfirmation[] = [];
  for (const item of value.confirmed) {
    if (!isRecord(item) || (item.step !== "checked" && item.step !== "prepared" && item.step !== "result")) continue;
    const candidate = safeConfirmation(item, item.step, now);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((left, right) => left.at - right.at);
  const checked = candidates.find((item) => item.step === "checked" && item.at >= confirmedAt) ?? null;
  const prepared = checked
    ? candidates.find((item) => item.step === "prepared" && item.at >= checked.at)
    : undefined;
  const result = prepared
    ? candidates.find((item) => item.step === "result" && item.at >= prepared.at)
    : undefined;
  const confirmed: SharedActivityConfirmation[] = [];
  if (checked) confirmed.push(checked);
  if (prepared) confirmed.push(prepared);
  if (result) confirmed.push(result);
  const hasPrepared = confirmed.some((item) => item.step === "prepared");
  const hasResult = confirmed.some((item) => item.step === "result");
  const phase: SharedActivityPhase = hasResult
    ? "completed"
    : hasPrepared
      ? "waiting_for_start"
      : checked
        ? "preparing"
        : "checking";

  return {
    kind: "object_trial",
    episodeId: value.episodeId,
    title,
    phase,
    confirmedAt,
    startedAt: null,
    confirmed,
    pending: null,
  };
}
