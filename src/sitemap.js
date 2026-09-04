// Sitemap discovery: robots.txt Sitemap: entries + common fallback paths.
// Handles sitemapindex -> nested urlsets and .gz-compressed sitemaps.
import zlib from "zlib";
import { fetchWithTimeout } from "./http.js";
import { normalizeUrl } from "./url.js";

export async function getSitemapUrls(origin, sitemaps, limit = 100) {
  const urls = [];
  const candidates = [...sitemaps, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`].slice(0, 3);
  for (const smUrl of candidates) {
    if (urls.length >= limit) break;
    try {
      const res = await fetchWithTimeout(smUrl, 10000);
      if (!res.ok) continue;
      let xml = Buffer.from(await res.arrayBuffer());
      if (smUrl.endsWith(".gz") || xml[0] === 0x1f) xml = zlib.gunzipSync(xml);
      xml = xml.toString("utf8");
      const nested = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((m) => m[1]);
      const isIndex = /<sitemapindex/i.test(xml);
      if (isIndex) {
        for (const child of nested.slice(0, 5)) {
          if (urls.length >= limit) break;
          try {
            const r2 = await fetchWithTimeout(child, 10000);
            if (!r2.ok) continue;
            let childXml = Buffer.from(await r2.arrayBuffer());
            if (child.endsWith(".gz") || childXml[0] === 0x1f) childXml = zlib.gunzipSync(childXml);
            childXml = childXml.toString("utf8");
            for (const m of childXml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
              const u = normalizeUrl(child, m[1]);
              if (u && u.endsWith(".html")) urls.push(u);
              if (urls.length >= limit) break;
            }
          } catch {
            /* skip */
          }
        }
      } else {
        for (const m of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
          const u = normalizeUrl(origin, m[1]);
          if (u && !/\.(pdf|xml|jpg|png)$/i.test(u)) urls.push(u);
          if (urls.length >= limit) break;
        }
      }
    } catch {
      /* skip */
    }
  }
  return [...new Set(urls)];
}
