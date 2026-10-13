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
  "Must: write like a sharp instructor sitting next to one person.",
  "Must: every sentence teach a move the learner can use.",
  "Must: invent specific titles and examples. Never copy the learner's wording.",
  "Must: exactly 2 lessons and 2 quiz questions with 4 options each.",
  "Must: 3–6 ## headings per lesson that fit THIS lesson only. 380–650 words each.",
  "Must not: textbook voice, eLearning filler, or a fixed section template.",
  "Must not: Foundations of X, Introduction to X, Tools & Ecosystem, Core Concepts as a title.",
  "Must not: why this matters, let's dive in, in today's world, unlock, journey, robust, seamless, leverage.",
  "Programming: at most one real snippet per lesson; say what happens and what breaks if one line changes.",
  "Exercises: one thing they can do in five minutes. Not a recall question.",
].join("\n");

/** Static system prefix — keep identical across calls for Groq prompt caching. */
export const CURRICULUM_SYSTEM = [
  "You are a senior curriculum designer for CourseRocket.",
  "Must: return only a JSON object. No markdown fences. No prose before or after the JSON.",
  "Must: invent specific titles. Never copy, quote, or lightly rephrase the learner's wording.",
  "Must not: Introduction to …, Foundations, Tools & Ecosystem, or sentence-length titles.",
  "Course title: 2–7 words naming the skill.",
  "Each module title names a concrete chunk of the skill.",
  "Each module summary: 2 sentences about what they will be able to do.",
  "Each module concepts: 5–7 terms a practitioner would say out loud.",
  "Each module youtubeQueries and paperTopics: exactly one short search string each.",
  "Modules progress from a first working example to a complete small piece. No overlapping territory.",
  "",
  "Example (format only — do not copy the subject):",
  JSON.stringify({
    title: "Print first petals",
    description: "You will draw a simple flower with loops, then reuse the same pattern for a second bloom.",
    level: "Beginner",
    estimatedHours: 4,
    courseKeyConcepts: ["loop", "turtle heading", "repeat", "function", "canvas"],
    modules: [
      {
        id: "module_1",
        title: "Draw one petal",
        summary: "You will turn, draw an arc, and land back at the start. You will know it worked when one petal sits on the canvas.",
        concepts: ["heading", "forward", "arc"],
        youtubeQueries: ["python turtle draw petal"],
        paperTopics: ["logo turtle geometry education"],
      },
    ],
  }),
  "The live request below will tell you the exact module count. Match that count. Return only JSON.",
].join("\n");

export function buildCurriculumPrompt(moduleTarget, topic) {
  return CURRICULUM_SYSTEM;
}

export function buildCurriculumUserMessage(moduleTarget, topic) {
  const { goal, prior } = splitLearnerRequest(topic);
  const domain = detectSubjectDomain(goal);
  const hint = domainTeachingHint(goal);
  return [
    "Live request",
    `Module count: exactly ${moduleTarget}.`,
    `Domain: ${domain}. ${hint}`,
    `Learner goal:\n${goal}`,
    prior ? `They already know:\n${prior}` : "Assume a motivated beginner in this exact skill.",
    "Return the JSON object now. Never copy the learner's wording into titles or summaries.",
  ].filter(Boolean).join("\n\n");
}

const MODULE_EXAMPLE = JSON.stringify({
  lessons: [
    {
      heading: "Turn, then close the petal",
      text: "## Set a heading\n\nPoint the turtle 60 degrees left of the stem. That heading is the only input that decides the petal's lean.\n\n## Draw the arc\n\nWalk a short arc and stop when you are back at the stem. If the end misses the start, the heading was wrong — not the pen.\n\n## Five-minute check\n\nChange the heading by 15 degrees and draw again. You should see a wider or tighter petal, not a scribble.",
    },
    {
      heading: "Reuse the petal as a function",
      text: "## Name the move\n\nWrap the heading-plus-arc sequence in a function so the second petal does not copy the first by hand.\n\n## Call it twice\n\nCall the function, rotate the stem, call it again. Two petals should share size and miss only if the rotation is wrong.\n\n## What breaks\n\nIf you rotate after lifting the pen, the second petal floats. Keep the pen down through the rotate.",
    },
  ],
  quiz: [
    {
      question: "A petal ends away from the stem. What do you check first?",
      options: ["The heading at the start of the arc", "The canvas background", "The file name", "The Python version"],
      correctIndex: 0,
      explanation: "The heading is the input that aims the arc. Size and color will not close a miss.",
    },
    {
      question: "Why wrap the petal in a function before drawing a second one?",
      options: [
        "So both petals share one move you can rotate",
        "So the file runs faster",
        "So you can skip the heading",
        "So the turtle stays hidden",
      ],
      correctIndex: 0,
      explanation: "A function is the same move with a new rotation. Copy-paste hides the mistake.",
    },
  ],
});

/** Static system prefix — keep identical across modules for Groq prompt caching. */
export const MODULE_SYSTEM = [
  "You are a senior technical instructor writing one CourseRocket module.",
  WRITING_RULES,
  "Must: return only a JSON object. No markdown fences. No prose outside JSON.",
  "Must: lessons[0] and lessons[1] cover distinct angles. Do not return 1 or 3 of either lessons or quiz.",
  "Must: quiz options are plausible. correctIndex is 0, 1, 2, or 3.",
  "Must: ground facts in the research evidence in the user message. Do not invent URLs, papers, or citations.",
  "If a listed source supports a fact, cite it as [1] or [2] using that source id. If evidence is thin, teach the stable idea with no citation.",
  "Headings must be specific to the skill, not the learner's original sentence.",
  "",
  "Example of the required shape (do not copy the subject; real lessons must be 380–650 words each):",
  MODULE_EXAMPLE,
].join("\n");

function buildModuleUserMessage(module, topic, level, moduleIndex, totalModules, codeLang) {
  const { goal, prior } = splitLearnerRequest(topic);
  const concepts = (module.concepts || []).filter(Boolean).join(", ");
  return [
    "Live request",
    `Level: ${level || "Intermediate"}.`,
    `Module ${moduleIndex + 1} of ${totalModules}.`,
    `Skill:\n${goal}`,
    prior ? `Already know:\n${prior}` : "",
    `Module title:\n${module.title}`,
    `Module summary:\n${module.summary || "(see title)"}`,
    concepts ? `Concepts:\n${concepts}` : "",
    domainTeachingHint(goal, module),
    codeLang
      ? `Code: at most one \`\`\`${codeLang} block per lesson, only where it teaches. Explain the snippet in plain language.`
      : "No code blocks unless the topic truly requires them.",
    "Write exactly 2 lessons and 2 quiz questions for this module.",
  ].filter(Boolean).join("\n\n");
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
  const raw = await generateStructuredJson({
    kind: "module",
    systemPrompt: MODULE_SYSTEM,
    userMessage: buildModuleUserMessage(module, topic, level, moduleIndex, totalModules, codeLang),
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
    const quizOk =
      quiz.length === 2 &&
      quiz.every((q) => String(q?.question || "").trim() && Array.isArray(q?.options) && q.options.length >= 4);

    const ok =
      lessons.length === 2 &&
      lessons.every((l) => l.heading && l.text) &&
      lessons.every((l) => lessonMeetsSimpleBar(l.text)) &&
      lessons.every((l) => assessLessonTextQuality(l.text, fingerprints).ok) &&
      lessons.every((l) => !proseContainsBannedPatterns(l.text)) &&
      quizOk;

    const pack = (payload, nextLessons, nextQuiz) => ({
      lessons: nextLessons,
      quiz: nextQuiz,
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      groundingStatus: payload.groundingStatus || "unavailable",
    });

    if (ok) return pack(data, lessons, quiz);

    console.warn(`[write] retry module ${module.id}`);
    const data2 = await writeModuleLessons(module, topic, level, moduleIndex, totalModules);
    const lessons2 = (data2.lessons || []).slice(0, 2).map((l) => ({
      heading: String(l?.heading || "").trim(),
      text: String(l?.text || "").trim(),
    }));
    const quiz2 = Array.isArray(data2.quiz) ? data2.quiz.slice(0, 2) : [];
    const firstComplete = lessons.length === 2 && lessons.every((l) => l.heading && l.text);
    const secondComplete = lessons2.length === 2 && lessons2.every((l) => l.heading && l.text);
    if (secondComplete) return pack(data2, lessons2, quiz2);
    if (firstComplete) return pack(data, lessons, quiz);
    return pack(data2, lessons2, quiz2);
  }
}

/** Alias for generateCourse import */
export const generateModuleLessonsPipeline = generateModuleLessons;
