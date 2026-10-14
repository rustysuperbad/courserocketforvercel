import { serve } from "inngest/edge";
import { inngest } from "./inngestClient";
import { processV3CourseGeneration } from "./pipeline/worker";

const handler = serve({
  client: inngest,
  functions: [processV3CourseGeneration],
  servePath: "/functions/v1/inngest",
});

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-inngest-signature, x-inngest-sdk, x-inngest-req-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

export async function inngestHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  const response = await handler(request);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
