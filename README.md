# agenticSearch

Standalone agentic web-search engine for the GCAP3056 Search Pilot
(https://search.simonsays.hk/pilot02). Extracted from the course-site monolith so
the engine can evolve (and be tested) independently of the frontend.

> **Canonical working repo** — from 2026-09-05 onward, feature work on the
> search pilot is done here and then embedded/referenced by the GCAP3056
> frontend (`tesolchina/gcap3056-22726`), which proxies `/api/*` to this
> service.
>
> **Requirements & progress** are tracked in the course Google Doc:
> https://docs.google.com/document/d/1yPWi938CDuSwfGCSTyqRIngdoXXkaFWrI7PlBgz6i7Y
> (tabs: request 1 / v2 plan / update on v2 / feedback on v2.x). Update progress
> there per `skills/gdoc-tabs.md` after each change.

## Architecture (modular)

| Module | Responsibility |
|--------|----------------|
| `server.mjs` | HTTP surface: `/api/crawl`, `/api/index/build`, `/api/index/search`, `/healthz` |
| `src/http.js` | fetch with TLS fallback (incomplete gov cert chains), per-host politeness, IPv4-first DNS |
| `src/robots.js` | robots.txt compliance via `robots-parser` (wildcards, crawl-delay) |
| `src/sitemap.js` | sitemap discovery incl. `.gz` + sitemap indexes |
| `src/url.js` | URL normalization (tracking-param stripping) |
| `src/extract.js` | main-content extraction: `@mozilla/readability` → heuristic non-link-text fallback |
| `src/relevance.js` | keyword scoring, URL boost, extractive summaries |
| `src/browser.js` | Playwright headless rendering for JS SPAs + lazy chromium self-install |
| `src/crawler.js` | BFS frontier, sitemap seeding, meta-refresh handling, render fallback |
| `src/indexStore.js` | Postgres index: data.gov.hk datasets (CKAN API) + crawled pages, full-text search |

Borrows patterns from the open-source crawler ecosystem: apify/crawlee
(politeness, request handling), scrapy (robots/crawl-delay discipline),
trafilatura/readability (main-content extraction), crawl4ai (LLM-friendly
output — planned).

## API

```bash
# Crawl (thorough: BFS depth 2, sitemap seeding, robots-compliant, JS rendering)
curl -X POST $BASE/api/crawl -H 'Content-Type: application/json' -d '{
  "objective": "Legislative Council membership and functions",
  "sites": ["https://www.legco.gov.hk/en/"],
  "maxPages": 40, "maxDepth": 2, "index": true
}'

# Index all data.gov.hk open datasets (316+) via CKAN API
curl -X POST $BASE/api/index/build

# Search the index
curl "$BASE/api/index/search?q=legco&limit=10"

# Liveness
curl $BASE/healthz
```

## Skills (development discipline)

Following the tesolchina/vibeCoding101 SKILL.md convention:

- [`skills/modular-dev.md`](skills/modular-dev.md) — module boundaries, change workflow
- [`skills/e2e-test.md`](skills/e2e-test.md) — post-deploy verification suite
- [`skills/regression-test.md`](skills/regression-test.md) — known production bugs guarded by tests

## Tests

```bash
npm test                 # unit (node:test, no network)
npm run test:regression  # guards known production bugs
BASE_URL=https://… npm run test:e2e   # live deployment verification
```

## Deploy

Railway (Nixpacks/Railpack), same pattern as the frontend: `npm install && npm run build`-free service, `node server.mjs`. Requires `DATABASE_URL` (Postgres) for the index endpoints. First crawl that needs headless rendering self-installs chromium (~1–2 min, once per container).
