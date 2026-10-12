import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INTEREST_SUGGESTIONS, loadNetworkingCatalog, publicConceptView, stripNetworkingPrefix, toGraphConcept, withNetworkingPrefix, type NetworkingConcept } from "./catalog";
import { applyDiagnosticResult, gradeDiagnosticChoice, nextDiagnosticConceptId } from "./diagnostic";
import { buildLearningPath, type Mastery } from "./learning";

export const learnerProfileSchema = z.object({
  goal: z.string().trim().min(1).max(500),
  targetConceptSlug: z.string().trim().min(1).max(160).default("packet-journey"),
  knownConceptSlugs: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  interests: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
}).strict();

export const diagnosticChoiceSchema = z.object({
  conceptSlug: z.string().trim().min(1).max(160),
  selectedAnswer: z.string().trim().min(1).max(300),
  targetConceptSlug: z.string().trim().min(1).max(160).optional(),
}).strict();

export type PublicQuestion = {
  conceptSlug: string;
  title: string;
  question: string;
  options: string[];
  questionType: "recall" | "explain" | "apply";
};

function catalogById(catalog: NetworkingConcept[]): Map<string, NetworkingConcept> {
  return new Map(catalog.map((concept) => [concept.id, concept]));
}

function askedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(stripNetworkingPrefix) : [];
}

export async function publicNetworkingCatalog() {
  const catalog = await loadNetworkingCatalog();
  return { concepts: catalog.map(publicConceptView), interestSuggestions: [...INTEREST_SUGGESTIONS] };
}

async function loadMasteryMap(supabase: SupabaseClient, uid: string, catalog: NetworkingConcept[]): Promise<Record<string, Mastery>> {
  const slugs = catalog.map((concept) => withNetworkingPrefix(concept.id));
  const { data, error } = await supabase.from("concepts").select("id, slug").in("slug", slugs);
  if (error) throw new Error("Could not load networking concepts.");
  const idToCatalogId = new Map((data ?? []).map((row) => [row.id, stripNetworkingPrefix(row.slug)]));
  const { data: masteryRows, error: masteryError } = await supabase.from("learner_mastery")
    .select("concept_id, p_known, attempts, correct_attempts").eq("firebase_uid", uid);
  if (masteryError) throw new Error("Could not load mastery.");
  const mastery: Record<string, Mastery> = {};
  for (const row of masteryRows ?? []) {
    const id = idToCatalogId.get(row.concept_id);
    if (id) mastery[id] = { pKnown: Number(row.p_known), attempts: row.attempts, correctAttempts: row.correct_attempts };
  }
  return mastery;
}

async function upsertMastery(supabase: SupabaseClient, uid: string, mastery: Record<string, Mastery>) {
  const catalogIds = Object.keys(mastery);
  if (!catalogIds.length) return;
  const slugs = catalogIds.map(withNetworkingPrefix);
  const { data, error } = await supabase.from("concepts").select("id, slug").in("slug", slugs);
  if (error || !data?.length) throw new Error("Could not match mastery rows to concepts. Seed the networking graph first.");
  const rows = data.map((row) => {
    const id = stripNetworkingPrefix(row.slug);
    const value = mastery[id];
    return {
      firebase_uid: uid,
      concept_id: row.id,
      p_known: value?.pKnown ?? 0.1,
      attempts: value?.attempts ?? 0,
      correct_attempts: value?.correctAttempts ?? 0,
    };
  });
  const { error: saveError } = await supabase.from("learner_mastery").upsert(rows, { onConflict: "firebase_uid,concept_id" });
  if (saveError) throw new Error("Could not save concept mastery.");
}

function questionFor(concept: NetworkingConcept): PublicQuestion {
  return {
    conceptSlug: withNetworkingPrefix(concept.id),
    title: concept.title,
    question: concept.diagnostic.question,
    options: concept.diagnostic.options,
    questionType: concept.diagnostic.questionType,
  };
}

export async function saveLearnerOnboarding(
  supabase: SupabaseClient,
  uid: string,
  input: z.infer<typeof learnerProfileSchema>,
) {
  const catalog = await loadNetworkingCatalog();
  const targetId = stripNetworkingPrefix(withNetworkingPrefix(input.targetConceptSlug));
  if (!catalog.some((concept) => concept.id === targetId)) throw new Error("unknown_target");
  const knownIds = [...new Set(input.knownConceptSlugs.map((slug) => stripNetworkingPrefix(withNetworkingPrefix(slug))))]
    .filter((id) => catalog.some((concept) => concept.id === id));
  const { error } = await supabase.from("learner_profiles").upsert({
    firebase_uid: uid,
    goal: input.goal,
    domain: "networking",
    target_concept_slug: withNetworkingPrefix(targetId),
    known_topics: knownIds,
    interests: [...new Set(input.interests.map((item) => item.trim()).filter(Boolean))],
    diagnostic_asked_slugs: [],
    diagnostic_completed_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "firebase_uid" });
  if (error) throw new Error("Could not save your learning profile.");
  const mastery: Record<string, Mastery> = {};
  for (const id of knownIds) mastery[id] = { pKnown: 0.7, attempts: 0, correctAttempts: 0 };
  await upsertMastery(supabase, uid, mastery);
  return { savedKnown: knownIds.length, targetConceptSlug: withNetworkingPrefix(targetId) };
}

export async function nextDiagnosticQuestion(supabase: SupabaseClient, uid: string, targetConceptSlug?: string) {
  const catalog = await loadNetworkingCatalog();
  const graph = catalog.map(toGraphConcept);
  const { data: profile, error } = await supabase.from("learner_profiles").select("target_concept_slug, diagnostic_asked_slugs, diagnostic_completed_at").eq("firebase_uid", uid).maybeSingle();
  if (error) throw new Error("Could not load your diagnostic progress.");
  const targetId = stripNetworkingPrefix(withNetworkingPrefix(targetConceptSlug || profile?.target_concept_slug || "packet-journey"));
  if (!catalog.some((concept) => concept.id === targetId)) throw new Error("unknown_target");
  const asked = new Set(askedIds(profile?.diagnostic_asked_slugs));
  const mastery = await loadMasteryMap(supabase, uid, catalog);
  const nextId = nextDiagnosticConceptId(graph, targetId, mastery, asked);
  if (!nextId) {
    if (!profile?.diagnostic_completed_at) {
      await supabase.from("learner_profiles").upsert({
        firebase_uid: uid, domain: "networking", target_concept_slug: withNetworkingPrefix(targetId),
        diagnostic_asked_slugs: [...asked].map(withNetworkingPrefix), diagnostic_completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: "firebase_uid" });
    }
    const steps = buildLearningPath(graph, targetId, mastery);
    return { done: true as const, askedCount: asked.size, question: null, steps, totalEstimatedMinutes: steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) };
  }
  const concept = catalogById(catalog).get(nextId);
  if (!concept) throw new Error("unknown_target");
  return { done: false as const, askedCount: asked.size, question: questionFor(concept), steps: null, totalEstimatedMinutes: null };
}

export async function submitDiagnosticChoice(supabase: SupabaseClient, uid: string, input: z.infer<typeof diagnosticChoiceSchema>) {
  const catalog = await loadNetworkingCatalog();
  const graph = catalog.map(toGraphConcept);
  const conceptId = stripNetworkingPrefix(withNetworkingPrefix(input.conceptSlug));
  const concept = catalogById(catalog).get(conceptId);
  if (!concept) throw new Error("unknown_concept");
  const isCorrect = gradeDiagnosticChoice(concept, input.selectedAnswer);
  const { data: profile, error } = await supabase.from("learner_profiles").select("target_concept_slug, diagnostic_asked_slugs").eq("firebase_uid", uid).maybeSingle();
  if (error) throw new Error("Could not load your diagnostic progress.");
  const targetId = stripNetworkingPrefix(withNetworkingPrefix(input.targetConceptSlug || profile?.target_concept_slug || "packet-journey"));
  const mastery = await loadMasteryMap(supabase, uid, catalog);
  const asked = askedIds(profile?.diagnostic_asked_slugs);
  const update = applyDiagnosticResult(graph, conceptId, isCorrect, mastery, asked);
  await upsertMastery(supabase, uid, update.mastery);
  const askedSlugs = update.asked.map(withNetworkingPrefix);
  const nextId = nextDiagnosticConceptId(graph, targetId, update.mastery, new Set(update.asked), update.preferNextId);
  const done = !nextId;
  const { error: profileError } = await supabase.from("learner_profiles").upsert({
    firebase_uid: uid,
    domain: "networking",
    target_concept_slug: withNetworkingPrefix(targetId),
    diagnostic_asked_slugs: askedSlugs,
    diagnostic_completed_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "firebase_uid" });
  if (profileError) throw new Error("Could not save diagnostic progress.");
  const nextConcept = nextId ? catalogById(catalog).get(nextId) : undefined;
  const steps = done ? buildLearningPath(graph, targetId, update.mastery) : null;
  return {
    isCorrect,
    explanation: concept.diagnostic.explanation,
    pKnown: update.mastery[conceptId]?.pKnown ?? 0.1,
    done,
    askedCount: update.asked.length,
    question: nextConcept ? questionFor(nextConcept) : null,
    steps,
    totalEstimatedMinutes: steps ? steps.reduce((sum, step) => sum + step.estimatedMinutes, 0) : null,
  };
}

export async function loadPathForUser(supabase: SupabaseClient, uid: string, targetConceptSlug: string) {
  const catalog = await loadNetworkingCatalog();
  const graph = catalog.map(toGraphConcept);
  const targetId = stripNetworkingPrefix(withNetworkingPrefix(targetConceptSlug));
  if (!catalog.some((concept) => concept.id === targetId)) throw new Error("unknown_target");
  const mastery = await loadMasteryMap(supabase, uid, catalog);
  const { data: profile } = await supabase.from("learner_profiles").select("interests, goal, known_topics").eq("firebase_uid", uid).maybeSingle();
  const steps = buildLearningPath(graph, targetId, mastery);
  return {
    targetConceptSlug: withNetworkingPrefix(targetId),
    steps,
    totalEstimatedMinutes: steps.reduce((sum, step) => sum + step.estimatedMinutes, 0),
    interests: profile?.interests ?? [],
    goal: profile?.goal ?? "",
    contentStatus: "ai_generated" as const,
  };
}
