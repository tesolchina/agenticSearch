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
import { planFromIntake } from "./src/planner.js";
import { llmAvailable } from "./src/llm.js";
import { createJob, getJob } from "./src/jobs.js";
import { gdocsConfigured, createEvidenceDoc } from "./src/gdocs.js";

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/healthz", (req, res) =>
  res.json({ ok: true, llm: llmAvailable(), searchProvider: process.env.BRAVE_API_KEY ? "brave" : process.env.TAVILY_API_KEY ? "tavily" : "duckduckgo" })
);

// V2 stage 2-4: from intake to an approved-able crawl proposal (job-based so
// the UI can report progress; the plan runs 14 queries + LLM calls).
app.post("/api/agent/plan", express.json({ limit: "1mb" }), (req, res) => {
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
    feedback: (req.body?.feedback || "").trim(),
  };
  if (!intake.topic) return res.status(400).json({ error: "topic is required" });
  const job = createJob("plan", ["Generate queries (EN + 中文)", "Run preliminary web searches", "Query data.gov.hk", "Propose domains"], async (setStage) => {
    setStage("Generate queries (EN + 中文)");
    const result = await planFromIntake(intake, setStage);
    return result;
  });
  res.json({ jobId: job.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

// V2 stage 5: crawl with seeds (on-topic URLs from the plan) — job-based.
app.post("/api/agent/crawl", express.json({ limit: "2mb" }), (req, res) => {
  const objective = (req.body?.objective || "").trim();
  const seeds = (req.body?.seeds || []).filter((s) => /^https?:\/\//.test(s)).slice(0, 60);
  const domains = (req.body?.domains || []).map((d) => String(d).trim()).filter(Boolean).slice(0, 10);
  const maxPages = Math.min(200, Math.max(1, Number(req.body?.maxPages) || 40));
  const maxDepth = Math.min(5, Math.max(0, Number(req.body?.maxDepth) || 2));
  if (!objective) return res.status(400).json({ error: "objective is required" });
  if (seeds.length === 0 && domains.length === 0)
    return res.status(400).json({ error: "seeds or domains required" });

  const starts = seeds.length ? seeds : domains.map((d) => `https://${d}/`);
  const job = createJob(
    "crawl",
    ["Check robots.txt", "Crawl approved domains", "Extract and score pages", "Rank results"],
    async (setStage) => {
      const perRun = Math.max(10, Math.ceil(maxPages));
      const { results, fetched } = await crawlSite(starts, objective, {
        maxPages: perRun,
        maxDepth,
        sameHostOnly: true,
      });
      setStage("Rank results");
      const ranked = deriveTitles(results.sort((a, b) => b.relevance - a.relevance));
      if (req.body?.index) {
        for (const p of ranked) {
          try {
            await upsertPage(p);
          } catch (e) {
            console.error("[crawl] index page failed:", p.url, String(e.message || e).slice(0, 120));
          }
        }
      }
      return {
        objective,
        crawled_at: new Date().toISOString(),
        seeds: starts.length,
        fetched,
        total_pages: ranked.length,
        results: ranked.slice(0, maxPages),
      };
    }
  );
  res.json({ jobId: job.id });
});

// Export an evidence pack to Google Docs (course folder) via Composio.
app.post("/api/export/gdocs", express.json({ limit: "2mb" }), async (req, res) => {
  const title = (req.body?.title || "Evidence pack").trim();
  const markdown = req.body?.markdown || "";
  if (!markdown.trim()) return res.status(400).json({ error: "markdown is required" });
  if (!gdocsConfigured())
    return res.status(503).json({ error: "Google Docs export not configured (COMPOSIO_* / GDRIVE_FOLDER_ID)" });
  try {
    res.json(await createEvidenceDoc(title, markdown));
  } catch (err) {
    console.error("gdocs export error:", err);
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
