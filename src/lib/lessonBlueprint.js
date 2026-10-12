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
      "Show what code does, why it behaves that way, and how to debug it. Use real libraries and realistic scenarios. No fake-deep lines.",
    business:
      "Teach through real company decisions — name the company, the stakes, the outcome. Avoid buzzword strategy. Show the tradeoff.",
    design:
      "Use specific real products and screens. Explain WHY a design works or fails — cognitive load, hierarchy, affordance.",
    fitness:
      "Be precise: name the muscle, the rep range, the adaptation. Ground every claim in physiology, not vague motivation.",
    finance:
      "Use real numbers, real assets, real events. Walk through actual calculations. Flag where models break.",
    language:
      "Teach through real dialogue and authentic usage — not textbook sentences. Focus on patterns that transfer.",
    gaming:
      "Be tactical and match-specific. Name the map, the scenario, the decision. Reference real pro play where relevant.",
    general:
      "Use specific, named real-world examples — not hypothetical sketches. Numbers, dates, people, tools where possible.",
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
  if (t.length < 600 || t.length > 6000) return false;
  return true;
}
