---
name: e2e-test
description: End-to-end verification of the deployed agenticSearch service — run after every deploy or before release.
---

# E2E testing — agenticSearch

## 1. Target

- `BASE_URL` env (default `http://localhost:8080`). For production: `https://search.simonsays.hk` or the service's Railway domain.

## 2. Scenario suite (`test/e2e.mjs`)

Run: `BASE_URL=https://… node test/e2e.mjs`

1. **Health** — `GET /healthz` → 200, `ok: true`.
2. **Input validation** — `POST /api/crawl` with no objective → 400.
3. **Static crawl** — Wikipedia Web_crawler page, maxPages 5 → ≥ 3 pages, all have title + url + relevance 0–100 + non-empty summary; top result contains "crawler"/"spider" in title or URL.
4. **JS-rendered crawl** — legco.gov.hk/en, maxPages 10 → ≥ 5 pages (proves headless rendering path works).
5. **Index search** — `GET /api/index/search?q=population` → ≥ 1 result with title/url/source.

## 3. Pass criteria

- All scenarios pass; total runtime < 3 min.
- Any failure = deploy is not done; fix or roll back before announcing.

## 4. Never

- Never point e2e at a site not in the suite without raising maxPages discipline (be polite).
- Never run e2e against production more than a few times per day (it crawls real sites).
