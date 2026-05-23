/**
 * Simple course writing — two API stages for lessons:
 *   1. Curriculum outline (structure only)
 *   2. One module write (2 lessons + quiz, natural sections)
 *
 * No per-lesson blueprint/editorial chains. Strong model for prose.
 */

import { groqGenerateJson, GROQ_WRITER_MODEL, GROQ_PLANNER_MODEL } from "./groqChat";
import { detectSubjectDomain, domainTeachingHint, lessonMeetsSimpleBar } from "./lessonBlueprint";
import {
  assessLessonTextQuality,
  buildLeakFingerprints,
  deriveTeachingScopeFromPrompt,
  proseContainsBannedPatterns,
} from "./lessonContentQuality";
import { inferCodeLanguage } from "./courseGenerationUtils";

function parseJSON(raw) {
  const text = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(text);
}

export const WRITING_RULES = [
  "Voice: experienced instructor / strong YouTube educator / modern course creator teaching one real person.",
  "NOT: textbook, corporate e-learning, generic AI educational tone, motivational LinkedIn posts, fake-deep philosophy.",
  "",
  "Avoid completely: filler, repeating concepts, robotic transitions, generic 'why this matters' paragraphs,",
  "fake storytelling, constant 'imagine this…', overexplaining simple ideas, buzzwords, overly formal tone.",
  "Do: explain naturally, teach practically, realistic specific examples, clarity first, short paragraphs, get to the point fast.",
  "",
  "Structure: ## headings only. Use 4–7 sections per lesson — pick only what genuinely helps THIS lesson:",
  "Introduction | Core Concept | Example | Real Use Case | Common Mistake | Quick Exercise | Key Takeaway",
  "Do NOT use the same section list on both lessons. Do NOT force every section every time.",
  "",
  "Quick Exercise: one concrete task learners can actually do (you may start a line with Exercise:).",
  "Programming/tech: practical implementation, debugging, real workflows — explain what code does and how it behaves.",
  "Never write fake-deep lines (e.g. 'syntax is the bridge between logic and execution').",
].join("\n");

export function buildCurriculumPrompt(moduleTarget, topic) {
  const domain = detectSubjectDomain(topic);
  return [
    "Design a course outline. JSON only — no lesson prose.",
    `Topic domain: ${domain}. ${domainTeachingHint(topic)}`,
    `Exactly ${moduleTarget} modules with id, title, summary, concepts[4-7], youtubeQueries, paperTopics.`,
    "Also: title, description (2 clear sentences), level, estimatedHours, courseKeyConcepts[6-10].",
    "Module titles = real subject content, not slogans.",
  ].join("\n");
}

function buildModuleWritePrompt(module, topic, level, moduleIndex, totalModules, codeLang) {
  return [
    WRITING_RULES,
    "",
    domainTeachingHint(topic, module),
    codeLang
      ? `Include at most one \`\`\`${codeLang} fence per lesson where code helps — explain lines in plain language.`
      : "No programming code fences unless the topic truly requires them.",
    "",
    `Level: ${level || "Intermediate"}. Module ${moduleIndex + 1}/${totalModules}.`,
    `Module: ${module.title}`,
    `Scope: ${module.summary}`,
    `Concepts: ${(module.concepts || []).join(", ")}`,
    "",
    'OUTPUT JSON: {"lessons":[{"heading":"engaging title","text":"markdown with ## sections"},{"heading":"...","text":"..."}],',
    '"quiz":[{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."},',
    '{"question":"...","options":["a","b","c","d"],"correctIndex":2,"explanation":"..."}]}',
    "Exactly 2 lessons. ~250–450 words each.",
  ].join("\n");
}

/** @deprecated — kept for coursePipeline import compatibility */
export async function extractCourseIntent(topic) {
  return {
    domain: detectSubjectDomain(topic),
    topicScope: deriveTeachingScopeFromPrompt(topic) || String(topic).trim(),
    skillLevel: "Intermediate",
  };
}

/**
 * Write both lessons + quiz for one module (single pass).
 */
export async function writeModuleLessons(module, topic, level, moduleIndex, totalModules) {
  const codeLang = inferCodeLanguage(topic, module);
  const system = buildModuleWritePrompt(module, topic, level, moduleIndex, totalModules, codeLang);
  const user = `Course topic: ${deriveTeachingScopeFromPrompt(topic) || topic}\nWrite the JSON now.`;

  const raw = await groqGenerateJson(system, user, {
    model: GROQ_WRITER_MODEL,
    maxTokens: codeLang ? 4200 : 3600,
    temperature: 0.36,
    timeoutMs: 55000,
  });
  return parseJSON(raw);
}

export async function generateModuleLessons(module, topic, level, moduleIndex, totalModules) {
  const fingerprints = buildLeakFingerprints(topic);
  try {
    const data = await writeModuleLessons(module, topic, level, moduleIndex, totalModules);
    const lessons = (data.lessons || []).slice(0, 2).map((l) => ({
      heading: String(l?.heading || "").trim(),
      text: String(l?.text || "").trim(),
    }));
    const quiz = Array.isArray(data.quiz) ? data.quiz.slice(0, 2) : [];

    const ok =
      lessons.length === 2 &&
      lessons.every((l) => l.heading && l.text) &&
      lessons.every((l) => lessonMeetsSimpleBar(l.text)) &&
      lessons.every((l) => assessLessonTextQuality(l.text, fingerprints).ok) &&
      lessons.every((l) => !proseContainsBannedPatterns(l.text));

    if (ok) return { lessons, quiz };

    console.warn(`[write] retry module ${module.id}`);
    const data2 = await writeModuleLessons(module, topic, level, moduleIndex, totalModules);
    const lessons2 = (data2.lessons || []).slice(0, 2).map((l) => ({
      heading: String(l?.heading || "").trim(),
      text: String(l?.text || "").trim(),
    }));
    return { lessons: lessons2, quiz: Array.isArray(data2.quiz) ? data2.quiz.slice(0, 2) : [] };
  } catch (e) {
    throw e;
  }
}

/** Alias for generateCourse import */
export const generateModuleLessonsPipeline = generateModuleLessons;
