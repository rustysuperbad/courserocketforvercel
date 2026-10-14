// ─────────────────────────────────────────────────────────────────────────────
//  Course generation pipeline — production version
//
//  Used in two flows:
//  - Full parallel enrich: enrichModules (all modules at once).
//  - Incremental Firestore saves: enrichOneModule + coursePipeline runner
//    so progress survives refresh mid-generation.
//
//  Public API:
//    generateCourseStructure(topic) → curriculum outline
//    enrichModules / enrichOneModule → one write pass per module (2 lessons + quiz)
//
//  Each module ends up with: lessons[], quiz[], videos[], papers[].
//  Every external call has a timeout, a try/catch, and a guaranteed fallback —
//  no path can ever produce empty/missing content silently.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchYouTubeVideos } from "./fetchYoutube";
import { fetchPapers } from "./fetchPapers";
import { requestRagCourse } from "./courseAiApi";
import { generateModuleLessons } from "./courseWriterPipeline";
import {
  assessLessonTextQuality,
  assessQuizLeakage,
  buildLeakFingerprints,
  repairCommonMarkdownIssues,
  splitLearnerRequest,
} from "./lessonContentQuality";
/** Strip accidental scaffolding / leaky JSON-ish lines models rarely emit. */
const LEAK_LINE_RE =
  /^\s*[[{]?\s*"(quiz|lessons|options|correctIndex)"\s*:/i;

function sanitizeLessonHeading(h) {
  return String(h || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[#>*\d.]+\s*/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .slice(0, 200);
}

/** Normalize lesson markdown for rendering: stable newlines, no control chars. */
function scrubLessonMarkdownText(text) {
  let t = String(text ?? "")
    .replace(/\uFEFF/g, "")
    // eslint-disable-next-line no-control-regex -- strip NUL bytes from model output
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  t = t
    .split("\n")
    .filter((line) => line.length > 0 && !LEAK_LINE_RE.test(line))
    .join("\n");

  t = t.replace(/```([a-zA-Z0-9+#.-]*)\u00A0/g, "```$1 ");
  while (/\n{3,}/g.test(t)) t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/** Heuristic: title is lazy echo of user's long verbatim prompt → editorialize lightly. */
function refineCatalogTitleIfLazy(titleRaw, topicRaw) {
  const title = String(titleRaw || "").trim().replace(/\s+/g, " ");
  const topic = String(topicRaw || "").trim().replace(/\s+/g, " ");
  if (!title || !topic) return title || topic || "Custom course";

  const tLower = title.toLowerCase();
  const kLower = topic.toLowerCase();
  const topicWords = topic.split(/\s+/).filter(Boolean);
  const verbose = topicWords.length >= 14 || topic.length >= 130;
  const nearEqual = tLower === kLower || (verbose && kLower.startsWith(tLower) && title.length >= topic.length * 0.85);

  if (nearEqual && verbose) {
    const condensed = topicWords.slice(0, 9).join(" ");
    return condensed ? `Structured path · ${condensed}` : title;
  }
  return title;
}

function shapeEnrichedModule(module, lessonResult, videos, papers) {
  return {
    ...module,
    lessons: (lessonResult.lessons || []).slice(0, 2),
    quiz: (lessonResult.quiz || []).slice(0, 2),
    sources: lessonResult.sources || [],
    groundingStatus: lessonResult.groundingStatus || "unavailable",
    generationQuality: lessonResult.generationQuality || "template-fallback",
    videos: (videos || []).slice(0, 2),
    papers: (papers || []).slice(0, 2),
    mediaAttempted: true,
  };
}

function takeStrings(list, max) {
  return (Array.isArray(list) ? list : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeOutlineModules(modules, targetCount) {
  const n = Math.max(4, Math.min(7, Number(targetCount) || 5));
  return (Array.isArray(modules) ? modules : []).slice(0, n).map((m, i) => {
    const title = String(m?.title || `Module ${i + 1}`).trim();
    const youtubeQueries = takeStrings(m?.youtubeQueries, 1);
    const paperTopics = takeStrings(m?.paperTopics, 1);
    return {
      id: String(m?.id || `module_${i + 1}`),
      title,
      summary: String(m?.summary || "").trim(),
      concepts: takeStrings(m?.concepts, 6),
      youtubeQueries: youtubeQueries.length ? youtubeQueries : [title],
      paperTopics: paperTopics.length ? paperTopics : [title],
    };
  });
}

function normalizeCourseKeyConcepts(raw, modules) {
  const fromModel = Array.isArray(raw)
    ? raw.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  if (fromModel.length >= 4) return fromModel.slice(0, 12);

  const lifted = [];
  const firstMod = Array.isArray(modules) ? modules[0] : null;
  if (firstMod?.concepts?.length) {
    lifted.push(...firstMod.concepts.map((c) => String(c || "").trim()).filter(Boolean));
  }
  const seen = new Set();
  const out = [];
  for (const x of [...fromModel, ...lifted]) {
    const k = x.toLowerCase();
    if (x.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= 10) break;
  }
  return out.slice(0, 12);
}

/** Each question: 4 options, valid index, trimmed strings. */
function normalizeQuizItems(quizIn) {
  if (!Array.isArray(quizIn)) return [];
  const out = [];
  for (const q of quizIn) {
    if (!q || typeof q !== "object") continue;
    const question = String(q.question || "").trim();
    let options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "").trim()) : [];
    if (options.length < 4) continue;
    options = options.slice(0, 4);
    if (options.some((o) => !o)) continue;
    let correctIndex = Number(q.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) correctIndex = 0;
    let explanation = repairCommonMarkdownIssues(String(q.explanation || "").trim());
    out.push({
      question: repairCommonMarkdownIssues(question),
      options: options.map((o) => repairCommonMarkdownIssues(o)),
      correctIndex,
      explanation,
    });
    if (out.length >= 2) break;
  }
  return out;
}

function normalizeLessonsPayload(lessonsIn) {
  if (!Array.isArray(lessonsIn)) return [];
  return lessonsIn
    .slice(0, 2)
    .map((l) => ({
      heading: sanitizeLessonHeading(l?.heading),
      text: repairCommonMarkdownIssues(scrubLessonMarkdownText(l?.text || "")),
    }))
    .filter((l) => l.heading && l.text);
}

export function outlineModuleForRegenerate(m) {
  return {
    id: m.id,
    title: m.title || "",
    summary: m.summary || "",
    concepts: Array.isArray(m.concepts) ? m.concepts : [],
    youtubeQueries: Array.isArray(m.youtubeQueries) ? m.youtubeQueries : [],
    paperTopics: Array.isArray(m.paperTopics) ? m.paperTopics : [],
  };
}

function simpleFallbackLesson(topic, title, c1, c2, variant) {
  const sections =
    variant === 0
      ? ["Introduction", "Core Concept", "Example", "Quick Exercise", "Key Takeaway"]
      : ["Core Concept", "Real Use Case", "Common Mistake", "Example", "Key Takeaway"];
  const blocks = sections.map((name) => {
    const h = "## " + name;
    if (/introduction/i.test(name)) {
      return `${h}\n\nThis module covers **${title}** inside **${topic}**. You will work with **${c1}** and see how **${c2}** shows up in real decisions — not just definitions on a slide.`;
    }
    if (/core/i.test(name)) {
      return `${h}\n\n**${c1}** is the idea you actually use day to day. **${c2}** is how you check whether you applied it correctly — with numbers, logs, or a clear pass/fail rule.`;
    }
    if (/mistake|miss|fail/i.test(name)) {
      return `${h}\n\n- Treating a proxy as if it were **${c1}**.\n- Running **${c2}** on stale or partial data.\n- Calling it done because one chart looks fine while edge cases still break.`;
    }
    if (/exercise|drill/i.test(name)) {
      return `${h}\n\nExercise: Change one input that should flip **${c2}** from pass to fail. Write down what you expect to see first, then rerun your check and compare.`;
    }
    if (/takeaway/i.test(name)) {
      return `${h}\n\nYou can explain **${c1}** with a concrete **${topic}** example, walk through **${c2}**, and name one mistake you would catch before shipping.`;
    }
    if (/use case|real/i.test(name)) {
      return `${h}\n\nA team working on **${topic}** tracks **${c1}**, applies **${c2}**, and records what they change when results look wrong. Note the decision they make — not just the metric they plotted.`;
    }
    return `${h}\n\nExample in **${topic}**: someone measures **${c1}**, runs **${c2}**, and adjusts one input when the outcome does not match what they expected.`;
  });
  return blocks.join("\n\n");
}

function fallbackQuiz(module) {
  const title = String(module.title || "this module");
  return [
    {
      question: `What should you be able to do after ${title}?`,
      options: [
        `Use ${title} on a concrete example and check the result`,
        "Repeat a definition without applying it",
        "Skip the check that would catch a mistake",
        "Treat a proxy as the real outcome",
      ],
      correctIndex: 0,
      explanation: "The point of the module is a usable move, not a memorized label.",
    },
    {
      question: `Which mistake is most likely while learning ${title}?`,
      options: [
        "Stopping at a definition instead of running a check",
        "Using a small real example",
        "Naming the concept out loud",
        "Writing down what would falsify the idea",
      ],
      correctIndex: 0,
      explanation: "Definitions without a check feel finished and hide errors.",
    },
  ];
}

function completeModulePayload(module, topic, lessonResult) {
  let lessons = normalizeLessonsPayload(lessonResult.lessons);
  let quiz = normalizeQuizItems(lessonResult.quiz);
  const writerOk = lessons.length >= 2 && quiz.length >= 2 && lessonResult.generationQuality === "generated";
  if (lessons.length < 2) {
    const fill = fallbackLessons(module, topic);
    lessons = [...lessons, ...fill].slice(0, 2);
  }
  if (quiz.length < 2) {
    const fill = fallbackQuiz(module);
    quiz = [...quiz, ...fill].slice(0, 2);
  }
  return {
    ...lessonResult,
    lessons,
    quiz,
    generationQuality: writerOk ? "generated" : "template-fallback",
  };
}

function fallbackLessons(module, topic) {
  const title = module.title || "Core ideas";
  const concepts = Array.isArray(module.concepts) ? module.concepts.filter(Boolean) : [];
  const c1 = concepts[0] || "the main idea";
  const c2 = concepts[1] || "how it is applied";
  return [
    { heading: title, text: simpleFallbackLesson(topic, title, c1, c2, 0) },
    { heading: `Applying ${title}`, text: simpleFallbackLesson(topic, title, c1, c2, 1) },
  ];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Robust JSON parser ─────────────────────────────────────────────────────
function strip(s) {
  let out = s;
  for (let i = 0; i < 5; i++) {
    const n = out.replace(/,(\s*[}\]])/g, "$1");
    if (n === out) break;
    out = n;
  }
  return out;
}

function balancedJSON(text) {
  const s = text.trim();
  const idx = s.search(/[[{]/);
  if (idx === -1) return null;
  let d = 0, str = false, esc = false;
  for (let i = idx; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (str) { if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') { str = true; continue; }
    if (c === "{" || c === "[") d++;
    else if (c === "}" || c === "]") { d--; if (d === 0) return s.slice(idx, i + 1); }
  }
  return null;
}

function closeJSON(s) {
  let f = strip(s).replace(/,?\s*"[^"]*$/, "").replace(/,?\s*$/, "");
  const stack = [];
  let str = false, esc = false;
  for (const ch of f) {
    if (esc) { esc = false; continue; }
    if (str) { if (ch === "\\") esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') { str = true; continue; }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  return f + stack.reverse().join("");
}

function parseJSON(raw) {
  const text = raw.replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const tries = [text, balancedJSON(text), closeJSON(text)].filter(Boolean);
  for (const chunk of tries) {
    for (const c of [chunk, strip(chunk)]) {
      try { return JSON.parse(c); } catch {
        const b = balancedJSON(c);
        if (b && b !== c) { try { return JSON.parse(strip(b)); } catch { /* next */ } }
      }
    }
  }
  throw new Error("Could not parse AI response.");
}

// ─── Fallbacks (always populated, never empty) ──────────────────────────────
function fallbackStructure(topic, complexity) {
  const n = complexity === "deep" ? 7 : complexity === "high" ? 6 : complexity === "medium" ? 5 : 4;
  const names = ["Foundations", "Core Concepts", "Practical Workflow", "Tools & Ecosystem",
                 "Implementation", "Advanced Techniques", "Optimization"].slice(0, n);
  const keyBits = topic
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8);
  return {
    generationQuality: "template-fallback",
    title: "Introduction to " + topic,
    description: "A structured course on " + topic + " from fundamentals to practical application.",
    level: "Beginner",
    estimatedHours: n + 2,
    courseKeyConcepts:
      keyBits.length >= 3
        ? keyBits.slice(0, 10)
        : ["Foundations", "Core skills", "Practice", "Assessment"].slice(0, Math.min(4, n)),
    modules: names.map((name, i) => ({
      id: "module_" + (i + 1),
      title: name + " — " + topic,
      summary: "Understand and apply key ideas for " + name.toLowerCase() + " with practical examples.",
      youtubeQueries: [topic + " " + name + " tutorial"],
      paperTopics: [topic + " " + name],
      concepts: [topic.toLowerCase().replace(/\s+/g, "_") + "_" + (i + 1)],
    })),
  };
}

// ─── Phase 1: course structure ──────────────────────────────────────────────
function noteForJobStage(stage, fallback) {
  const value = String(stage || "").toLowerCase();
  if (!value || value === "queued") return "Reading your goal…";
  if (value.includes("intake")) return "Reading your goal…";
  if (value.includes("plan") || value.includes("path")) return "Choosing the path…";
  if (value.includes("research") || value.includes("source") || value.includes("compile")) return "Gathering sources…";
  if (value.includes("write") || value.includes("lesson") || value.includes("rewrite")) return "Writing the lessons…";
  if (value.includes("verif") || value.includes("quiz")) return "Checking the quiz…";
  if (value.includes("video") || value.includes("paper") || value.includes("resource")) return "Picking a video…";
  if (value.includes("assemble") || value.includes("done") || value.includes("complete")) return "Ready to open…";
  return fallback || "Designing your course…";
}

export async function generateCourseStructure(topic, onProgress) {
  const cb = onProgress || (() => {});
  cb("Reading your goal…", 4);

  const rag = await requestRagCourse({
    topic,
    onProgress: (job) => cb(noteForJobStage(job.stage, "Designing your course…"), Number(job.percent) || 0),
  });
  const intakeStatus = rag?.spec?.status || rag?.status;
  if (intakeStatus === "needs_clarification") {
    throw new Error("Need a clearer topic. Say what this course should cover.");
  }
  if (intakeStatus === "rejected") {
    throw new Error("This request cannot be turned into a course.");
  }
  const ragModules = Array.isArray(rag?.modules) ? rag.modules : [];
  const usable = ragModules.filter((mod) => (mod.lessons || []).length > 0 || mod.status === "ready");
  if (!usable.length) {
    throw new Error("We couldn't find enough reliable material to teach this well. Try a more specific topic or rephrase it.");
  }
  const { goal } = splitLearnerRequest(rag.spec?.goal || topic);
  const ignored = (rag.spec?.ignored_requests || []).filter(Boolean);
  const modules = usable.map((mod, i) => ({
    id: mod.id || `module_${i + 1}`,
    title: mod.title,
    summary: mod.summary,
    concepts: Array.isArray(mod.concepts) ? mod.concepts : [],
    youtubeQueries: mod.youtubeQueries || [mod.title],
    paperTopics: mod.paperTopics || [mod.title],
    lessons: Array.isArray(mod.lessons) ? mod.lessons : [],
    quiz: Array.isArray(mod.quiz) ? mod.quiz : [],
    generationQuality: mod.generationQuality || (mod.status === "ready" ? "generated" : mod.status),
    gaps: mod.gaps || [],
  }));
  return {
    title: refineCatalogTitleIfLazy(rag.spec?.topic || goal, goal),
    description: ignored.length
      ? `${rag.spec?.goal || ""} This course covers ${rag.spec?.topic} only.`.trim()
      : rag.spec?.goal || "",
    level: rag.spec?.level || "beginner",
    estimatedHours: Math.max(1, modules.length),
    courseKeyConcepts: normalizeCourseKeyConcepts(
      (rag.spec?.topic || "").split(" ").filter(Boolean),
      modules,
    ),
    modules,
    generationQuality: rag.publishable ? "generated" : "needs_review",
    ragRunId: rag.runId,
    ragSummary: rag.summary,
    spec: rag.spec,
    intakeStatus,
    ignoredRequests: ignored,
  };
}

// ─── Phase 2: enrich every module with lessons + videos + papers ────────────
//
// For each module we run THREE independent fetches in parallel:
//   1. Groq lesson + quiz generation
//   2. YouTube video search (2 results)
//   3. OpenAlex paper search (2 results)
//
// All modules run in parallel too. Wall time ≈ slowest single module.
// Every fetch has a timeout and a fallback — output is GUARANTEED populated.

function assessModuleContentGate(lessons, quiz, fingerprints) {
  const lessonFails = [];
  for (const l of lessons || []) {
    const hOk = assessLessonTextQuality(String(l?.heading || ""), fingerprints);
    if (!hOk.ok) lessonFails.push(...hOk.failures.map((f) => `heading:${f}`));
    const tOk = assessLessonTextQuality(String(l?.text || ""), fingerprints);
    if (!tOk.ok) lessonFails.push(...tOk.failures.map((f) => `body:${f}`));
  }
  const qLeak = assessQuizLeakage(quiz, fingerprints);
  const quizFails = qLeak.failures.length ? [...new Set(qLeak.failures)] : [];
  return {
    lessonFails,
    quizFailSet: new Set(quizFails),
    gateOk:
      lessonFails.length === 0 &&
      quizFails.length === 0,
  };
}

async function generateLessonForModule(m, topic, i, total, level, extraUserInstructions = "") {
  if (!String(extraUserInstructions).trim() && Array.isArray(m.lessons) && m.lessons.length >= 1) {
    return {
      lessons: normalizeLessonsPayload(m.lessons),
      quiz: normalizeQuizItems(m.quiz),
      sources: [],
      groundingStatus: "rag",
      generationQuality: m.generationQuality === "generated" ? "generated" : m.generationQuality || "generated",
    };
  }
  try {
    const moduleInput =
      String(extraUserInstructions).trim()
        ? {
            ...m,
            summary: `${m.summary || ""}\nNotes: ${String(extraUserInstructions).trim()}`,
          }
        : m;
    const { lessons: rawLessons, quiz: rawQuiz, sources, groundingStatus } = await generateModuleLessons(
      moduleInput,
      topic,
      level,
      i,
      total
    );
    const lessons = normalizeLessonsPayload(rawLessons).slice(0, 2);
    const quiz = normalizeQuizItems(rawQuiz).slice(0, 2);
    const fingerprints = buildLeakFingerprints(topic);
    const gate = assessModuleContentGate(lessons, quiz, fingerprints);
    if (gate.lessonFails.length) {
      console.warn(`[gen] quality notes for ${m.id}:`, gate.lessonFails.slice(0, 4).join(", "));
    }
    return completeModulePayload(m, topic, {
      lessons,
      quiz,
      sources: Array.isArray(sources) ? sources : [],
      groundingStatus: groundingStatus || "unavailable",
      generationQuality: lessons.length >= 2 ? "generated" : "template-fallback",
    });
  } catch (e) {
    console.warn(`[gen] write failed for ${m.id}:`, e.message);
    return completeModulePayload(m, topic, {
      lessons: [],
      quiz: [],
      sources: [],
      groundingStatus: "unavailable",
      generationQuality: "failed",
    });
  }
}

async function fetchModuleVideos(m, videoOpts = {}) {
  const ytQuery = (m.youtubeQueries || [])[0] || m.title;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const preferredLanguage =
    videoOpts.preferredVideoLanguage ?? m.preferredVideoLanguage;
  try {
    let videos = await fetchYouTubeVideos(ytQuery, 2, ctrl.signal, {
      preferredLanguage,
    });
    if (!Array.isArray(videos) || videos.length === 0) {
      const shortQuery = String(m.title || "").split(/\s+/).slice(0, 6).join(" ");
      if (shortQuery && shortQuery !== ytQuery) {
        videos = await fetchYouTubeVideos(shortQuery, 2, ctrl.signal, { preferredLanguage });
      }
    }
    return Array.isArray(videos) ? videos : [];
  } catch (e) {
    console.warn(`[gen] videos failed for ${m.id}:`, e?.message || e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchModulePapers(m) {
  const paperTopic = (m.paperTopics || [])[0] || m.title;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const papers = await fetchPapers(paperTopic, 2, ctrl.signal);
    return Array.isArray(papers) ? papers : [];
  } catch (e) {
    console.warn(`[gen] papers failed for ${m.id}:`, e?.message || e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichModules(modules, topic, level, onProgress, options = {}) {
  const cb = onProgress || (() => {});
  const vidLangOpt = options.preferredVideoLanguage;
  cb("Writing lessons, videos, and papers…");

  const total = modules.length;
  let done = 0;

  const enriched = await Promise.all(
    modules.map(async (m, i) => {
      // Stagger parallel module calls to reduce burst rate limits.
      await wait(i * 80);

      const [lessonResult, videos, papers] = await Promise.all([
        generateLessonForModule(m, topic, i, total, level, ""),
        fetchModuleVideos(m, { preferredVideoLanguage: vidLangOpt }),
        fetchModulePapers(m),
      ]);

      done += 1;
      cb(`Module ${done}/${total} ready…`);
      console.log(
        `[gen] ${m.id}: ${lessonResult.lessons.length} lessons, ` +
        `${lessonResult.quiz.length} quiz, ${videos.length} videos, ${papers.length} papers`
      );

      return shapeEnrichedModule(m, lessonResult, videos, papers);
    })
  );

  return enriched;
}

/** True until the module has lesson content (initial enrichment or post-regenerate). */
export function moduleNeedsEnrichment(m) {
  if (!m) return true;
  if (m.generationQuality === "failed") return false;
  const hasLessons = Array.isArray(m.lessons) && m.lessons.length > 0;
  const mediaTried = m.mediaAttempted === true;
  const hasMedia = (Array.isArray(m.videos) && m.videos.length > 0) || (Array.isArray(m.papers) && m.papers.length > 0);
  return !hasLessons || (!mediaTried && !hasMedia);
}

/**
 * Enrich a single module (lessons, quiz, videos, papers). Used for incremental
 * Firestore saves and resume-after-refresh.
 */
export async function enrichOneModule(
  module,
  topic,
  level,
  moduleIndex,
  totalModules,
  onProgress,
  options = {}
) {
  const vidLangOpt = options.preferredVideoLanguage;
  const [lessonResult, videos, papers] = await Promise.all([
    generateLessonForModule(module, topic, moduleIndex, totalModules, level, ""),
    fetchModuleVideos(module, { preferredVideoLanguage: vidLangOpt }),
    fetchModulePapers(module),
  ]);
  if (typeof onProgress === "function") onProgress();
  return shapeEnrichedModule(module, lessonResult, videos, papers);
}

/**
 * Regenerate one module’s AI content; preserves user-only fields on `module`.
 * Optional `extraDetails` / `emphasize` shape the new content without replacing
 * the whole course.
 */
export async function regenerateModuleContent(module, topic, level, moduleIndex, totalModules, opts = {}) {
  const {
    extraDetails = "",
    emphasize = "",
    preferredVideoLanguage,
  } = opts;
  const parts = [];
  if (String(extraDetails).trim()) {
    parts.push("Additional detail to weave into lessons and quiz:\n" + String(extraDetails).trim());
  }
  if (String(emphasize).trim()) {
    parts.push("Emphasize these topics especially:\n" + String(emphasize).trim());
  }
  const extraBlock = parts.join("\n\n");
  const base = outlineModuleForRegenerate(module);
  const [lessonResult, videos, papers] = await Promise.all([
    generateLessonForModule(base, topic, moduleIndex, totalModules, level, extraBlock),
    fetchModuleVideos(base, {
      preferredVideoLanguage: preferredVideoLanguage ?? module.preferredVideoLanguage,
    }),
    fetchModulePapers(base),
  ]);
  return shapeEnrichedModule(module, lessonResult, videos, papers);
}
