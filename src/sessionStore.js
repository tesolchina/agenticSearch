// Session persistence: named research sessions stored in Postgres so students
// can share a unique link and resume across devices.
import { getPool } from "./indexStore.js";

export async function ensureSessionTable() {
  const p = getPool();
  if (!p) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL DEFAULT 'Untitled session',
      topic text DEFAULT '',
      documents_needed text DEFAULT '',
      research_questions text DEFAULT '',
      scope text DEFAULT '',
      plan jsonb DEFAULT '{}',
      approved text[] DEFAULT '{}',
      evidence jsonb DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function createSession({ title, topic, documentsNeeded, researchQuestions, scope }) {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  const rqs = Array.isArray(researchQuestions) ? researchQuestions : String(researchQuestions || "").split("\n").filter(Boolean);
  const { rows } = await p.query(
    `INSERT INTO sessions (title, topic, documents_needed, research_questions, scope)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, topic, documents_needed, research_questions, scope, created_at`,
    [
      (title || "").trim() || "Untitled session",
      (topic || "").trim(),
      (documentsNeeded || "").trim(),
      JSON.stringify(rqs.slice(0, 8)),
      (scope || "").trim(),
    ]
  );
  return rows[0];
}

export async function getSession(id) {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  const { rows } = await p.query(`SELECT * FROM sessions WHERE id = $1`, [id]);
  if (!rows.length) return null;
  const s = rows[0];
  let researchQuestions = [];
  try {
    researchQuestions = JSON.parse(s.research_questions || "[]");
  } catch {
    researchQuestions = [];
  }
  return {
    id: s.id,
    title: s.title,
    topic: s.topic,
    documentsNeeded: s.documents_needed,
    researchQuestions,
    scope: s.scope,
    plan: s.plan,
    approved: s.approved,
    evidence: s.evidence,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export async function updateSession(id, patch) {
  const p = getPool();
  if (!p) throw new Error("Database not configured");
  const fields = [];
  const values = [];
  let i = 1;
  const set = (col, val) => {
    if (val !== undefined) {
      fields.push(`${col} = $${i++}`);
      values.push(val);
    }
  };
  set("title", patch.title);
  set("topic", patch.topic);
  set("documents_needed", patch.documentsNeeded);
  set("scope", patch.scope);
  set("plan", patch.plan !== undefined ? JSON.stringify(patch.plan) : undefined);
  set("approved", patch.approved !== undefined ? patch.approved : undefined);
  set("evidence", patch.evidence !== undefined ? JSON.stringify(patch.evidence) : undefined);
  set("research_questions", patch.researchQuestions !== undefined ? JSON.stringify(
    Array.isArray(patch.researchQuestions) ? patch.researchQuestions : String(patch.researchQuestions || "").split("\n").filter(Boolean).slice(0, 8)
  ) : undefined);
  if (!fields.length) return getSession(id);
  fields.push(`updated_at = now()`);
  values.push(id);
  await p.query(`UPDATE sessions SET ${fields.join(", ")} WHERE id = $${i}`, values);
  return getSession(id);
}
