import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadNetworkingCatalog, withNetworkingPrefix } from "./catalog";

async function seedNetworkingConcepts(): Promise<void> {
  const concepts = await loadNetworkingCatalog();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = concepts.map((concept) => ({
    slug: withNetworkingPrefix(concept.id),
    domain: "networking",
    title: concept.title,
    description: concept.description,
    level: concept.level,
    estimated_minutes: concept.estimatedMinutes,
    objectives: concept.objectives,
  }));
  const { data, error } = await supabase.from("concepts").upsert(rows, { onConflict: "slug" }).select("id, slug");
  if (error || !data) throw new Error("Could not upsert networking concepts.");
  const ids = new Map(data.map((row) => [row.slug.replace(/^networking-/, ""), row.id]));
  const { error: clearError } = await supabase.from("concept_prereqs").delete().in("concept_id", [...ids.values()]);
  if (clearError) throw new Error("Could not clear existing networking prerequisite edges.");
  const edges = concepts.flatMap((concept) => concept.prerequisiteIds.map((prerequisiteId) => ({
    concept_id: ids.get(concept.id),
    prerequisite_id: ids.get(prerequisiteId),
  })));
  if (edges.some((edge) => !edge.concept_id || !edge.prerequisite_id)) throw new Error("A prerequisite id was missing after upsert.");
  if (edges.length) {
    const { error: edgeError } = await supabase.from("concept_prereqs").insert(edges);
    if (edgeError) throw new Error("Could not insert networking prerequisite edges.");
  }
  console.info(`Seeded ${concepts.length} networking concepts and ${edges.length} prerequisite links.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  seedNetworkingConcepts().catch((error) => {
    console.error("Networking graph seed failed.", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  });
}
