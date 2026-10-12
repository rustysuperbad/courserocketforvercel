import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNetworkingCatalog, stripNetworkingPrefix, toGraphConcept, withNetworkingPrefix } from "./catalog";
import { weakestPrerequisite } from "./diagnostic";
import { applyAnswer, type Mastery } from "./learning";
import { scheduleReview, type ReviewRating } from "./reviews";

export const quizAttemptSchema = z.object({
  moduleId: z.string().uuid(),
  itemKey: z.string().trim().min(1).max(80),
  selectedAnswer: z.string().trim().min(1).max(300),
  responseKey: z.string().trim().min(8).max(128),
}).strict();

export const reviewGradeSchema = z.object({
  conceptSlug: z.string().trim().min(1).max(160),
  rating: z.enum(["again", "hard", "good", "easy"]),
}).strict();

export function answersMatch(correct: string, selected: string): boolean {
  return correct.trim().toLocaleLowerCase() === selected.trim().toLocaleLowerCase();
}

export function quizRating(isCorrect: boolean): ReviewRating {
  return isCorrect ? "good" : "again";
}

export function remediationTargetId(failedConceptId: string, concepts: { id: string; prerequisiteIds: string[] }[], mastery: Record<string, Mastery | undefined>): string {
  return weakestPrerequisite(concepts, failedConceptId, mastery) ?? failedConceptId;
}

export function scoreNetworkingProject(writeup: string): { score: number; passed: string[]; missed: string[]; feedback: string } {
  const text = writeup.toLowerCase();
  const checks = [
    { id: "dns", label: "DNS name resolution", pass: /dns|domain name|resolver/.test(text) },
    { id: "tcp", label: "TCP connection or handshake", pass: /tcp|handshake|three-way/.test(text) },
    { id: "tls", label: "TLS or HTTPS", pass: /tls|https|certificate/.test(text) },
    { id: "gateway", label: "Default gateway or router", pass: /gateway|router/.test(text) },
    { id: "http", label: "HTTP request/response", pass: /http(?!s)|request line|get \//.test(text) || /http request/.test(text) },
  ];
  const passed = checks.filter((item) => item.pass).map((item) => item.label);
  const missed = checks.filter((item) => !item.pass).map((item) => item.label);
  const score = passed.length / checks.length;
  const feedback = score >= 0.8
    ? "The writeup covers the main hops of a web request. Compare it with the verified lesson citations if you want more precision."
    : `Cover the missing pieces next: ${missed.join("; ")}.`;
  return { score, passed, missed, feedback };
}

export async function submitQuizAttempt(supabase: SupabaseClient, uid: string, input: z.infer<typeof quizAttemptSchema>) {
  const { data: item, error } = await supabase.from("quiz_items")
    .select("id, module_id, item_key, correct_answer, concept_id, verified, question")
    .eq("module_id", input.moduleId).eq("item_key", input.itemKey).maybeSingle();
  if (error || !item) throw new Error("unknown_quiz");
  const isCorrect = answersMatch(String(item.correct_answer), input.selectedAnswer);
  const { error: attemptError } = await supabase.from("quiz_attempts").insert({
    firebase_uid: uid, quiz_item_id: item.id, response_key: input.responseKey, is_correct: isCorrect,
  });
  if (attemptError?.code === "23505") {
    const { data: existing } = await supabase.from("quiz_attempts").select("is_correct").eq("firebase_uid", uid).eq("response_key", input.responseKey).maybeSingle();
    return { isCorrect: Boolean(existing?.is_correct), duplicate: true, pKnown: null, remediationInserted: false, verifiedKey: item.verified };
  }
  if (attemptError) throw new Error("Could not save the quiz attempt.");

  let pKnown: number | null = null;
  let remediationInserted = false;
  let reviewDueAt: string | null = null;
  if (item.concept_id) {
    const { data: masteryRow } = await supabase.from("learner_mastery").select("p_known, attempts, correct_attempts").eq("firebase_uid", uid).eq("concept_id", item.concept_id).maybeSingle();
    const next = applyAnswer(masteryRow ? { pKnown: Number(masteryRow.p_known), attempts: masteryRow.attempts, correctAttempts: masteryRow.correct_attempts } : undefined, isCorrect);
    pKnown = next.pKnown;
    await supabase.from("learner_mastery").upsert({
      firebase_uid: uid, concept_id: item.concept_id, p_known: next.pKnown, attempts: next.attempts, correct_attempts: next.correctAttempts, updated_at: new Date().toISOString(),
    }, { onConflict: "firebase_uid,concept_id" });
    const { data: card } = await supabase.from("review_cards").select("id, fsrs_state").eq("firebase_uid", uid).eq("concept_id", item.concept_id).maybeSingle();
    const scheduled = await scheduleReview(card?.fsrs_state, quizRating(isCorrect));
    reviewDueAt = scheduled.dueAt;
    await supabase.from("review_cards").upsert({
      firebase_uid: uid, concept_id: item.concept_id, fsrs_state: scheduled.card, due_at: scheduled.dueAt, last_reviewed_at: new Date().toISOString(),
    }, { onConflict: "firebase_uid,concept_id" });
    if (!isCorrect) {
      remediationInserted = await insertRemediation(supabase, uid, item.module_id, item.concept_id, next);
    }
  }
  return { isCorrect, duplicate: false, pKnown, remediationInserted, reviewDueAt, verifiedKey: item.verified };
}

async function insertRemediation(supabase: SupabaseClient, uid: string, moduleId: string, failedConceptId: string, mastery: Mastery): Promise<boolean> {
  const { data: module } = await supabase.from("modules").select("id, course_id").eq("id", moduleId).maybeSingle();
  if (!module) return false;
  const { data: course } = await supabase.from("courses").select("id, firebase_uid").eq("id", module.course_id).eq("firebase_uid", uid).maybeSingle();
  if (!course) return false;
  const catalog = await loadNetworkingCatalog();
  const { data: failed } = await supabase.from("concepts").select("id, slug, title").eq("id", failedConceptId).maybeSingle();
  if (!failed) return false;
  const failedCatalogId = stripNetworkingPrefix(failed.slug);
  const graph = catalog.map(toGraphConcept);
  const masteryMap: Record<string, Mastery> = { [failedCatalogId]: mastery };
  const targetCatalogId = remediationTargetId(failedCatalogId, graph, masteryMap);
  const { data: target } = await supabase.from("concepts").select("id, slug, title, description").eq("slug", withNetworkingPrefix(targetCatalogId)).maybeSingle();
  if (!target) return false;
  const { data: existing } = await supabase.from("modules").select("id").eq("course_id", course.id).eq("remediation_for_concept", target.id).maybeSingle();
  if (existing) return false;
  const { data: last } = await supabase.from("modules").select("position").eq("course_id", course.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const position = (last?.position ?? 0) + 1;
  const { error } = await supabase.from("modules").insert({
    course_id: course.id, concept_id: target.id, position, remediation_for_concept: target.id,
    title: `Remedial: ${target.title}`,
    summary: `Inserted because a quiz on ${failed.title} suggested a gap in ${target.title}.`,
    body: { kind: "remediation", missingConceptSlug: target.slug, description: target.description, verificationIssues: ["Remedial module is a short pointer, not a newly verified lesson."] },
    content_status: "ai_generated",
  });
  return !error;
}

export async function listDueReviews(supabase: SupabaseClient, uid: string, now = new Date()) {
  const { data, error } = await supabase.from("review_cards")
    .select("id, concept_id, due_at, fsrs_state, last_reviewed_at")
    .eq("firebase_uid", uid).lte("due_at", now.toISOString()).order("due_at").limit(20);
  if (error) throw new Error("Could not load reviews.");
  const conceptIds = (data ?? []).map((row) => row.concept_id);
  const { data: concepts } = conceptIds.length
    ? await supabase.from("concepts").select("id, slug, title, description").in("id", conceptIds)
    : { data: [] };
  const catalog = await loadNetworkingCatalog();
  return (data ?? []).map((row) => {
    const concept = (concepts ?? []).find((item) => item.id === row.concept_id);
    const diagnostic = catalog.find((item) => withNetworkingPrefix(item.id) === concept?.slug)?.diagnostic;
    return {
      cardId: row.id,
      conceptSlug: concept?.slug ?? "",
      title: concept?.title ?? "Concept",
      description: concept?.description ?? "",
      dueAt: row.due_at,
      question: diagnostic ? { question: diagnostic.question, options: diagnostic.options, questionType: diagnostic.questionType } : null,
    };
  });
}

export async function gradeReviewCard(supabase: SupabaseClient, uid: string, input: z.infer<typeof reviewGradeSchema>) {
  const slug = withNetworkingPrefix(input.conceptSlug);
  const { data: concept } = await supabase.from("concepts").select("id").eq("slug", slug).maybeSingle();
  if (!concept) throw new Error("unknown_concept");
  const { data: card } = await supabase.from("review_cards").select("fsrs_state").eq("firebase_uid", uid).eq("concept_id", concept.id).maybeSingle();
  const scheduled = await scheduleReview(card?.fsrs_state, input.rating);
  await supabase.from("review_cards").upsert({
    firebase_uid: uid, concept_id: concept.id, fsrs_state: scheduled.card, due_at: scheduled.dueAt, last_reviewed_at: new Date().toISOString(),
  }, { onConflict: "firebase_uid,concept_id" });
  const isCorrect = input.rating === "good" || input.rating === "easy";
  const { data: masteryRow } = await supabase.from("learner_mastery").select("p_known, attempts, correct_attempts").eq("firebase_uid", uid).eq("concept_id", concept.id).maybeSingle();
  const next = applyAnswer(masteryRow ? { pKnown: Number(masteryRow.p_known), attempts: masteryRow.attempts, correctAttempts: masteryRow.correct_attempts } : undefined, isCorrect);
  await supabase.from("learner_mastery").upsert({
    firebase_uid: uid, concept_id: concept.id, p_known: next.pKnown, attempts: next.attempts, correct_attempts: next.correctAttempts, updated_at: new Date().toISOString(),
  }, { onConflict: "firebase_uid,concept_id" });
  return { dueAt: scheduled.dueAt, pKnown: next.pKnown };
}
