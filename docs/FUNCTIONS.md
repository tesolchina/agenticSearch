# Functions developed

Version: 0.1.0 · Date: 2026-09-04 · Status: deployed to production
(https://agenticsearch-production.up.railway.app, consumed by
https://search.simonsays.hk/pilot)

## 1. Engine API functions

### POST /api/crawl — thorough web crawl

| Aspect | Detail |
|--------|--------|
| Input | `objective` (search goal text), `sites[]` (seed URLs, ≤10), `maxPages` (1–200, default 40), `maxDepth` (0–5, default 2), `sameHostOnly` (default true), `index` (bool — merge results into the data index) |
| Process | robots.txt check → sitemap seeding (incl. `.gz` + index files) → BFS link-following (depth-limited) → per-host politeness gap (crawl-delay honored, capped 2s) → fetch w/ TLS fallback → meta-refresh stub re-queue → main-content extraction (readability → heuristic fallback) → headless Chromium render for JS shells (≤15/site) → relevance scoring (keyword/title/URL) → extractive summary |
| Output | `{ objective, crawled_at, duration_ms, total_pages, results[] }` where each result = `{ url, title, relevance 0–100, summary, words, depth, full_text (≤50k chars) }` |
| Errors | 400 missing objective/sites; 500 engine error; site-level failures never fail the batch (allSettled) |

### POST /api/index/build — data.gov.hk dataset index

| Aspect | Detail |
|--------|--------|
| Input | none |
| Process | pages through data.gov.hk CKAN API (`package_search`, 100/page) → upserts every dataset into Postgres `pilot_index` (UNIQUE source+external_id → idempotent re-runs) |
| Output | `{ source: "data.gov.hk", indexed, total_in_portal }` — currently 316 datasets |

### GET /api/index/search — search the index

| Aspect | Detail |
|--------|--------|
| Input | `q` (empty = recent entries), `limit` (default 20, max 100) |
| Process | Postgres full-text (`ts_rank` over title+description+org) + ILIKE fallback across title/description/org/formats |
| Output | `{ query, results[], stats[] }` — results = `{ source, kind (dataset\|page), title, url, description, org, formats, updated_at }` |

### GET /healthz

Liveness probe: `{ ok: true }`.

## 2. Index coverage (as of 2026-09-04)

| Source | Kind | Entries | How indexed |
|--------|------|---------|-------------|
| data.gov.hk | dataset | 316 | CKAN API (all datasets) |
| www.legco.gov.hk | page | 47 | crawl of /en/ incl. open-legco section (headless rendering) |
| www.edb.gov.hk | page | 77 | crawl (static) |
| en.wikipedia.org | page | 8 | e2e/regression runs |
| **Total** | | **448** | |

## 3. Module functions (src/)

| Module | Exported functions |
|--------|--------------------|
| `src/http.js` | `fetchWithTimeout(url, timeoutMs)` — strict → lenient TLS retry; `politeGap(hostname, extraMs)` — per-host request spacing; `UA` |
| `src/robots.js` | `getRobots(origin)`, `robotsAllows(rules, url)`, `robotsCrawlDelay(rules)` — via robots-parser lib |
| `src/sitemap.js` | `getSitemapUrls(origin, sitemaps, limit)` — handles sitemapindex + `.gz` |
| `src/url.js` | `normalizeUrl(base, href)` — resolve, strip hash + tracking params, reject non-http |
| `src/extract.js` | `extractPage(html, url)` — cheerio cleanup + non-link-text scorer; `extractPageSmart(html, url)` — readability first, heuristic fallback |
| `src/relevance.js` | `keywordsFrom(objective)`, `scoreRelevance(text, title, keywords)`, `scoreUrlBoost(url, keywords)`, `summarize(text, keywords)` |
| `src/browser.js` | `renderPage(url)` — Playwright Chromium; lazy self-install of matching browser + system libs on launch failure |
| `src/crawler.js` | `crawlSite(startUrl, objective, opts)` — the BFS core; `deriveTitles(results)` — URL-derived titles for generic-title sites |
| `src/indexStore.js` | `ensureIndexTable()`, `upsertPage(page)`, `buildFromDataGovHk()`, `searchIndex(q, limit)`, `getStats()` |

## 4. Tests

| Suite | Command | Scope | Status |
|-------|---------|-------|--------|
| Unit | `npm test` | pure functions: URL normalize, keywords, scoring, summarize, extraction edge cases | 7 pass |
| Regression | `npm run test:regression` | guards 7 known production bugs (see `skills/regression-test.md`) + HTML fixtures | 10 pass |
| E2E | `BASE_URL=… npm run test:e2e` | live deployment: health, validation, static crawl, JS-rendered crawl, index search | 11 pass |
