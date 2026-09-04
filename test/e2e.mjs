// E2E suite against a live deployment. Run:
//   BASE_URL=https://search.simonsays.hk node test/e2e.mjs
const BASE = process.env.BASE_URL || "http://localhost:8080";
let failures = 0;

function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " — " + detail}`);
  if (!cond) failures++;
}

const json = async (path, opts) => {
  const r = await fetch(BASE + path, opts);
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

console.log(`E2E against ${BASE}\n`);

// 1. Health
{
  const { status, body } = await json("/healthz");
  check("healthz 200 ok", status === 200 && body.ok === true);
}

// 2. Input validation
{
  const { status } = await json("/api/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sites: ["https://en.wikipedia.org/wiki/Web_crawler"] }),
  });
  check("crawl without objective -> 400", status === 400);
}

// 3. Static crawl (Wikipedia)
{
  const { status, body } = await json("/api/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objective: "how web crawlers work",
      sites: ["https://en.wikipedia.org/wiki/Web_crawler"],
      maxPages: 5,
      maxDepth: 1,
    }),
  });
  const rs = body.results || [];
  check("static crawl -> 200", status === 200);
  check("static crawl >= 3 pages", rs.length >= 3, `got ${rs.length}`);
  check(
    "results well-formed (title, url, relevance, summary)",
    rs.every((r) => r.title && r.url && r.relevance >= 0 && r.relevance <= 100 && r.summary)
  );
  const top = rs[0] ? (rs[0].title + " " + rs[0].url).toLowerCase() : "";
  check("top result matches topic", /crawler|spider/.test(top), top);
}

// 4. JS-rendered crawl (LegCo SPA)
{
  const { status, body } = await json("/api/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      objective: "Legislative Council membership and functions",
      sites: ["https://www.legco.gov.hk/en/"],
      maxPages: 10,
      maxDepth: 2,
    }),
  });
  check("JS-rendered crawl -> 200", status === 200);
  check("legco >= 5 pages (headless rendering works)", (body.results || []).length >= 5, `got ${(body.results || []).length}`);
}

// 5. Index search
{
  const { status, body } = await json("/api/index/search?q=population&limit=5");
  check("index search -> 200", status === 200);
  check("index search returns results", (body.results || []).length >= 1);
  check("index entries have source+url", (body.results || []).every((r) => r.source && r.url));
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
