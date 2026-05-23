/** Shared course generation helpers (no Groq calls). */

const HIGH_SIGNALS = [
  "detailed", "comprehensive", "professional", "advanced", "in-depth",
  "thorough", "deep", "extensive", "complete", "expert", "mastery",
  "production", "everything", "rigorous", "full course",
];
const LOW_SIGNALS = [
  "intro", "introduction", "basics", "beginner", "quick", "simple",
  "overview", "crash course", "fundamentals", "getting started", "101",
];

export function detectComplexity(topic) {
  const t = topic.toLowerCase();
  const hi = HIGH_SIGNALS.filter((s) => t.includes(s)).length;
  const lo = LOW_SIGNALS.filter((s) => t.includes(s)).length;
  if (hi >= 2) return "deep";
  if (hi >= 1 && hi >= lo) return "high";
  if (lo >= 1) return "low";
  return "medium";
}

export const MODULE_COUNT = { low: "4", medium: "5", high: "6", deep: "7" };

export function inferCodeLanguage(topic, module) {
  const blob = `${topic} ${module?.title || ""} ${module?.summary || ""} ${(module?.concepts || []).join(" ")}`.toLowerCase();
  const rules = [
    [/python|django|flask|pandas|numpy|pytorch|sklearn/, "python"],
    [/typescript|\btsx\b|angular/, "typescript"],
    [/javascript|\bjs\b|node\.?js|react|vue|next\.?js|nestjs|express/, "javascript"],
    [/\bkotlin\b|android/, "kotlin"],
    [/\bjava\b|spring|jvm/, "java"],
    [/c\+\+|\bcpp\b/, "cpp"],
    [/c#|\.net|dotnet/, "csharp"],
    [/\brust\b/, "rust"],
    [/\bgolang\b|\bgo\b/, "go"],
    [/sql|postgres|mysql|sqlite/, "sql"],
    [/bash|shell|\bzsh\b|terminal/, "bash"],
    [/swift|\bios\b/, "swift"],
    [/ruby|rails/, "ruby"],
    [/php|laravel/, "php"],
  ];
  for (const [re, lang] of rules) {
    if (re.test(blob)) return lang;
  }
  if (
    /\b(code|programming|developer|software engineer|api\b|git\b|github|docker|kubernetes|algorithm|data structure|leetcode|compiler|debugging|oop\b|functional programming)\b/.test(
      blob
    )
  ) {
    return "javascript";
  }
  return null;
}
