// The crawler core: BFS with sitemap seeding, robots compliance, meta-refresh
// handling, headless rendering fallback, relevance scoring.
import { fetchWithTimeout, UA, politeGap } from "./http.js";
import { getRobots, robotsAllows, robotsCrawlDelay } from "./robots.js";
import { getSitemapUrls } from "./sitemap.js";
import { normalizeUrl } from "./url.js";
import { extractPageSmart } from "./extract.js";
import { keywordsFrom, scoreRelevance, scoreUrlBoost, summarize } from "./relevance.js";
import { renderPage } from "./browser.js";

export async function crawlSite(startUrls, objective, opts) {
  if (process.env.CRAWL_DEBUG) console.log("[crawl] start", startUrls);
  const { maxPages, maxDepth, sameHostOnly } = opts;
  const starts = Array.isArray(startUrls) ? startUrls : [startUrls];
  // allowed hosts: all seed hosts (V2 seeds are on-topic URLs found by search)
  const startHosts = new Set(starts.map((u) => new URL(u).hostname.replace(/^www\./, "")));
  const origins = new Set(starts.map((u) => new URL(u).origin));
  const robotsCache = new Map();
  const keywords = keywordsFrom(objective);

  async function robotsFor(origin) {
    if (!robotsCache.has(origin)) robotsCache.set(origin, await getRobots(origin));
    return robotsCache.get(origin);
  }

  const visited = new Set();
  const queue = starts.map((url) => ({ url, depth: 0 }));
  const results = [];
  let fetched = 0;
  let rendered = 0;
  const MAX_RENDERED = 15; // headless renders are expensive; cap per site

  // Seed from sitemaps so JS-rendered sites (whose home pages are empty shells)
  // still get thoroughly crawled.
  for (const origin of origins) {
    const robots = await robotsFor(origin);
    const smUrls = await getSitemapUrls(origin, robots.sitemaps, Math.max(maxPages * 2, 60));
    for (const u of smUrls) {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (sameHostOnly && !startHosts.has(host)) continue;
      if (!robotsAllows(robots, u)) continue;
      if (!visited.has(u)) queue.push({ url: u, depth: 1 });
    }
  }

  while (queue.length > 0 && fetched < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (sameHostOnly && !startHosts.has(host)) continue;
    const robots = await robotsFor(u.origin);
    if (!robotsAllows(robots, url)) {
      if (process.env.CRAWL_DEBUG) console.log("[crawl] robots disallow", url);
      continue;
    }
    await politeGap(u.hostname, robotsCrawlDelay(robots) * 1000);

    let html;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        if (process.env.CRAWL_DEBUG) console.log("[crawl] skip non-ok", res.status, url);
        continue;
      }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("html")) {
        if (process.env.CRAWL_DEBUG) console.log("[crawl] skip non-html", ct, url);
        continue;
      }
      html = await res.text();
    } catch (e) {
      if (process.env.CRAWL_DEBUG) console.log("[crawl] fetch err", url, String(e.cause || e).slice(0, 120));
      continue;
    }
    fetched++;

    // Handle <meta http-equiv="refresh"> stub pages (common on gov sites):
    // re-queue the target instead of treating the stub as content.
    const metaRefresh = html.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i);
    if (metaRefresh) {
      const target = normalizeUrl(url, metaRefresh[1].replace(/["']/g, ""));
      if (target && !visited.has(target) && depth < maxDepth + 2) {
        queue.push({ url: target, depth });
      }
      continue;
    }

    let { title, text, links } = extractPageSmart(html, url);
    console.log("[crawl] fetched", url, "text:", text.length, "links:", links.length, "html:", html.length);

    // JS-rendered page? Static fetch got a shell -> render headlessly.
    if (text.length < 300 && links.length < 5 && rendered < MAX_RENDERED) {
      try {
        const renderedHtml = await renderPage(url);
        rendered++;
        const ex = extractPageSmart(renderedHtml, url);
        if (ex.text.length > text.length) {
          title = ex.title || title;
          text = ex.text;
          links = ex.links;
        }
      } catch (e) {
        console.log("[crawl] render err", url, String(e.message || e).slice(0, 200));
        // headless rendering unavailable; keep static extraction
      }
    }
    if (text.length < 80) {
      if (process.env.CRAWL_DEBUG) console.log("[crawl] skip thin page", url, text.length);
      continue;
    }

    const relevance = Math.min(100, scoreRelevance(text, title, keywords) + scoreUrlBoost(url, keywords));
    results.push({
      url,
      title: title || url,
      relevance,
      summary: summarize(text, keywords),
      words: text.split(/\s+/).length,
      depth,
      full_text: text.slice(0, 50000),
    });

    if (depth < maxDepth) {
      for (const href of links) {
        const next = normalizeUrl(url, href);
        if (next && !visited.has(next)) queue.push({ url: next, depth: depth + 1 });
      }
    }
  }
  return { results, fetched, visited: visited.size };
}

// Derive better titles from the URL when a site uses one generic <title>
export function deriveTitles(results) {
  const titleCounts = {};
  for (const p of results) titleCounts[p.title] = (titleCounts[p.title] || 0) + 1;
  for (const p of results) {
    if (titleCounts[p.title] > 1 || !p.title) {
      const seg = new URL(p.url).pathname.split("/").filter(Boolean).pop() || new URL(p.url).hostname;
      const pretty = decodeURIComponent(seg)
        .replace(/\.(html?|aspx?|php)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (pretty.length > 3) p.title = pretty;
    }
  }
  return results;
}

export { UA };
