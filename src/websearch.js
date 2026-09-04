// Web search adapter. Default: DuckDuckGo HTML endpoint (keyless, works from
// Railway). Optional providers via env: BRAVE_API_KEY, TAVILY_API_KEY.
import { fetchWithTimeout } from "./http.js";

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

async function searchDuckDuckGo(query, maxResults) {
  const res = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    15000
  );
  if (!res.ok) throw new Error(`DDG ${res.status}`);
  const html = await res.text();
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
  const provider = activeProvider();
  let results = [];
  let error = null;
  try {
    if (provider === "brave") results = await searchBrave(query, maxResults);
    else if (provider === "tavily") results = await searchTavily(query, maxResults);
    else results = await searchDuckDuckGo(query, maxResults);
  } catch (e) {
    error = String(e.message || e);
  }
  return { query, provider, results, error };
}
