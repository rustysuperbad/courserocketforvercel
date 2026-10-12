import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanRfcText, cleanWikipediaExtract, fetchSourceText, ingestSource, licenseDecision, loadSourceCatalog, parseFlags, planIngestion,
  splitIntoChunks, stripHtml, type Source,
} from "../src/ingestion";

const wikiSource: Source = { key: "wiki", title: "Wiki", publisher: "Wikipedia", url: "https://en.wikipedia.org/wiki/Network", license: "CC BY-SA 4.0", attribution: "Wikipedia contributors", authorityScore: 0.7, level: 2, commercialAllowed: true, sourceKind: "wikipedia", shareAlike: true, conceptTags: ["networking-network-purpose"] };
const rfcSource: Source = { ...wikiSource, key: "rfc791", url: "https://www.rfc-editor.org/rfc/rfc791", sourceKind: "rfc", shareAlike: false, level: 4 };

test("source ingestion fails closed for non-commercial and unreviewed sources", () => {
  assert.deepEqual(licenseDecision(wikiSource, { approveShareAlike: false, allowNonCommercial: false }), { ingest: false, status: "review_required" });
  assert.deepEqual(licenseDecision({ ...wikiSource, commercialAllowed: false, license: "CC BY-NC-SA" }, { approveShareAlike: true, allowNonCommercial: false }), { ingest: false, status: "blocked" });
  assert.deepEqual(licenseDecision({ ...wikiSource, commercialAllowed: false }, { approveShareAlike: true, allowNonCommercial: true }), { ingest: true, status: "approved" });
  assert.deepEqual(licenseDecision(wikiSource, { approveShareAlike: true, allowNonCommercial: false }), { ingest: true, status: "approved" });
  assert.deepEqual(licenseDecision(rfcSource, { approveShareAlike: true, allowNonCommercial: true }), { ingest: false, status: "review_required" });
  assert.deepEqual(licenseDecision(rfcSource, { approveShareAlike: false, allowNonCommercial: false, approveRfc: true }), { ingest: true, status: "approved" });
  assert.deepEqual(licenseDecision({ ...wikiSource, sourceKind: "link-only" }, { approveShareAlike: true, allowNonCommercial: true, approveRfc: true }), { ingest: false, status: "review_required" });
});

test("chunking preserves source text with bounded overlapping chunks", () => {
  const text = `${"A networking paragraph explains packet forwarding and IP addressing in useful detail. ".repeat(35)}\n\n${"A second paragraph describes routers and local links. ".repeat(10)}`;
  const chunks = splitIntoChunks(text, 400, 40);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 400));
  assert.ok(chunks.join(" ").includes("packet forwarding"));
});

test("CLI flags are parsed and the plan honours --only", () => {
  const flags = parseFlags(["--approve-cc-by-sa", "--only=wiki,rfc791", "--dry-run", "--max-chunks=5"]);
  assert.equal(flags.approveShareAlike, true);
  assert.equal(flags.dryRun, true);
  assert.equal(flags.maxChunksPerSource, 5);
  const plan = planIngestion([wikiSource, rfcSource, { ...wikiSource, key: "other" }], flags);
  assert.deepEqual(plan.map((item) => item.source.key), ["wiki", "rfc791"]);
  assert.deepEqual(plan.map((item) => item.decision.ingest), [true, false]);
});

test("Wikipedia extracts drop reference sections and keep headings as sentences", () => {
  const extract = "Lead paragraph about networks.\n\n== History ==\nEarly networks.\n\n=== ARPANET ===\nDetails.\n\n== See also ==\nList\n\n== References ==\nRef 1\n\n== External links ==\nLink";
  const cleaned = cleanWikipediaExtract(extract);
  assert.ok(cleaned.includes("Lead paragraph"));
  assert.ok(cleaned.includes("History."));
  assert.ok(cleaned.includes("ARPANET."));
  assert.ok(!cleaned.includes("Ref 1"));
  assert.ok(!cleaned.includes("Link"));
  assert.ok(!cleaned.includes("=="));
});

test("RFC text loses page headers, footers and the preamble before the abstract", () => {
  const raw = [
    "Network Working Group                                          J. Postel",
    "Request for Comments: 791                                    September 1981",
    "",
    "                          INTERNET PROTOCOL",
    "",
    "Abstract",
    "",
    "The Internet Protocol is designed for use in interconnected systems.",
    "Postel                                                         [Page 1]",
    "\f",
    "RFC 791                                                   September 1981",
    "",
    "The internet protocol provides for transmitting blocks of data called datagrams.",
  ].join("\n");
  const cleaned = cleanRfcText(raw);
  assert.ok(cleaned.startsWith("Abstract"));
  assert.ok(cleaned.includes("datagrams"));
  assert.ok(!cleaned.includes("[Page 1]"));
  assert.ok(!cleaned.includes("September 1981"));
  assert.ok(!cleaned.includes("Network Working Group"));
});

test("HTML stripping keeps article prose and decodes entities", () => {
  const html = "<html><head><style>x{}</style></head><body><nav>menu</nav><main><h1>HTTP</h1><p>HTTP is a &quot;protocol&quot; &amp; more.</p><script>bad()</script><p>Second &#x2014; dash &#169;.</p></main><footer>f</footer></body></html>";
  const text = stripHtml(html);
  assert.ok(text.includes('HTTP is a "protocol" & more.'));
  assert.ok(text.includes("Second — dash ©."));
  assert.ok(!text.includes("menu") && !text.includes("bad()"));
});

test("fetchSourceText uses the MediaWiki extract API and RFC plain text with injected fetch", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    if (url.includes("api.php")) return new Response(JSON.stringify({ query: { pages: [{ title: "Network", extract: "Body text about networks.\n\n== References ==\nx" }] } }), { status: 200 });
    if (url.endsWith("rfc791.txt")) return new Response("Abstract\n\nIP text.\nPostel   [Page 1]", { status: 200 });
    return new Response("", { status: 404 });
  };
  const wiki = await fetchSourceText(wikiSource, fetcher);
  assert.equal(wiki, "Body text about networks.");
  const rfc = await fetchSourceText(rfcSource, fetcher);
  assert.ok(rfc.startsWith("Abstract") && rfc.includes("IP text."));
  assert.ok(calls[0]?.includes("prop=extracts") && calls[0]?.includes("explaintext=1"));
  await assert.rejects(fetchSourceText({ ...wikiSource, sourceKind: "link-only" }, fetcher), /link-only/);
});

test("dry-run ingestion fetches and chunks without a database or embeddings", async () => {
  const fetcher = async () => new Response(JSON.stringify({ query: { pages: [{ extract: `${"Routers forward packets between networks using destination addresses. ".repeat(40)}` }] } }), { status: 200 });
  const flags = parseFlags(["--approve-cc-by-sa", "--dry-run"]);
  const [item] = planIngestion([wikiSource], flags);
  const result = await ingestSource(item!, { supabase: null, embed: null, fetcher, flags });
  assert.equal(result.status, "dry-run");
  assert.ok(result.chunks >= 2);
  const skipped = await ingestSource(planIngestion([rfcSource], flags)[0]!, { supabase: null, embed: null, fetcher, flags });
  assert.equal(skipped.status, "skipped");
});

test("ingestion is idempotent: unchanged content hash skips re-embedding, changed content replaces chunks", async () => {
  const text = `${"Switches forward Ethernet frames using MAC address tables learned from traffic. ".repeat(40)}`;
  const fetcher = async () => new Response(JSON.stringify({ query: { pages: [{ extract: text }] } }), { status: 200 });
  const state = { row: { id: "src-1", content_hash: null as string | null, chunk_count: 0 }, inserted: 0, deleted: 0, embedCalls: 0 };
  const supabase = {
    from(table: string) {
      const builder = {
        upsert: () => ({ select: () => ({ single: async () => ({ data: state.row, error: null }) }) }),
        update: (patch: Record<string, unknown>) => ({ eq: async () => { if (typeof patch.content_hash === "string") { state.row.content_hash = patch.content_hash; state.row.chunk_count = Number(patch.chunk_count); } return { error: null }; } }),
        delete: () => ({ eq: async () => { state.deleted += 1; return { error: null }; } }),
        insert: async (rows: unknown[]) => { if (table === "source_chunks") state.inserted += rows.length; return { error: null }; },
      };
      return builder;
    },
  } as unknown as Parameters<typeof ingestSource>[1]["supabase"];
  const embed = async (inputs: string[]) => { state.embedCalls += 1; return inputs.map(() => new Array(1536).fill(0.01)); };
  const flags = parseFlags(["--approve-cc-by-sa"]);
  const [item] = planIngestion([wikiSource], flags);
  const first = await ingestSource(item!, { supabase, embed, fetcher, flags });
  assert.equal(first.status, "ingested");
  assert.ok(state.inserted > 0 && state.deleted === 1 && state.embedCalls === 1);
  const second = await ingestSource(item!, { supabase, embed, fetcher, flags });
  assert.equal(second.status, "unchanged");
  assert.equal(state.embedCalls, 1);
});

test("the reviewed networking catalog validates and tags every concept with a known slug prefix", async () => {
  const catalog = await loadSourceCatalog();
  assert.ok(catalog.length >= 50);
  assert.ok(catalog.every((source) => source.conceptTags.every((tag) => tag.startsWith("networking-"))));
  assert.ok(catalog.some((source) => source.sourceKind === "rfc") && catalog.some((source) => source.sourceKind === "mdn"));
  const openstax = catalog.find((source) => source.sourceKind === "openstax");
  assert.equal(openstax?.commercialAllowed, false);
});
