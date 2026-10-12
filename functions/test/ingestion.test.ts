import assert from "node:assert/strict";
import test from "node:test";
import { licenseDecision, splitIntoChunks } from "../src/ingestion";

const wikiSource = { key: "wiki", title: "Wiki", publisher: "Wikipedia", url: "https://en.wikipedia.org/wiki/Network", license: "CC BY-SA 4.0", attribution: "Wikipedia contributors", authorityScore: 0.7, level: 2, commercialAllowed: true, sourceKind: "wikipedia" as const, shareAlike: true };

test("source ingestion fails closed for non-commercial and unreviewed sources", () => {
  assert.deepEqual(licenseDecision(wikiSource, { approveShareAlike: false, allowNonCommercial: false }), { ingest: false, status: "review_required" });
  assert.deepEqual(licenseDecision({ ...wikiSource, commercialAllowed: false, license: "CC BY-NC-SA" }, { approveShareAlike: true, allowNonCommercial: false }), { ingest: false, status: "blocked" });
  assert.deepEqual(licenseDecision({ ...wikiSource, commercialAllowed: false }, { approveShareAlike: true, allowNonCommercial: true }), { ingest: true, status: "approved" });
  assert.deepEqual(licenseDecision(wikiSource, { approveShareAlike: true, allowNonCommercial: false }), { ingest: true, status: "approved" });
});

test("chunking preserves source text with bounded overlapping chunks", () => {
  const text = `${"A networking paragraph explains packet forwarding and IP addressing in useful detail. ".repeat(35)}\n\n${"A second paragraph describes routers and local links. ".repeat(10)}`;
  const chunks = splitIntoChunks(text, 400, 40);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 400));
  assert.ok(chunks.join(" ").includes("packet forwarding"));
});
