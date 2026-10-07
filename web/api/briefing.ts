/**
 * POST /api/briefing  - natural-language underwriting briefing (Step 5).
 * The browser sends the engine's summary (synthetic portfolio, aggregated numbers only). Claude writes a short
 * briefing and must cite every figure with the JSON path it came from, so the browser can verify each number
 * against the engine before showing it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const Briefing = z.object({
  headline: z.string().describe("One sentence an underwriter reads first"),
  summary: z.string().describe("At most 90 words, plain English"),
  key_figures: z
    .array(
      z.object({
        label: z.string(),
        value: z.number().describe("Copied exactly from the summary JSON"),
        unit: z.enum(["KES", "buildings", "years", "percent", "metres"]),
        path: z.string().describe("JSON path of the value in the summary, e.g. keyLosses[3].loss"),
      }),
    )
    .describe("Every number used in the briefing"),
  risk_drivers: z.array(z.string()).describe("Up to 4 short points"),
  recommendations: z.array(z.string()).describe("Up to 4 actions for the underwriter"),
  caveats: z.array(z.string()).describe("Up to 3 honest limitations"),
});

const SYSTEM = `You write short flood-risk briefings for a reinsurance underwriter at Kenya Re.
- Use only numbers that appear in the summary JSON. Every number you mention must also appear in key_figures with its exact JSON path and the exact value.
- KES amounts: say "KES 181 million" style in prose; in key_figures copy the raw number.
- The portfolio is synthetic; say so once. Name the biggest uncertainty (the flood-defence onset assumption) in caveats.
- Be direct: what the loss is at key return periods, where it concentrates, what to do about it. No filler.`;

export async function POST(request: Request): Promise<Response> {
  let body: { summary?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!body.summary || typeof body.summary !== "object") return Response.json({ error: "Missing summary" }, { status: 400 });
  const summary = JSON.stringify(body.summary);
  if (summary.length > 20000) return Response.json({ error: "Summary too large" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI is not configured on this deployment (ANTHROPIC_API_KEY missing)" }, { status: 503 });

  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(Briefing) },
      messages: [{ role: "user", content: `Summary JSON from the Risk Forge engine:\n${summary}` }],
    });
    if (response.stop_reason === "refusal") return Response.json({ error: "The model declined to write this briefing." }, { status: 422 });
    if (!response.parsed_output) return Response.json({ error: "The briefing did not match the expected format; try again." }, { status: 502 });
    return Response.json({ briefing: response.parsed_output, model: response.model, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited - try again in a minute" }, { status: 429 });
    if (error instanceof Anthropic.AuthenticationError) return Response.json({ error: "The AI key on this deployment is invalid" }, { status: 503 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: `AI service error (${error.status})` }, { status: 502 });
    throw error;
  }
}
