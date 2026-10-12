import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLearningPath } from "./learning";
import { generateVerifiedLesson, type EvidenceChunk, type LessonProvider, type VerifiedLessonResult } from "./verifiedLesson";
import { checkUrls, type LinkStatus } from "./linkCheck";
import { dedupeResources, scoreResource, type ResourceItem, type ScoredResource } from "./resources";

export type GenerationRun = {
  id: string;
  firebase_uid: string;
  goal: string;
  domain: "general" | "networking";
  target_concept_slug: string | null;
  course_id: string | null;
};

export type CourseConcept = { id: string; slug: string; title: string; estimated_minutes: number; level: number };
export type JobStep = { conceptId: string; title: string; action: "learn" | "shorten" | "skip"; pKnown: number; estimatedMinutes: number };

export type PipelineStepRunner = {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>;
};

export type UsageTotals = { inputTokens: number; outputTokens: number; costUsd: number };

export type ModuleBuildResult = {
  status: "skipped" | "evidence-missing" | "ai_generated" | "ai_verified" | "cached";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lesson?: VerifiedLessonResult;
  cacheHit?: boolean;
};

export function evidenceHash(chunks: EvidenceChunk[]): string {
  const key = chunks.map((chunk) => chunk.id).sort().join("|");
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function analogyContextFrom(profile: { known_topics?: string[] | null; interests?: string[] | null } | null, masteredTitles: string): string {
  const known = (profile?.known_topics ?? []).filter(Boolean).slice(0, 8).join(", ");
  const interests = (profile?.interests ?? []).filter(Boolean).slice(0, 8).join(", ");
  return [`Known topics: ${known || "none stated"}.`, `Interests: ${interests || "none stated"}.`, masteredTitles ? `Already comfortable with: ${masteredTitles}.` : "", "Use these only as analogies; every factual claim must still come from the source passages."]
    .filter(Boolean).join(" ");
}

export function inferNetworkingTarget(goal: string, concepts: CourseConcept[], requestedSlug: string | null): CourseConcept {
  const normalize = (value: string) => value.toLowerCase().replace(/^networking-/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const requested = requestedSlug
    ? concepts.find((concept) => concept.slug === (requestedSlug.startsWith("networking-") ? requestedSlug : `networking-${requestedSlug}`))
    : undefined;
  if (requested) return requested;
  const words = new Set(normalize(goal).split(" ").filter((word) => word.length > 3));
  const ranked = concepts.map((concept) => ({
    concept,
    matches: normalize(`${concept.slug} ${concept.title}`).split(" ").filter((word) => words.has(word)).length,
  })).sort((left, right) => right.matches - left.matches);
  return ranked[0]?.matches ? ranked[0].concept : concepts.find((concept) => concept.slug === "networking-network-purpose") ?? concepts[0]!;
}

export type RetrieveFn = (query: string, options: { targetLevel?: number; conceptSlug?: string; ownerUid?: string }) => Promise<{ chunks: EvidenceChunk[]; inputTokens: number; costUsd: number }>;
export type ResourceFinderFn = (query: string, targetLevel: number) => Promise<ResourceItem[]>;
export type LessonWriterFn = (input: { goal: string; targetLevel: string; analogyContext?: string; chunks: EvidenceChunk[] }) => Promise<{ lesson: VerifiedLessonResult; usage: UsageTotals }>;

export async function buildVerifiedModule(args: {
  step: JobStep;
  concept?: CourseConcept;
  goal: string;
  domain: string;
  ownerUid: string;
  analogyContext: string;
  retrieve: RetrieveFn;
  writeLesson: LessonWriterFn;
  findResources?: ResourceFinderFn;
  lookupCache?: (conceptId: string, hash: string) => Promise<VerifiedLessonResult | null>;
  storeCache?: (conceptId: string, hash: string, lesson: VerifiedLessonResult) => Promise<void>;
  checkLinks?: (urls: string[]) => Promise<Record<string, Exclude<LinkStatus, "unchecked">>>;
}): Promise<ModuleBuildResult & { sources: EvidenceChunk[]; resources: ScoredResource[]; linkStatus: Record<string, string> }> {
  if (args.step.action === "skip") {
    return { status: "skipped", inputTokens: 0, outputTokens: 0, costUsd: 0, sources: [], resources: [], linkStatus: {} };
  }
  const query = args.domain === "networking" ? `${args.step.title} ${args.goal}` : args.goal;
  const evidence = await args.retrieve(query, { targetLevel: args.concept?.level ?? 1, conceptSlug: args.concept?.slug, ownerUid: args.ownerUid });
  if (!evidence.chunks.length) {
    const emptyLesson = await generateVerifiedLesson({ goal: args.step.title, targetLevel: "beginner", chunks: [] }, { generate: async () => ({}), critique: async () => ({}) });
    return { status: "evidence-missing", inputTokens: evidence.inputTokens, outputTokens: 0, costUsd: evidence.costUsd, lesson: emptyLesson, sources: [], resources: [], linkStatus: {} };
  }
  const hash = evidenceHash(evidence.chunks);
  if (args.concept?.id && args.lookupCache) {
    const cached = await args.lookupCache(args.concept.id, hash);
    if (cached) {
      return { status: "cached", inputTokens: evidence.inputTokens, outputTokens: 0, costUsd: evidence.costUsd, lesson: cached, cacheHit: true, sources: evidence.chunks, resources: [], linkStatus: {} };
    }
  }
  const written = await args.writeLesson({
    goal: `${args.step.title}. Course goal: ${args.goal}. Every quiz conceptSlug must be '${args.concept?.slug ?? "general-topic"}'.`,
    targetLevel: args.concept && args.concept.level >= 3 ? "intermediate" : "beginner",
    analogyContext: args.analogyContext,
    chunks: evidence.chunks,
  });
  if (written.lesson.contentStatus === "ai_verified" && args.concept?.id && args.storeCache) {
    await args.storeCache(args.concept.id, hash, written.lesson);
  }
  const rawResources = args.findResources ? await args.findResources(query, args.concept?.level ?? 1) : [];
  const resources = dedupeResources(rawResources.map((item) => scoreResource(item, query, args.concept?.level ?? 1)));
  const urls = [...new Set([...evidence.chunks.map((chunk) => chunk.url), ...resources.map((item) => item.url)])];
  const linkStatus = args.checkLinks ? await args.checkLinks(urls) : {};
  return {
    status: written.lesson.contentStatus,
    inputTokens: evidence.inputTokens + written.usage.inputTokens,
    outputTokens: written.usage.outputTokens,
    costUsd: evidence.costUsd + written.usage.costUsd,
    lesson: written.lesson,
    sources: evidence.chunks,
    resources,
    linkStatus,
  };
}

export async function loadCoursePath(supabase: SupabaseClient, run: GenerationRun): Promise<{ steps: JobStep[]; conceptById: Map<string, CourseConcept>; totalMinutes: number }> {
  if (run.domain !== "networking") {
    return { steps: [{ conceptId: "general-topic", title: run.goal, action: "learn", pKnown: 0.1, estimatedMinutes: 30 }], conceptById: new Map(), totalMinutes: 30 };
  }
  const { data: concepts, error: conceptError } = await supabase.from("concepts").select("id,slug,title,estimated_minutes,level").eq("domain", "networking");
  if (conceptError || !concepts?.length) throw new Error("The networking concept graph has not been seeded.");
  const target = inferNetworkingTarget(run.goal, concepts, run.target_concept_slug);
  const conceptIds = concepts.map((concept) => concept.id);
  const [{ data: edges, error: edgeError }, { data: masteryRows, error: masteryError }] = await Promise.all([
    supabase.from("concept_prereqs").select("concept_id,prerequisite_id").in("concept_id", conceptIds),
    supabase.from("learner_mastery").select("concept_id,p_known").eq("firebase_uid", run.firebase_uid).in("concept_id", conceptIds),
  ]);
  if (edgeError || masteryError) throw new Error("Could not load learner prerequisite data.");
  const suffix = (slug: string) => slug.replace(/^networking-/, "");
  const graph = concepts.map((concept) => ({
    id: suffix(concept.slug), title: concept.title, estimatedMinutes: concept.estimated_minutes,
    prerequisiteIds: (edges ?? []).filter((edge) => edge.concept_id === concept.id).map((edge) => suffix(concepts.find((candidate) => candidate.id === edge.prerequisite_id)?.slug ?? "")),
  }));
  const mastery = Object.fromEntries((masteryRows ?? []).map((row) => [suffix(concepts.find((concept) => concept.id === row.concept_id)?.slug ?? ""), { pKnown: row.p_known }]));
  const steps = buildLearningPath(graph, suffix(target.slug), mastery);
  const conceptById = new Map(concepts.map((concept) => [suffix(concept.slug), concept]));
  return { steps, conceptById, totalMinutes: steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) };
}

export async function persistLessonModule(supabase: SupabaseClient, args: {
  courseId: string; position: number; step: JobStep; concept?: CourseConcept; lesson: VerifiedLessonResult; sources: EvidenceChunk[]; resources?: ScoredResource[];
  linkStatus?: Record<string, string>;
}): Promise<string> {
  const { data: module, error: moduleError } = await supabase.from("modules").upsert({
    course_id: args.courseId,
    concept_id: args.concept?.id ?? null,
    position: args.position,
    title: args.lesson.title || args.step.title,
    summary: args.lesson.contentStatus === "ai_verified" ? `Verified lesson on ${args.step.title}.` : `Lesson draft on ${args.step.title}; evidence review is incomplete.`,
    body: {
      sections: args.lesson.sections,
      verificationIssues: args.lesson.verificationIssues,
      sources: args.sources.map((source, index) => ({
        id: source.id, citation: index + 1, title: source.title, url: source.url, license: source.license, attribution: source.attribution,
        linkStatus: args.linkStatus?.[source.url] ?? "unchecked",
      })),
      resources: args.resources ?? [],
    },
    content_status: args.lesson.contentStatus,
  }, { onConflict: "course_id,position" }).select("id").single();
  if (moduleError || !module) throw new Error("Could not save the generated module.");
  if (args.lesson.claims.length) {
    const { error } = await supabase.from("lesson_claims").upsert(args.lesson.claims.map((claim) => ({
      module_id: module.id, claim_key: claim.id, claim_text: claim.text, supporting_chunk_ids: claim.sourceChunkIds,
      verified: claim.verified, verification_status: claim.verificationStatus, verifier_model: "gemini-independent-review",
    })), { onConflict: "module_id,claim_key" });
    if (error) throw new Error("Could not save claim verification results.");
  }
  if (args.lesson.quizItems.length) {
    const { error } = await supabase.from("quiz_items").upsert(args.lesson.quizItems.map((item) => ({
      module_id: module.id, item_key: item.id, concept_id: args.concept?.id ?? null, question: item.question,
      options: item.options, correct_answer: item.correctAnswer, explanation: item.explanation,
      question_type: item.questionType, verified: item.verified, source_chunk_ids: item.sourceChunkIds,
    })), { onConflict: "module_id,item_key" });
    if (error) throw new Error("Could not save verified quiz items.");
  }
  return module.id;
}

export function createLessonWriter(provider: LessonProvider, usage: UsageTotals): LessonWriterFn {
  return async (input) => {
    const lesson = await generateVerifiedLesson(input, provider);
    return { lesson, usage: { ...usage } };
  };
}

export { checkUrls };
