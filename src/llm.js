// LLM client (OpenRouter). Falls back gracefully when no key is configured —
// callers must handle null (heuristic path).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepseek/deepseek-chat";

export function llmAvailable() {
  return OPENROUTER_API_KEY.length > 0;
}

export async function callLLM(messages, maxTokens = 1200, jsonMode = false) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LLM error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// Parse JSON out of an LLM reply (handles ```json fences).
export function parseJsonLoose(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const obj = candidate.match(/\{[\s\S]*\}/);
    if (obj) {
      try {
        return JSON.parse(obj[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
