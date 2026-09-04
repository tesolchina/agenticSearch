// Data source index store: Postgres-backed index of datasets (data.gov.hk
// CKAN portal) and crawled pages, with full-text search.
import pg from "pg";
import { fetchWithTimeout } from "./http.js";

let pool = null;
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) return null;
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function ensureIndexTable() {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS pilot_index (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source text NOT NULL,
      kind text NOT NULL DEFAULT 'dataset',
      external_id text NOT NULL,
      title text NOT NULL,
      url text NOT NULL,
      description text DEFAULT '',
      org text DEFAULT '',
      formats text DEFAULT '',
      meta jsonb DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source, external_id)
    );
  `);
}

export async function upsertPage(page) {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  await p.query(
    `INSERT INTO pilot_index (source, kind, external_id, title, url, description, org, formats, meta)
     VALUES ($1, 'page', $2, $3, $4, $5, '', '', $6)
     ON CONFLICT (source, external_id) DO UPDATE SET
       title = EXCLUDED.title, description = EXCLUDED.description, meta = EXCLUDED.meta, updated_at = now()`,
    [
      new URL(page.url).hostname,
      page.url,
      (page.title || page.url).slice(0, 500),
      page.url,
      (page.summary || "").slice(0, 4000),
      JSON.stringify({ relevance: page.relevance, words: page.words, depth: page.depth }),
    ]
  );
}

// Build the index from data.gov.hk's CKAN API (all datasets, paged).
export async function buildFromDataGovHk() {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  const source = "data.gov.hk";
  const rows = 100;
  let start = 0;
  let total = 0;
  let indexed = 0;
  while (true) {
    const r = await fetchWithTimeout(
      `https://data.gov.hk/en-data/api/3/action/package_search?rows=${rows}&start=${start}`,
      30000
    );
    const j = await r.json();
    if (!j?.success) break;
    total = j.result.count;
    const results = j.result.results || [];
    for (const pkg of results) {
      const orgName = pkg.organization?.name || "";
      const url = `https://data.gov.hk/en-datasets/${orgName}/${pkg.name}`;
      const formats = [...new Set((pkg.resources || []).map((x) => x.format).filter(Boolean))].join(", ");
      await p.query(
        `INSERT INTO pilot_index (source, kind, external_id, title, url, description, org, formats, meta)
         VALUES ($1, 'dataset', $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source, external_id) DO UPDATE SET
           title = EXCLUDED.title, url = EXCLUDED.url, description = EXCLUDED.description,
           org = EXCLUDED.org, formats = EXCLUDED.formats, meta = EXCLUDED.meta, updated_at = now()`,
        [
          source,
          pkg.id,
          (pkg.title || pkg.name || "").slice(0, 500),
          url,
          (pkg.notes || "").replace(/\s+/g, " ").slice(0, 4000),
          (pkg.organization?.title || orgName).slice(0, 300),
          formats,
          JSON.stringify({ name: pkg.name, orgName, num_resources: (pkg.resources || []).length }),
        ]
      );
      indexed++;
    }
    start += rows;
    if (results.length === 0 || start >= total) break;
  }
  return { source, indexed, total_in_portal: total };
}

export async function searchIndex(q, limit = 20) {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  if (!q) {
    const { rows } = await p.query(
      `SELECT source, kind, title, url, description, org, formats, updated_at
       FROM pilot_index ORDER BY updated_at DESC, title LIMIT $1`,
      [limit]
    );
    const stats = await getStats();
    return { query: "", results: rows, stats };
  }
  const like = `%${q}%`;
  const { rows } = await p.query(
    `SELECT source, kind, title, url, description, org, formats, updated_at,
            ts_rank(
              to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(org,'')),
              websearch_to_tsquery('english', $1)
            ) AS rank
     FROM pilot_index
     WHERE title ILIKE $2 OR description ILIKE $2 OR org ILIKE $2 OR formats ILIKE $2
     ORDER BY rank DESC, updated_at DESC
     LIMIT $3`,
    [q, like, limit]
  );
  const stats = await getStats();
  return { query: q, results: rows, stats };
}

export async function getStats() {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT source, kind, count(*)::int AS n FROM pilot_index GROUP BY source, kind ORDER BY source, kind`
  );
  return rows;
}
