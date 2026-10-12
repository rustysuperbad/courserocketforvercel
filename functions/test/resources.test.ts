import assert from "node:assert/strict";
import test from "node:test";
import { canonicalResourceUrl, dedupeResources, scoreResource } from "../src/resources";
import { checkUrl, checkUrls } from "../src/linkCheck";

test("resource scoring prefers overlapping beginner videos and drops duplicates", () => {
  const query = "subnet mask beginners";
  const strong = scoreResource({ kind: "youtube", id: "a", title: "Subnet masks for beginners", url: "https://youtu.be/aaa", snippet: "intro to subnet mask basics", channelOrAuthors: "School", extra: { viewCount: 50_000 } }, query, 1);
  const weak = scoreResource({ kind: "youtube", id: "b", title: "Advanced BGP research talk", url: "https://www.youtube.com/watch?v=bbb", snippet: "formal specification", channelOrAuthors: "Lab", extra: { viewCount: 12 } }, query, 1);
  assert.ok(strong.score > weak.score);
  const dupes = dedupeResources([
    strong,
    scoreResource({ kind: "youtube", id: "a2", title: "Same video", url: "https://www.youtube.com/watch?v=aaa", snippet: "", extra: {} }, query, 1),
    weak,
  ], 5);
  assert.equal(dupes.length, 2);
  assert.equal(canonicalResourceUrl("https://youtu.be/aaa"), "https://www.youtube.com/watch?v=aaa");
});

test("link checks classify ok, redirected, and broken URLs without following blindly", async () => {
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url.includes("ok")) return new Response(null, { status: 200 });
    if (url.includes("moved")) return new Response(null, { status: 301, headers: { location: "https://example.test/ok" } });
    if (url.includes("nohead") && init?.method === "HEAD") return new Response(null, { status: 405 });
    if (url.includes("nohead")) return new Response(null, { status: 200 });
    return new Response(null, { status: 404 });
  };
  assert.equal(await checkUrl("https://example.test/ok", fetcher), "ok");
  assert.equal(await checkUrl("https://example.test/moved", fetcher), "redirected");
  assert.equal(await checkUrl("https://example.test/missing", fetcher), "broken");
  assert.equal(await checkUrl("https://example.test/nohead", fetcher), "ok");
  assert.equal(await checkUrl("not-a-url", fetcher), "broken");
  const batch = await checkUrls(["https://example.test/ok", "https://example.test/missing"], fetcher);
  assert.equal(batch["https://example.test/ok"], "ok");
  assert.equal(batch["https://example.test/missing"], "broken");
});
