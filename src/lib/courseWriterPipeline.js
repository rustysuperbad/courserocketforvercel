/**
 * Simple course writing — two API stages for lessons:
 *   1. Curriculum outline (structure only)
 *   2. One module write (2 lessons + quiz, natural sections)
 *
 * No per-lesson blueprint/editorial chains. Strong model for prose.
 */

import { generateStructuredJson } from "./courseAiApi";
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
  "Write like an experienced instructor teaching one real person — not a textbook, not corporate eLearning, not generic AI content.",
  "Voice: confident, direct, human. The tone of a strong YouTube educator or modern course creator.",
  "",
  "Avoid: filler, robotic transitions, repeating concepts, generic 'why this matters' paragraphs,",
  "overexplaining simple ideas, buzzwords, fake-deep philosophy, constant 'imagine this...' openers.",
  "",
  "Do: get to the point fast, use realistic specific examples, explain naturally, sound like a real expert.",
  "Teach practically. Every paragraph should move the learner's understanding forward.",
  "",
  "Sections — use ## headings. Pick only what genuinely helps this lesson:",
  "Introduction | Core Concept | Example | Real Use Case | Common Mistake | Quick Exercise | Key Takeaway",
  "Do NOT use the same sections on both lessons. Do NOT force every section every time.",
  "",
  "Exercises: one concrete task the learner can actually do — not a recall question.",
  "Programming courses: show what the code does, why it behaves that way, how to debug it.",
  "Never write fake-deep lines like 'syntax is the bridge between logic and execution.'",
  "",
  "Length: 350–600 words per lesson. Dense and clear — not padded. Short paragraphs.",
].join("\n");

export function buildCurriculumPrompt(moduleTarget, topic) {
  const domain = detectSubjectDomain(topic);
  const hint = domainTeachingHint(topic);
  return [
    "Design a course curriculum. Return ONLY valid JSON — no prose, no markdown fences.",
    `Domain: ${domain}. ${hint}`,
    "",
    "Rules:",
    "— Module titles name real subject matter — not slogans, not 'Foundations of X', not 'Introduction to X'.",
    "— Each module covers distinct territory. No concept overlap between modules.",
    "— Modules progress logically from fundamentals to application to nuance.",
    "— Module summaries: 2 sentences, specific to that module's actual content.",
    "— Concepts: 5–7 real domain terms practitioners use. No vague nouns.",
    "— No placeholder text, variable names, or template artifacts.",
    `— Exactly ${moduleTarget} modules.`,
    "",
    "OUTPUT JSON:",
    '{ "title": "...", "description": "2 clear sentences", "level": "Beginner|Intermediate|Advanced",',
    '  "estimatedHours": number, "courseKeyConcepts": ["6–10 real terms"],',
    '  "modules": [{ "title": "...", "summary": "...", "concepts": ["..."],',
    '    "youtubeQueries": ["..."], "paperTopics": ["..."] }] }',
  ].join("\n");
}

function buildModuleWritePrompt(module, topic, level, moduleIndex, totalModules, codeLang) {
  const concepts = (module.concepts || []).filter(Boolean).join(", ");
  return [
    WRITING_RULES,
    "",
    domainTeachingHint(topic, module),
    codeLang
      ? `Include at most one \`\`\`${codeLang} block per lesson where code genuinely helps. Explain what the code does in plain language.`
      : "No code blocks unless the topic truly requires them.",
    "",
    `Level: ${level || "Intermediate"}. Module ${moduleIndex + 1} of ${totalModules}.`,
    `Module: ${module.title}`,
    `Description: ${module.summary || "(see title)"}`,
    concepts ? `Concepts: ${concepts}` : "",
    "",
    "Write 2 lessons on this module. Each covers a distinct angle — no overlap between them.",
    "Lesson headings should be specific and engaging, not just the concept name.",
    "Include realistic examples, a practical exercise, and at least one common mistake or misconception.",
    "",
    'OUTPUT JSON: {"lessons":[{"heading":"...","text":"markdown with ## sections"},{"heading":"...","text":"..."}],',
    '"quiz":[{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."},',
    '{"question":"...","options":["a","b","c","d"],"correctIndex":2,"explanation":"..."}]}',
    "Exactly 2 lessons (350–600 words each) and 2 quiz questions. Return only JSON.",
  ].filter(Boolean).join("\n");
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

  const raw = await generateStructuredJson({
    kind: "module",
    systemPrompt: system,
    userMessage: user,
    evidenceQuery: [topic, module.title, module.summary, (module.concepts || []).join(" ")]
      .filter(Boolean)
      .join(" ")
      .slice(0, 700),
  });
  return parseJSON(raw);
}

export async function generateModuleLessons(module, topic, level, moduleIndex, totalModules) {
  const fingerprints = buildLeakFingerprints(topic);
  {
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

    if (ok) return {
      lessons,
      quiz,
      sources: Array.isArray(data.sources) ? data.sources : [],
      groundingStatus: data.groundingStatus || "unavailable",
    };

    console.warn(`[write] retry module ${module.id}`);
    const data2 = await writeModuleLessons(module, topic, level, moduleIndex, totalModules);
    const lessons2 = (data2.lessons || []).slice(0, 2).map((l) => ({
      heading: String(l?.heading || "").trim(),
      text: String(l?.text || "").trim(),
    }));
    return {
      lessons: lessons2,
      quiz: Array.isArray(data2.quiz) ? data2.quiz.slice(0, 2) : [],
      sources: Array.isArray(data2.sources) ? data2.sources : [],
      groundingStatus: data2.groundingStatus || "unavailable",
    };
  }
}

/** Alias for generateCourse import */
export const generateModuleLessonsPipeline = generateModuleLessons;
