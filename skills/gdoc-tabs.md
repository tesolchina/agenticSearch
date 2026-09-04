---
name: gdoc-tabs
description: Rules for writing into Google Docs tabs via the Composio MCP — always target the exact tab ID the user provides; empty tabs are invisible to plaintext listings. Apply to any doc-update task.
---

# Google Docs tab operations — agenticSearch project

## Context

Progress logs and plans for GCAP3056 live in the Google Doc
`1yPWi938CDuSwfGCSTyqRIngdoXXkaFWrI7PlBgz6i7Y` across multiple tabs. The
owner creates tabs and shares the URL with `?tab=t.<TAB_ID>`. We write to
those tabs programmatically (gdoc_mcp.py → Composio MCP).

## Rules (learned 2026-09-04, after writing a plan into the wrong tab)

1. **The user's tab ID is authoritative.** A link like
   `...?tab=t.qsv5vzl6xck6` means: write into tab `t.qsv5vzl6xck6`.
   Never invent or substitute a tab.

2. **Empty tabs are invisible in plaintext listings.** `GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT`
   (and `gdoc_fetch2.py`) derive tabs from document *content*; a newly created
   empty tab does not appear. Its absence is NOT evidence it doesn't exist.

3. **Verify before creating.** Before creating any tab, confirm the target
   exists:
   `GOOGLEDOCS_GET_DOCUMENT_END_INDEX {document_id, tab_id}`
   - returns an index (even `2` for an empty tab) → tab exists; write there.
   - errors "tab not found" → then create one, and say so.

4. **Write into an existing tab** with `GOOGLEDOCS_INSERT_TEXT_ACTION`:
   `{document_id, tab_id, text, append_to_end: true}`.

5. **Create + rename** if genuinely new: `GOOGLEDOCS_CREATE_TAB
   {document_id, title}` → returns `tabId`; then
   `GOOGLEDOCS_UPDATE_TAB_PROPERTIES {document_id, tab_properties: {tab_id,
   title}}` (note: nested `tab_properties` object, not flat fields).

6. **Cleanup mistakes in place**: `GOOGLEDOCS_REPLACE_ALL_TEXT
   {document_id, tab_id, find_text, replace_text}` works per-tab for removing
   test text (args are `find_text`/`replace_text`, not `contains_text`).
   `GOOGLEDOCS_DELETE_CONTENT_RANGE` needs `range: {start_index, end_index}`
   nested, and its tab_id support is unreliable — verify with
   `GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT` after deleting.

7. **Verify after every write**: re-fetch and grep for a unique sentinel from
   the written text (we learned append retries can duplicate).

## Param quirks (Composio)

- `GOOGLEDOCS_INSERT_TEXT_ACTION`: `text`, `insertion_index` (must be < end
  index), or `append_to_end: true`; `tab_id` optional but honored.
- `GOOGLEDOCS_UPDATE_TAB_PROPERTIES`: flat `title`/`tab_id` fail; use
  `tab_properties: {tab_id, title}`.
- `GOOGLEDOCS_REPLACE_ALL_TEXT`: `find_text` / `replace_text` (NOT
  `contains_text`/`replace_text`).
