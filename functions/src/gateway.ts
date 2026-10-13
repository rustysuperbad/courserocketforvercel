import { uidFromAuthHeader } from "./auth";
import { CALLABLES } from "./callables";
import { ApiError, httpStatusFor } from "./errors";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-callable-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handleApiRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: { status: "invalid-argument", message: "Use POST." } }, 405);
  }
  try {
    const uid = await uidFromAuthHeader(request.headers.get("authorization"));
    const body = await request.json().catch(() => ({})) as { name?: string; data?: unknown };
    const headerName = request.headers.get("x-callable-name")?.trim();
    const name = headerName || String(body.name || "").trim();
    const handler = CALLABLES[name];
    if (!handler) return json({ error: { status: "not-found", message: "Unknown action." } }, 404);
    const result = await handler(body.data, uid);
    return json({ result }, 200);
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: { status: error.code, message: error.message } }, httpStatusFor(error.code));
    }
    console.error("api:", error instanceof Error ? error.message : "unknown error");
    return json({ error: { status: "internal", message: "Something went wrong on our side. Please try again." } }, 500);
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
