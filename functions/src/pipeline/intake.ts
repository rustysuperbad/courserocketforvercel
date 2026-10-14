import { hashedShingles, normalizeWhitespace, stripZeroWidth, wordTokens } from "./text";
import { learnerSpecSchema, type LearnerSpec } from "./schemas";

export const LEARNER_MESSAGES = {
  empty: "Say what you want to learn in a short sentence.",
  clarification: "Which specific skill or idea should this course cover?",
  rejected: "This request cannot be turned into a course.",
  insufficient: "We couldn't find enough reliable material to teach this well. Try a more specific topic or rephrase it.",
  provider: "Something went wrong on our side. Please try again.",
} as const;

const HARMFUL = [
  /\bbomb\b/i, /\bexplosive\b/i, /\bransomware\b/i, /\bmake a virus\b/i,
  /\bkill\b/i, /\bsuicide\b/i, /\bchild sexual\b/i, /\bhow to hack\b/i,
];
const EXAM_ABUSE = [
  /exam answers? to submit/i, /write my exam/i, /homework .{0,40}turn in/i,
  /answers to (hand|turn) in/i, /do my (test|exam) for me/i,
];
const VAGUE_WORDS = new Set(["help", "idk", "something", "stuff", "whatever", "cool", "interesting", "please", "me", "a", "the", "just"]);
const BROAD = /\b(everything about|all of (science|history|math)|the universe|world history)\b/i;
const FILLER_ONLY = /\bunlock your potential\b|\bleadership vibes\b|\bgeneric motivation\b/i;

export type IntakeResult = {
  spec: LearnerSpec;
  leakHashes: Set<string>;
  rawNormalized: string;
  skippedModel: boolean;
};

function nounPhrase(text: string): string {
  const stop = new Set(["the", "a", "an", "to", "for", "me", "please", "learn", "teach", "want", "wanna", "like", "um", "so", "about", "on", "also", "and"]);
  const focused = text.match(/\b(?:want a course on|course on|teach(?: me)?|learn(?: how)?)\s+([^.]{3,80})/i);
  const source = focused?.[1] || text;
  const words = wordTokens(source).filter((w) => !stop.has(w) && w.length > 1).slice(0, 8);
  return words.join(" ");
}

function inferLevel(text: string): LearnerSpec["level"] {
  if (/\b(advanced|expert|already know|experienced)\b/i.test(text)) return "advanced";
  if (/\b(intermediate|some experience|not a beginner)\b/i.test(text)) return "intermediate";
  return "beginner";
}

function inferConstraints(text: string): string[] {
  const out: string[] = [];
  const hours = text.match(/\b(\d+)\s*(hours?|hrs?)\b/i);
  if (hours) out.push(`time cap ${hours[1]} hours`);
  if (/\bskip proofs?\b/i.test(text)) out.push("skip proofs");
  if (/\bno (video|videos)\b/i.test(text)) out.push("no videos");
  return out.slice(0, 8);
}

function ignoredFrom(text: string): string[] {
  const out: string[] = [];
  if (/\bignore (all )?(previous|prior) instructions\b/i.test(text)) out.push("instruction override attempt");
  if (/\bsystem prompt\b/i.test(text)) out.push("system-prompt dump request");
  if (/\bssn\b|\bsocial security\b|\b\d{3}-\d{2}-\d{4}\b/i.test(text)) out.push("personal identifier mentioned");
  if (/\bsend (this|it) to\b/i.test(text)) out.push("off-goal delivery request");
  return out;
}

export function preprocessLearnerText(raw: string): { text: string; empty: boolean } {
  const text = normalizeWhitespace(stripZeroWidth(String(raw || "")));
  return { text, empty: text.length === 0 };
}

export function specFromLearnerText(raw: string): IntakeResult {
  const { text, empty } = preprocessLearnerText(raw);
  const leakHashes = empty ? new Set<string>() : hashedShingles(text, 4);
  if (empty) {
    return {
      spec: {
        status: "rejected",
        topic: "",
        level: "beginner",
        goal: "",
        constraints: [],
        ignored_requests: [],
        question: LEARNER_MESSAGES.empty,
      },
      leakHashes,
      rawNormalized: text,
      skippedModel: true,
    };
  }
  if (HARMFUL.some((re) => re.test(text)) || EXAM_ABUSE.some((re) => re.test(text))) {
    return {
      spec: {
        status: "rejected",
        topic: "",
        level: "beginner",
        goal: "",
        constraints: [],
        ignored_requests: [],
      },
      leakHashes,
      rawNormalized: text,
      skippedModel: true,
    };
  }
  const tokens = wordTokens(text);
  const tooBroad = BROAD.test(text) || (tokens.length <= 3 && /^(science|history|math|art|life)$/i.test(text));
  const tooVague = tokens.length < 2 || tokens.every((t) => VAGUE_WORDS.has(t)) || FILLER_ONLY.test(text);
  if (tooVague || tooBroad) {
    return {
      spec: {
        status: "needs_clarification",
        topic: "",
        level: inferLevel(text),
        goal: "",
        constraints: inferConstraints(text),
        ignored_requests: ignoredFrom(text),
        question: LEARNER_MESSAGES.clarification,
      },
      leakHashes,
      rawNormalized: text,
      skippedModel: true,
    };
  }
  const topic = nounPhrase(text) || "the requested subject";
  const spec: LearnerSpec = {
    status: "ok",
    topic: topic.slice(0, 80),
    level: inferLevel(text),
    goal: `Learn ${topic}`.split(/\s+/).slice(0, 20).join(" "),
    constraints: inferConstraints(text),
    ignored_requests: ignoredFrom(text),
  };
  return { spec: learnerSpecSchema.parse(spec), leakHashes, rawNormalized: text, skippedModel: false };
}

export function mergeModelSpec(raw: string, modeled: unknown): IntakeResult {
  const base = specFromLearnerText(raw);
  if (base.skippedModel && base.spec.status !== "ok") return base;
  const parsed = learnerSpecSchema.safeParse(modeled);
  if (!parsed.success) return base;
  const spec = parsed.data;
  if (spec.status === "ok" && spec.topic.trim().length < 2) return base;
  if (spec.question === "") delete spec.question;
  return { ...base, spec, skippedModel: false };
}

export function topicSimilar(expected: string, actual: string): boolean {
  const a = new Set(wordTokens(expected));
  const b = new Set(wordTokens(actual));
  if (!a.size || !b.size) return expected.trim().length === 0 && actual.trim().length === 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits += 1;
  if (hits / a.size >= 0.3) return true;
  const left = [...a].join(" ");
  const right = [...b].join(" ");
  return left.includes(right) || right.includes(left);
}
