// Google Docs export via Composio MCP (course owner's connected account).
// Creates a document from markdown, then moves it into the course Drive
// folder so anyone with the link can comment.
//
// Required env:
//   COMPOSIO_API_KEY   — Composio API key (ak_...)
//   COMPOSIO_MCP_SID   — MCP server id
//   COMPOSIO_USER_ID   — connected account user id
//   GDRIVE_FOLDER_ID   — destination folder
import { fetchWithTimeout } from "./http.js";

function mcpUrl() {
  const sid = process.env.COMPOSIO_MCP_SID;
  const uid = process.env.COMPOSIO_USER_ID;
  if (!sid || !uid) return null;
  return `https://backend.composio.dev/v3/mcp/${sid}/mcp?user_id=${uid}`;
}

function parseSse(text) {
  const out = [];
  for (const line of text.splitlines ? text.splitlines() : text.split("\n")) {
    const l = line.trim();
    if (l.startsWith("data:")) {
      try {
        out.push(JSON.parse(l.slice(5).trim()));
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

async function mcpCall(name, args) {
  const url = mcpUrl();
  if (!url) throw new Error("Composio not configured (COMPOSIO_MCP_SID/COMPOSIO_USER_ID missing)");
  const res = await fetchWithTimeout(
    url,
    120000,
    {
      "x-api-key": process.env.COMPOSIO_API_KEY || "",
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }
  );
  if (!res.ok) throw new Error(`Composio HTTP ${res.status}`);
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = parseSse(text).at(-1);
  }
  const result = payload?.result;
  if (!result) throw new Error("Composio returned no result");
  const content = (result.content || []).find((c) => c.type === "text");
  if (!content) throw new Error("Composio returned no text content");
  const inner = JSON.parse(content.text);
  if (inner.successfull === false || inner.successful === false) {
    throw new Error(inner.error || "Composio tool failed");
  }
  return inner.data;
}

export function gdocsConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY && mcpUrl() && process.env.GDRIVE_FOLDER_ID);
}

// Create a Google Doc from markdown and place it in the course folder.
export async function createEvidenceDoc(title, markdown) {
  const data = await mcpCall("GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN", {
    title: title.slice(0, 200),
    markdown_text: markdown,
  });
  const docId = data.documentId;
  const docUrl = data.display_url || `https://docs.google.com/document/d/${docId}/edit`;

  // move into the course folder
  try {
    await mcpCall("GOOGLEDRIVE_ADD_PARENT", {
      id: process.env.GDRIVE_FOLDER_ID, // parent folder
      fileId: docId, // the doc to file under it
    });
  } catch (e) {
    console.log("[gdocs] add-parent failed:", String(e.message || e).slice(0, 120));
  }

  // share as "anyone with the link can comment"
  try {
    await mcpCall("GOOGLEDRIVE_CREATE_PERMISSION", {
      file_id: docId,
      type: "anyone",
      role: "commenter",
    });
  } catch (e) {
    console.log("[gdocs] share failed:", String(e.message || e).slice(0, 120));
  }
  return { docId, docUrl };
}
