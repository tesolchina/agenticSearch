// Web search adapter. Keyless default: DuckDuckGo (html + lite endpoints,
// browser-like UA, backoff) — rate-limited easily, so results are cached.
// Preferred: Brave/Tavily via env keys (free tiers available).
import { fetchWithTimeout } from "./http.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 60 * 60 * 1000;
const searchCache = new Map(); // query -> { at, results }

export function activeProvider() {
  if (process.env.BRAVE_API_KEY) return "brave";
  if (process.env.TAVILY_API_KEY) return "tavily";
  return "duckduckgo";
}

function decodeDdgHref(href) {
  try {
    if (href.startsWith("//duckduckgo.com/l/") || href.includes("duckduckgo.com/l/")) {
      const u = new URL(href.startsWith("//") ? "https:" + href : href);
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    return href.startsWith("http") ? href : "https://" + href;
  } catch {
    return null;
  }
}

const DDG_HEADERS = {
  "User-Agent": BROWSER_UA,
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.8",
};

async function ddgParse(res, maxResults) {
  if (!res.ok) throw new Error(`DDG ${res.status}`);
  const html = await res.text();
  if (!html.includes("result__a")) throw new Error("DDG anti-bot/throttled response");
  const results = [];
  const blocks = html.split(/class="result[ _]/).slice(1);
  for (const block of blocks) {
    const hrefMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    if (!hrefMatch) continue;
    const url = decodeDdgHref(hrefMatch[1]);
    if (!url || !/^https?:\/\//.test(url)) continue;
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const strip = (s) =>
      (s || "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    results.push({
      title: strip(titleMatch?.[1]).slice(0, 200),
      url,
      snippet: strip(snippetMatch?.[1]).slice(0, 400),
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

async function searchDuckDuckGo(query, maxResults) {
  const q = encodeURIComponent(query);
  // html endpoint first, lite endpoint as fallback (separate rate pools)
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: DDG_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    return await ddgParse(res, maxResults);
  } catch (e1) {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, {
      headers: DDG_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw e1;
    return ddgParse(res, maxResults);
  }
}

const stripHtml = (s) =>
  (s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();

// Bing HTML scraping — keyless, independent rate pool from DDG.
async function searchBing(query, maxResults) {
  const res = await fetch(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults + 5}`,
    {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.8" },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`Bing ${res.status}`);
  const html = await res.text();
  const results = [];
  const blocks = html.split(/<li class="b_algo/).slice(1);
  for (const block of blocks) {
    if (results.length >= maxResults) break;
    const a = block.match(/<a[^>]+href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    results.push({ title: stripHtml(a[2]).slice(0, 200), url: a[1], snippet: "" });
  }
  // NOTE: Bing obfuscates server-side results with /ck/a redirects and ads;
  // kept as last-resort only.
  return results;
}

// Google News RSS — keyless, reliable for event/news topics (no HTML scraping).
async function searchGoogleNewsRss(query, maxResults) {
  const hasCjk = /[\u4e00-\u9fff]/.test(query);
  const locale = hasCjk
    ? "hl=zh-TW&gl=HK&ceid=HK:zh_Hant"
    : "hl=en-HK&gl=HK&ceid=HK:en";
  const res = await fetch(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`,
    { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`GoogleNews ${res.status}`);
  const xml = await res.text();
  const results = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items.slice(0, maxResults)) {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    if (link) results.push({ title: stripHtml(title).slice(0, 200), url: link.trim(), snippet: pubDate });
  }
  return results;
}

async function searchBrave(query, maxResults) {
  const res = await fetchWithTimeout(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
    15000,
    { "X-Subscription-Token": process.env.BRAVE_API_KEY, Accept: "application/json" }
  );
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const j = await res.json();
  return (j.web?.results || []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.description || "").slice(0, 400),
  }));
}

async function searchTavily(query, maxResults) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: maxResults,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const j = await res.json();
  return (j.results || []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: (r.content || "").slice(0, 400),
  }));
}

export async function webSearch(query, maxResults = 8) {
  const cached = searchCache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { query, provider: cached.provider, results: cached.results, error: null, cached: true };
  }
  const provider = activeProvider();
  let results = [];
  let error = null;
  try {
    if (provider === "brave") results = await searchBrave(query, maxResults);
    else if (provider === "tavily") results = await searchTavily(query, maxResults);
    else if (provider === "duckduckgo") {
      try {
        results = await searchDuckDuckGo(query, maxResults);
      } catch {
        // DDG throttled -> Google News RSS (keyless, independent rate pool)
        results = await searchGoogleNewsRss(query, maxResults);
      }
    }
  } catch (e) {
    error = String(e.message || e);
  }
  if (results.length) searchCache.set(query, { at: Date.now(), provider: cachedProviderName(results), results });
  return { query, provider: error && !results.length ? provider : cachedProviderName(results), results, error: results.length ? null : error };
}

function cachedProviderName(results) {
  return results.length ? activeProvider() : "none";
}
