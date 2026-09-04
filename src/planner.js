// Agent planner: LLM-driven query generation and crawl-domain proposal.
// Phase-1 of the V2 workflow (intake -> plan -> preliminary search -> proposal).
// Falls back to a heuristic planner when no LLM key is configured.
import { callLLM, parseJsonLoose, llmAvailable } from "./llm.js";
import { webSearch } from "./websearch.js";
import { searchIndex } from "./indexStore.js";
import { fetchWithTimeout } from "./http.js";

const SYSTEM_PROMPT = `You are the planner for a civic-engagement research assistant used by Hong Kong university students (GCAP3056). Given a research brief, produce a web-search plan. Prefer official sources (.gov.hk, legco.gov.hk, data.gov.hk), then major HK media (SCMP, RTHK, HK01, Ming Pao), then academic sources. Include Chinese-language queries for HK topics. Reply with JSON only.`;

// Stage 2: generate search queries per research question.
export async function generateQueries(intake) {
  if (!llmAvailable()) return heuristicQueries(intake);
  try {
    const user = `Research brief:
Topic: ${intake.topic}
Documents needed: ${intake.documentsNeeded || "(not specified)"}
Research questions: ${(intake.researchQuestions || []).join(" | ")}
Scope: ${intake.scope || "(not specified)"}

Generate 8-14 web search queries. Include both English and Traditional Chinese queries where relevant. Reply as JSON: {"queries": ["...", "..."]}`;
    const raw = await callLLM(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      800,
      true
    );
    const parsed = parseJsonLoose(raw);
    const queries = (parsed?.queries || []).filter((q) => typeof q === "string" && q.length > 2);
    return queries.length ? queries.slice(0, 14) : heuristicQueries(intake);
  } catch (e) {
    console.log("[planner] query generation fallback:", String(e.message).slice(0, 120));
    return heuristicQueries(intake);
  }
}

function heuristicQueries(intake) {
  const topic = intake.topic || "";
  const rqs = intake.researchQuestions || [];
  const queries = [topic, `${topic} 香港`, `${topic} site:gov.hk`, `${topic} site:legco.gov.hk`];
  for (const rq of rqs.slice(0, 4)) queries.push(rq);
  return [...new Set(queries)].slice(0, 12);
}

// Stage 3: run the queries (web search + data.gov.hk CKAN as first-class tool).
export async function runSearches(queries, maxPerQuery = 6) {
  const searchSets = await Promise.allSettled(
    queries.map((q) => webSearch(q, maxPerQuery))
  );
  const searches = [];
  for (let i = 0; i < queries.length; i++) {
    const s = searchSets[i];
    searches.push({
      query: queries[i],
      ok: s.status === "fulfilled" && !s.value.error,
      results: s.status === "fulfilled" ? s.value.results : [],
      error: s.status === "rejected" ? String(s.value) : s.value?.error || null,
    });
  }

  // data.gov.hk CKAN as a first-class tool: query the local index + the portal API
  const ckanHits = await searchCkan(queries.join(" "), 8);

  return { searches, ckanHits };
}

async function searchCkan(topic, limit) {
  // local index first (fast, already built), then portal API for freshness
  let local = [];
  try {
    const { results } = await searchIndex(topic, limit);
    local = results.filter((r) => r.source === "data.gov.hk");
  } catch {
    /* index unavailable */
  }
  let portal = [];
  try {
    const res = await fetchWithTimeout(
      `https://data.gov.hk/en-data/api/3/action/package_search?q=${encodeURIComponent(topic)}&rows=${limit}`,
      15000
    );
    const j = await res.json();
    if (j?.success) {
      portal = (j.result.results || []).map((p) => ({
        source: "data.gov.hk",
        kind: "dataset",
        title: p.title || p.name,
        url: `https://data.gov.hk/en-datasets/${p.organization?.name}/${p.name}`,
        org: p.organization?.title || "",
        description: (p.notes || "").slice(0, 300),
        formats: [...new Set((p.resources || []).map((x) => x.format).filter(Boolean))].join(", "),
      }));
    }
  } catch {
    /* portal unreachable */
  }
  const seen = new Set();
  return [...local, ...portal].filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

// Stage 4: propose crawl domains with rationale + expected artefacts.
// `feedback` (student revision request from the previous plan) is folded into
// the proposal prompt.
export async function proposeDomains(intake, searches, ckanHits) {
  const domainStats = {};
  for (const s of searches) {
    for (const r of s.results) {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        domainStats[host] = domainStats[host] || { hits: 0, sampleUrls: [], sampleTitles: [] };
        domainStats[host].hits++;
        if (domainStats[host].sampleUrls.length < 3) domainStats[host].sampleUrls.push(r.url);
        if (domainStats[host].sampleTitles.length < 3 && r.title) domainStats[host].sampleTitles.push(r.title);
      } catch {
        /* skip */
      }
    }
  }
  const domains = Object.entries(domainStats)
    .sort((a, b) => b[1].hits - a[1].hits)
    .slice(0, 12);

  if (!llmAvailable()) {
    return {
      llm: false,
      proposals: domains.map(([host, d]) => ({
        domain: host,
        rationale: `${d.hits} search hits`,
        artefacts: "web pages",
        sampleUrls: d.sampleUrls,
        suggestedCrawl: true,
      })),
      ckanHits,
    };
  }

  try {
    const evidence = searches
      .map((s) => `Q: ${s.query}\n` + s.results.map((r) => `- ${r.title} (${r.url})`).join("\n"))
      .join("\n\n")
      .slice(0, 9000);
    const ckanList = ckanHits.map((c) => `- [dataset] ${c.title} (${c.url})`).join("\n").slice(0, 2500);
    const feedbackLine = intake.feedback
      ? `\nThe student previously asked to revise the plan. Follow this feedback: "${intake.feedback}"`
      : "";
    const user = `Research brief:
Topic: ${intake.topic}
Documents needed: ${intake.documentsNeeded || "(not specified)"}
Research questions: ${(intake.researchQuestions || []).join(" | ")}
Scope: ${intake.scope || "(not specified)"}${feedbackLine}

Preliminary search evidence:
${evidence}

data.gov.hk datasets found:
${ckanList || "(none)"}

Propose 5-8 domains to crawl deeply. For each: why it is authoritative for this brief, what artefact types it likely holds, and 2-3 example URLs. Reply as JSON: {"proposals": [{"domain": "www.legco.gov.hk", "rationale": "...", "artefacts": "press releases, motions", "exampleUrls": ["..."], "suggestedCrawl": true}]}`;
    const raw = await callLLM(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      1500,
      true
    );
    const parsed = parseJsonLoose(raw);
    const proposals = (parsed?.proposals || []).filter((p) => p && p.domain);
    if (!proposals.length) throw new Error("empty proposals");
    return { llm: true, proposals: proposals.slice(0, 8), ckanHits };
  } catch (e) {
    console.log("[planner] domain proposal fallback:", String(e.message).slice(0, 120));
    return {
      llm: false,
      proposals: domains.slice(0, 6).map(([host, d]) => ({
        domain: host,
        rationale: `${d.hits} search hits`,
        artefacts: "web pages",
        sampleUrls: d.sampleUrls,
        suggestedCrawl: true,
      })),
      ckanHits,
    };
  }
}

// Full stage 2-4 chain used by POST /api/agent/plan (job-based; setStage reports progress)
export async function planFromIntake(intake, setStage = () => {}) {
  setStage("Generate queries (EN + 中文)");
  const queries = await generateQueries(intake);
  setStage("Run preliminary web searches");
  const { searches, ckanHits } = await runSearches(queries);
  setStage("Query data.gov.hk");
  setStage("Propose domains");
  const { proposals, llm } = await proposeDomains(intake, searches, ckanHits);
  return {
    intake,
    queries,
    searches: searches.map((s) => ({ query: s.query, ok: s.ok, n: s.results.length, error: s.error })),
    results: searches.flatMap((s) => s.results),
    ckanHits,
    proposals,
    llm,
    created_at: new Date().toISOString(),
  };
}
