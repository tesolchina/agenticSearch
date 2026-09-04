// AgenticSearch — standalone web-search engine service.
//
// Endpoints:
//   GET  /healthz                 — liveness
//   POST /api/crawl               — { objective, sites[], maxPages, maxDepth, sameHostOnly, index }
//   POST /api/index/build         — index all data.gov.hk datasets (CKAN API)
//   GET  /api/index/search?q=&limit=
//
// Architecture (modular): src/http (fetch/politeness), src/robots, src/sitemap,
// src/extract (readability + heuristic), src/relevance, src/browser (playwright),
// src/crawler (BFS core), src/indexStore (Postgres index).
import express from "express";
import { crawlSite, deriveTitles } from "./src/crawler.js";
import { ensureIndexTable, buildFromDataGovHk, searchIndex, upsertPage } from "./src/indexStore.js";
import { getPool } from "./src/indexStore.js";
import { planFromIntake, llmAvailable } from "./src/planner.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/healthz", (req, res) =>
  res.json({ ok: true, llm: llmAvailable(), searchProvider: process.env.BRAVE_API_KEY ? "brave" : process.env.TAVILY_API_KEY ? "tavily" : "duckduckgo" })
);

// V2 stage 2-4: from intake to an approved-able crawl proposal
app.post("/api/agent/plan", express.json({ limit: "1mb" }), async (req, res) => {
  const intake = {
    topic: (req.body?.topic || "").trim(),
    documentsNeeded: (req.body?.documentsNeeded || "").trim(),
    researchQuestions: (Array.isArray(req.body?.researchQuestions)
      ? req.body.researchQuestions
      : String(req.body?.researchQuestions || "")
          .split("\n")
          .map((s) => s.trim())
    ).filter(Boolean).slice(0, 8),
    scope: (req.body?.scope || "").trim(),
  };
  if (!intake.topic) return res.status(400).json({ error: "topic is required" });
  try {
    res.json(await planFromIntake(intake));
  } catch (err) {
    console.error("agent plan error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/crawl", express.json({ limit: "1mb" }), async (req, res) => {
  const objective = (req.body?.objective || "").trim();
  const sites = (req.body?.sites || []).filter((s) => /^https?:\/\//.test(s)).slice(0, 10);
  const maxPages = Math.min(200, Math.max(1, Number(req.body?.maxPages) || 40));
  const maxDepth = Math.min(5, Math.max(0, Number(req.body?.maxDepth) || 2));
  const sameHostOnly = req.body?.sameHostOnly !== false;

  if (!objective) return res.status(400).json({ error: "objective is required" });
  if (sites.length === 0) return res.status(400).json({ error: "at least one site URL is required" });
  console.log("[crawl] request:", JSON.stringify({ sites, maxPages, maxDepth, sameHostOnly, index: !!req.body?.index }));

  const startedAt = Date.now();
  try {
    const perSite = Math.max(5, Math.ceil(maxPages / sites.length));
    const settled = await Promise.allSettled(
      sites.map((s) => crawlSite(s, objective, { maxPages: perSite, maxDepth, sameHostOnly }))
    );
    let all = settled.flatMap((r) => {
      if (r.status !== "fulfilled")
        console.error("[crawl] site failed:", sites[settled.indexOf(r)], r.reason?.message || r.reason);
      else
        console.log("[crawl] site done:", sites[settled.indexOf(r)], "pages:", r.value.results.length, "fetched:", r.value.fetched);
      return r.status === "fulfilled" ? r.value.results : [];
    });
    all = deriveTitles(all.sort((a, b) => b.relevance - a.relevance));

    // Optionally merge crawled pages into the data index
    if (req.body?.index) {
      for (const page of all) {
        try {
          await upsertPage(page);
        } catch (e) {
          console.error("[crawl] index page failed:", page.url, String(e.message || e).slice(0, 150));
        }
      }
    }

    res.json({
      objective,
      crawled_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      total_pages: all.length,
      results: all.slice(0, maxPages),
    });
  } catch (err) {
    console.error("crawl error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/index/build", async (req, res) => {
  try {
    await ensureIndexTable();
    res.json(await buildFromDataGovHk());
  } catch (err) {
    console.error("index build error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/index/search", async (req, res) => {
  try {
    await ensureIndexTable();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json(await searchIndex((req.query.q || "").trim(), limit));
  } catch (err) {
    console.error("index search error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

ensureIndexTable().catch((e) => console.error("ensureIndexTable error:", e));

app.listen(PORT, () => console.log(`agenticSearch listening on ${PORT}`));
