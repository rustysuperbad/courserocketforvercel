"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const supabase_js_1 = require("@supabase/supabase-js");
const learning_1 = require("./learning");
async function seedNetworkingConcepts() {
    const currentDir = __dirname;
    const raw = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.join(currentDir, "../data/networking-concepts.json"), "utf8"));
    const concepts = (0, learning_1.validateConceptDag)(raw);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key)
        throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    const supabase = (0, supabase_js_1.createClient)(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rows = concepts.map((concept, index) => ({
        slug: `networking-${concept.id}`, domain: "networking", title: concept.title,
        description: `Beginner networking concept: ${concept.title}.`, level: index < 5 ? 1 : index < 13 ? 2 : 3,
        estimated_minutes: concept.estimatedMinutes, objectives: [concept.title],
    }));
    const { data, error } = await supabase.from("concepts").upsert(rows, { onConflict: "slug" }).select("id, slug");
    if (error || !data)
        throw new Error("Could not upsert networking concepts.");
    const ids = new Map(data.map((row) => [row.slug.replace("networking-", ""), row.id]));
    const { error: clearError } = await supabase.from("concept_prereqs").delete().in("concept_id", [...ids.values()]);
    if (clearError)
        throw new Error("Could not clear existing networking prerequisite edges.");
    const edges = concepts.flatMap((concept) => concept.prerequisiteIds.map((prerequisiteId) => ({ concept_id: ids.get(concept.id), prerequisite_id: ids.get(prerequisiteId) })));
    if (edges.length) {
        const { error: edgeError } = await supabase.from("concept_prereqs").insert(edges);
        if (edgeError)
            throw new Error("Could not insert networking prerequisite edges.");
    }
    console.info(`Seeded ${concepts.length} networking concepts and ${edges.length} prerequisite links.`);
}
if (process.argv[1] && node_path_1.default.resolve(process.argv[1]) === __filename) {
    seedNetworkingConcepts().catch((error) => {
        console.error("Networking graph seed failed.", error instanceof Error ? error.message : "Unknown error");
        process.exitCode = 1;
    });
}
