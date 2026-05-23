/**
 * Lesson content quality: abstract learner prompts, detect prompt leakage,
 * repair common markdown damage, and gate content before it ships to Firestore/UI.
 */

/** Collapse whitespace; lowercase for overlap checks. */
export function normalizeForLeakMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[""'']/g, '"')
    .trim();
}

/**
 * Strip conversational / meta prefixes from a learner topic so the model
 * sees scope (e.g. hardware + goal) without echoing "I want…" scaffolding.
 */
export function deriveTeachingScopeFromPrompt(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";

  const patterns = [
    /^(hi|hello|hey)[,!.]?\s+/i,
    /^(um+|uh+|so)[,.\s]+/i,
    /^(i\s+(want|need|would like|hope)\s+to\s+)/i,
    /^(i\s+(want|need)\s+)/i,
    /^(i('m| am)\s+(trying|looking)\s+to\s+)/i,
    /^(i('m| am)\s+looking\s+for\s+)/i,
    /^(please\s+)?(can you|could you)\s+(please\s+)?/i,
    /^(make|create|build|design|generate)\s+(me\s+)?(a\s+)?(course|class|lessons?)\s+(on|about|for|that covers)\s+/i,
    /^(help\s+me\s+(with|to)\s+)/i,
    /^(teach\s+me\s+(about\s+)?)/i,
    /^(show\s+me\s+how\s+to\s+)/i,
    /^(walk\s+me\s+through\s+)/i,
    /^(i\s+need\s+a\s+course\s+(on|about)\s+)/i,
  ];

  let prev;
  do {
    prev = t;
    for (const p of patterns) t = t.replace(p, "").trim();
  } while (t !== prev);

  if (t.length < 4) return String(raw || "").trim();
  return t.replace(/\s+/g, " ").trim();
}

/** Hollow textbook / content-farm openers that rarely teach. */
const GENERIC_FILLER_RE =
  /\b(is a concept used for|is defined as the|refers to the process of|is an important concept in|plays a crucial role in|in this lesson we will learn)\b/i;

/** Robotic courseware phrases the UI/UX spec bans. */
const ROBOTIC_COURSEWARE_RE =
  /\b(why is this important|why this matters|in this section|let's dive in|let's dive deep|as mentioned earlier|it is worth noting|without further ado|in today's (fast[- ]paced )?world|at the end of the day|this lesson will cover|we will explore|key takeaway is that|unlock the power of|game[- ]changer)\b/i;

/** Fake-deep template abstractions that read as AI sludge */
const FAKE_ABSTRACTION_RE =
  /difference between confident action and expensive guesswork|is what you observe|is the rule that makes observation actionable|is the signal you track|is the rule that tells you when|wrong rule → right-looking|governing rule|expensive guesswork|actionable\. wrong rule|bridge between logic and execution|syntax is the bridge/i;

export function proseContainsBannedPatterns(text) {
  const lower = String(text || "").toLowerCase();
  return (
    FAKE_ABSTRACTION_RE.test(lower) ||
    ROBOTIC_COURSEWARE_RE.test(lower) ||
    GENERIC_FILLER_RE.test(lower)
  );
}

const META_LEAK_RE = new RegExp(
  [
    "\\bi\\s+want\\b",
    "\\bi\\s+need\\s+to\\b",
    "\\bi\\s+would\\s+like\\b",
    "\\bmake\\s+a\\s+course\\b",
    "\\bcreate\\s+a\\s+course\\b",
    "\\bbuild\\s+a\\s+course\\b",
    "\\bthis\\s+course\\s+will\\b",
    "\\bin\\s+this\\s+course\\b",
    "\\bas\\s+requested\\b",
    "\\bthe\\s+user\\s+(asked|wants|requested)\\b",
    "\\bthe\\s+learner\\s+(asked|wants)\\b",
    "\\byour\\s+prompt\\b",
    "\\baccording\\s+to\\s+your\\s+request\\b",
    "\\bglobal\\s+course\\s+topic\\b",
    "\\bmodule\\s+scope\\s+statement\\b",
    "\\breturn\\s+json\\b",
    "\\bjson\\s+object\\b",
  ].join("|"),
  "i"
);

/** Conversational scaffolding or long prompts — verbatim echo detection applies. */
function isLikelyChattyLearnerPrompt(rawTopic) {
  const t = String(rawTopic || "").toLowerCase();
  if (!t.trim()) return false;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 12) return true;
  return /\b(i\s+want|i\s+need|please\s+|can\s+you|could\s+you|help\s+me|make\s+(me\s+)?a\s+course|course\s+on|upgrade\s+(my|this)|my\s+thinkpad|\bbtw\b|\bbtw,|thank\s+you)\b/i.test(
    t
  );
}

/**
 * Fingerprints long verbatim echoes for chatty prompts only.
 * Short catalog-style titles share vocabulary with lessons — n-gram matching would false-positive.
 */
export function buildLeakFingerprints(rawTopic) {
  const norm = normalizeForLeakMatch(rawTopic);
  if (!isLikelyChattyLearnerPrompt(rawTopic) || norm.length < 16) {
    return { full: "", phrases: [] };
  }

  const words = norm.split(" ").filter((w) => w.length > 0);
  const phrases = new Set();
  if (norm.length >= 22) phrases.add(norm);

  const maxK = Math.min(10, words.length);
  for (let k = 4; k <= maxK; k++) {
    for (let i = 0; i + k <= words.length; i++) {
      const run = words.slice(i, i + k).join(" ");
      if (run.length >= 28) phrases.add(run);
    }
  }

  const list = [...phrases].sort((a, b) => b.length - a.length).slice(0, 80);
  return { full: norm.length >= 22 ? norm : "", phrases: list };
}

export function textContainsFingerprint(lessonNorm, phrase) {
  if (!phrase || !lessonNorm) return false;
  return lessonNorm.includes(phrase);
}

/**
 * Fix common model markdown glitches without changing meaning.
 */
export function repairCommonMarkdownIssues(text) {
  let t = String(text ?? "");
  t = t.replace(/\uFEFF/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Stray backticks that break rendering: even count per line, else strip lone `
  t = t
    .split("\n")
    .map((line) => {
      const n = (line.match(/`/g) || []).length;
      if (n % 2 === 1) return line.replace(/`/, "");
      return line;
    })
    .join("\n");

  // Odd number of ** → drop a trailing orphan pair fragment
  const starPairs = (t.match(/\*\*/g) || []).length;
  if (starPairs % 2 === 1) {
    const last = t.lastIndexOf("**");
    if (last !== -1) t = t.slice(0, last) + t.slice(last + 2);
  }

  // Lines that are only broken emphasis
  t = t.replace(/^\s*\*{1,2}\s*$/gm, "");

  while (/\n{4,}/g.test(t)) t = t.replace(/\n{4,}/g, "\n\n\n");
  return t.trim();
}

export function assessLessonTextQuality(text, fingerprints) {
  const failures = [];
  const t = String(text || "");
  const lower = t.toLowerCase();
  const lessonNorm = normalizeForLeakMatch(t);

  if (META_LEAK_RE.test(lower)) {
    failures.push("meta_or_prompt_phrasing");
  }

  if (GENERIC_FILLER_RE.test(lower)) {
    failures.push("generic_textbook_filler");
  }

  if (ROBOTIC_COURSEWARE_RE.test(lower)) {
    failures.push("robotic_courseware_phrasing");
  }

  if (FAKE_ABSTRACTION_RE.test(lower)) {
    failures.push("fake_abstraction_template");
  }

  const imagineCount = (lower.match(/\bimagine\b/g) || []).length;
  if (imagineCount >= 2) {
    failures.push("overused_imagine_hook");
  }

  const { full, phrases } = fingerprints || { full: "", phrases: [] };
  if (full && full.length >= 20 && lessonNorm.includes(full)) {
    failures.push("verbatim_topic_echo");
  }
  for (const p of phrases) {
    if (p && textContainsFingerprint(lessonNorm, p)) {
      failures.push("verbatim_user_wording");
      break;
    }
  }

  // Unbalanced emphasis / fence markers (heuristic)
  if ((t.match(/\*\*/g) || []).length % 2 === 1) {
    failures.push("unbalanced_bold_markers");
  }
  const prose = t.replace(/```[\s\S]*?```/g, "");
  const ticks = (prose.match(/`/g) || []).length;
  if (ticks % 2 === 1) failures.push("unbalanced_inline_code");

  // Accidental heading inside body
  if (/\n#{3,6}\s/.test(t)) {
    failures.push("stray_markdown_headings");
  }

  return { ok: failures.length === 0, failures };
}

export function assessQuizLeakage(quizItems, fingerprints) {
  const failures = [];
  if (!Array.isArray(quizItems)) return { ok: true, failures };
  for (const q of quizItems) {
    if (!q) continue;
    const blob = [q.question, ...(q.options || []), q.explanation].filter(Boolean).join("\n");
    const r = assessLessonTextQuality(blob, fingerprints);
    if (!r.ok) failures.push(...r.failures);
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
