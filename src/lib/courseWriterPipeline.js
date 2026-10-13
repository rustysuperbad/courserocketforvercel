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
  splitLearnerRequest,
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
  "Write like a sharp instructor sitting next to one person. No textbook voice. No eLearning filler.",
  "Every sentence must teach a move the learner can use. If a paragraph could fit any course, delete it.",
  "Never copy, quote, or lightly rephrase the learner's request. Invent specific titles and examples.",
  "Do not use a fixed section template. Choose headings that fit THIS lesson only.",
  "Banned: Foundations of X, Introduction to X, Tools & Ecosystem, Core Concepts as a title,",
  "why this matters, let's dive in, in today's world, unlock, journey, robust, seamless, leverage.",
  "Programming: show a small real snippet, say what happens, say what breaks if you change one line.",
  "Exercises: one thing they can do in five minutes. Not a recall question.",
  "Length: 380–650 words. Short paragraphs. Specific nouns. No padding.",
].join("\n");

export function buildCurriculumPrompt(moduleTarget, topic) {
  const { goal, prior } = splitLearnerRequest(topic);
  const domain = detectSubjectDomain(goal);
  const hint = domainTeachingHint(goal);
  return [
    "Design a course curriculum. Return ONLY valid JSON — no prose, no markdown fences.",
    `Domain: ${domain}. ${hint}`,
    `Teach this goal: ${goal}`,
    prior ? `Skip or briefly nod at what they already know: ${prior}` : "Assume a motivated beginner in this exact skill.",
    "",
    "Rules:",
    "— Course title: 2–7 words naming the skill. Never a sentence. Never 'Introduction to …'.",
    "— Module titles name a concrete chunk of the skill (e.g. 'Print a petal with loops'), not a bucket like 'Foundations' or 'Tools & Ecosystem'.",
    "— Do not paste the learner's wording into any title, summary, or concept.",
    "— Each module covers distinct territory. Progress from first working example to a complete small piece.",
    "— Module summaries: 2 sentences about what they will be able to do.",
    "— Concepts: 5–7 terms a practitioner would actually say out loud.",
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
  const { goal, prior } = splitLearnerRequest(topic);
  const concepts = (module.concepts || []).filter(Boolean).join(", ");
  return [
    WRITING_RULES,
    "",
    domainTeachingHint(goal, module),
    codeLang
      ? `Include at most one \`\`\`${codeLang} block per lesson where code genuinely helps. Explain what the code does in plain language.`
      : "No code blocks unless the topic truly requires them.",
    "",
    `Level: ${level || "Intermediate"}. Module ${moduleIndex + 1} of ${totalModules}.`,
    `Skill: ${goal}`,
    prior ? `Already know: ${prior}` : "",
    `Module: ${module.title}`,
    `Description: ${module.summary || "(see title)"}`,
    concepts ? `Concepts: ${concepts}` : "",
    "",
    "Write 2 lessons on this module. Each covers a distinct angle — no overlap.",
    "Headings must be specific to the skill, not the learner's original sentence.",
    "Include one worked example, one thing that usually goes wrong, and one tiny exercise.",
    "",
    'OUTPUT JSON: {"lessons":[{"heading":"...","text":"markdown with ## sections"},{"heading":"...","text":"..."}],',
    '"quiz":[{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."},',
    '{"question":"...","options":["a","b","c","d"],"correctIndex":2,"explanation":"..."}]}',
    "Exactly 2 lessons (380–650 words each) and 2 quiz questions. Return only JSON.",
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
  const { goal, prior } = splitLearnerRequest(topic);
  const user = `Skill to teach: ${goal || deriveTeachingScopeFromPrompt(topic) || topic}${prior ? `\nAlready know: ${prior}` : ""}\nWrite the JSON now. Do not repeat the skill sentence as a title.`;

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
