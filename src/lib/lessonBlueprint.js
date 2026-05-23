/**
 * Simple flexible lesson sections — not a rigid framework.
 */

export const FLEX_SECTIONS = [
  "Introduction",
  "Core Concept",
  "Example",
  "Real Use Case",
  "Common Mistake",
  "Quick Exercise",
  "Key Takeaway",
];

const DOMAIN_PATTERNS = [
  ["coding", /\b(code|programming|developer|software|python|javascript|react|api\b|algorithm)\b/i],
  ["business", /\b(business|startup|management|strategy|sales|leadership)\b/i],
  ["design", /\b(design|ux\b|ui\b|figma|visual|branding)\b/i],
  ["fitness", /\b(fitness|workout|training|nutrition|gym)\b/i],
  ["finance", /\b(finance|investing|trading|stocks|accounting|valuation)\b/i],
  ["language", /\b(language|spanish|french|grammar|fluency|esl)\b/i],
  ["gaming", /\b(cs2|counter.?strike|valorant|game|ranked|fps|esports)\b/i],
  ["general", /.*/],
];

export function detectSubjectDomain(topic, module) {
  const blob = `${topic} ${module?.title || ""} ${module?.summary || ""}`;
  for (const [domain, re] of DOMAIN_PATTERNS) {
    if (domain !== "general" && re.test(blob)) return domain;
  }
  return "general";
}

export function domainTeachingHint(topic, module) {
  const d = detectSubjectDomain(topic, module);
  const hints = {
    coding:
      "Hands-on: what the code does, debugging, real workflows. No fake-deep lines like 'syntax is the bridge between logic and execution.'",
    business: "Decisions, tradeoffs, real operations — not buzzword strategy fluff.",
    design: "Visual intuition, real product examples, concrete critique.",
    fitness: "Actionable steps, progression, safety — motivating but not cheesy.",
    finance: "Clear numbers, assumptions, when models break — no hype.",
    language: "Patterns, real dialogue, mistakes natives notice.",
    gaming: "Tactical, match-based examples — specific not generic.",
    general: "Concrete examples with names, numbers, or tools where possible.",
  };
  return hints[d] || hints.general;
}

export function extractLessonH2(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

export function lessonMeetsSimpleBar(text) {
  const t = String(text || "");
  const h2 = extractLessonH2(t);
  if (h2.length < 3 || h2.length > 8) return false;
  if (t.length < 450 || t.length > 5200) return false;
  return true;
}
