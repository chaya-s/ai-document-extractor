# Pi session extraction implementation guide

## Instructions for the coding agent

Before changing code:

1. Read the current upload route, extraction route, UI component, and installed `@earendil-works/pi-ai` documentation.
2. Emit the fault report below to the trainee, updated with any differences found in the live repository.
3. Only after showing the faults, proceed with the implementation tasks.
4. Keep the implementation limited to this guide. Do not add databases, queues, vector search, generic coding tools, authentication, retention systems, or other platform infrastructure.

## Fault report to emit first

| ID | Evidence | Current fault | Required change |
|---|---|---|---|
| F-01 | `app/api/read-document/route.ts:29-46`, `app/api/ask-document/route.ts:190-209` | Uploads and `output/result.json` are global, so sessions are not isolated and files can overwrite each other. | Create one `workspace/workspace-<uniqueId>/` directory for every extraction. |
| F-02 | `app/api/read-document/route.ts:121-126`, `components/Documentloader.tsx:55`, `components/Documentloader.tsx:79-89` | The server sends all extracted document text to the browser, and the browser sends it back for extraction. | Return a workspace ID. Keep the document server-side and let tools read it from that workspace. |
| F-03 | `app/api/ask-document/route.ts:87-147` | The entire document is interpolated into one prompt. The model has no document read or grep tool. | Run a Pi tool loop with workspace-scoped `read_document` and `grep_document` tools. |
| F-04 | `app/api/ask-document/route.ts:51-147` | Every request creates a new one-message context. There is no persisted session or stable Pi `sessionId`. | Persist the Pi context in the workspace and reuse one stable session ID for the extraction. |
| F-05 | `app/api/ask-document/route.ts:19-49`, `app/api/ask-document/route.ts:162-209` | The extraction tool is only treated as output data. It is not executed, and route code saves the result separately. | Add an executed terminal `save_result` tool that validates and writes the structured result. |
| F-06 | `app/api/ask-document/route.ts:211-229`, `components/Documentloader.tsx:74-108` | There is no saved trace and the UI only shows a loading state followed by the final response. | Append safe agent events to `traces/<sessionId>.jsonl` and stream the same events to the UI. |

The coding agent must show this table before editing. It may then continue automatically without requesting confirmation.

## Intended scope

Implement only these capabilities:

- One isolated workspace for each extraction.
- A persisted Pi session associated with that workspace.
- Custom document read and grep tools restricted to that workspace.
- A custom terminal tool that saves the structured result.
- A JSONL trace saved inside the workspace.
- Live display of those safe trace events in the existing UI.

Do not install or expose general coding-agent filesystem tools. The agent must not receive shell access, arbitrary paths, or unrestricted read/write access.

## Workspace layout

Use the repository-level `workspace` directory as the root:

```text
workspace/
  workspace-<uniqueId>/
    uploads/
      original.<ext>
      document.md
    results/
      result.json
    traces/
      <sessionId>.jsonl
    session.json
```

Requirements:

- Generate `<uniqueId>` on the server with `crypto.randomUUID()`.
- Use the same stable identifier as the Pi `sessionId`, or persist a separate stable session ID in `session.json`.
- Preserve the original filename as metadata in `session.json`; do not use it as the workspace directory name.
- Save both the original upload and extracted Markdown under `uploads/`.
- Keep the serializable Pi context and basic session status in `session.json`.
- Save only the final validated extraction to `results/result.json`.
- Append one JSON object per line to `traces/<sessionId>.jsonl`.
- Resolve all paths from a trusted workspace root and server-held workspace ID. Tool arguments must never accept filesystem paths.
- Add `/workspace/` to `.gitignore` and remove the old `/uploads/` and `/output/` runtime paths after migration.

A minimal `session.json` is sufficient:

```json
{
  "workspaceId": "workspace-<uniqueId>",
  "sessionId": "<uniqueId>",
  "originalFilename": "aircraft.pdf",
  "status": "ready",
  "createdAt": "2026-09-28T10:00:00.000Z",
  "updatedAt": "2026-09-28T10:00:00.000Z",
  "context": {
    "systemPrompt": "...",
    "messages": []
  }
}
```

Only these statuses are needed: `ready`, `running`, `completed`, and `failed`.

## Simplified API flow

### Upload

`POST /api/read-document`

1. Generate the workspace and session IDs.
2. Create `uploads/`, `results/`, and `traces/`.
3. Save the original file as `uploads/original.<ext>`.
4. Extract its text and save `uploads/document.md`.
5. Create `session.json` with status `ready`.
6. Return only:

```json
{
  "workspaceId": "workspace-<uniqueId>",
  "filename": "aircraft.pdf"
}
```

Do not return extracted text, `savedPath`, or `markdownPath`.

### Extraction

`POST /api/ask-document`

Request:

```json
{
  "workspaceId": "workspace-<uniqueId>"
}
```

The route must:

1. Resolve and validate the workspace ID.
2. Load `session.json` and its Pi context.
3. Set status to `running`.
4. Run `models.stream()` with the persisted context, custom tools, and stable `sessionId`.
5. Execute tool calls, append tool results to the context, persist `session.json`, and continue until `save_result` succeeds.
6. Append safe trace events to the JSONL file while also streaming them to the browser.
7. Set status to `completed` after `results/result.json` is saved, or `failed` after an error.

A streamed NDJSON response is enough. SSE, reconnect replay, background queues, and resumable browser connections are out of scope for now.

## Custom tools

### `read_document`

Purpose: read a bounded section of `uploads/document.md`.

Suggested arguments:

```ts
{
  offset: number;
  limit: number;
}
```

Behavior:

- The executor chooses the document path from the active workspace.
- `offset` is a character offset and `limit` is capped, for example at 12,000 characters.
- Return `{ content, offset, nextOffset, endOfDocument }`.
- Reject negative offsets and invalid limits.
- Never accept a path argument.

### `grep_document`

Purpose: find relevant lines without loading the whole document into the prompt.

Suggested arguments:

```ts
{
  query: string;
  maxMatches?: number;
}
```

Behavior:

- Search only `uploads/document.md` in the active workspace.
- Use literal, case-insensitive matching for the first implementation. Regex support is unnecessary.
- Cap query length, match count, and returned characters.
- Return matching line numbers and short surrounding excerpts.
- Never accept a path argument.

### `save_result`

Purpose: validate and save the final structured extraction.

Use a strict schema for exactly these five fields:

- Total Month Cycles
- Total Month Hours
- Total New Cycles
- Total New Time
- Aircraft Type

Each field contains:

```ts
{
  value: string | null;
  confidence: number; // 0 through 100
}
```

Behavior:

- Validate tool arguments with `validateToolCall()`.
- Reject missing fields, duplicate fields, extra fields, and confidence outside 0–100.
- Use `null` with confidence `0` when a value is not found.
- Write the validated arguments to `results/result.json`.
- Return a successful `toolResult` acknowledgement to the agent.
- Treat this as the terminal tool: once it succeeds, end the loop and mark the session `completed`.

The model must not receive a general `write_file` tool.

## Pi session loop

A proper session requires both a stable Pi `sessionId` and a persisted conversation context.

For each model turn:

1. Load the context from `session.json`.
2. Call `models.stream(model, context, { sessionId })`.
3. Forward safe stream events to the trace writer and UI stream.
4. Collect the final assistant message and append it to `context.messages`.
5. For every completed tool call:
   - validate it;
   - execute the matching custom tool;
   - append a Pi `toolResult` message;
   - write the updated context back to `session.json`.
6. Continue with another model turn when a read or grep tool was executed.
7. Stop after `save_result` succeeds.
8. Fail after a small fixed limit, such as 12 total tool calls, to prevent accidental loops.

Do not place the full document in the initial user prompt. The initial message should identify the required five fields and instruct the agent to use `grep_document`, `read_document`, and `save_result`.

## Trace format and UI streaming

Write the trace to:

```text
workspace/workspace-<uniqueId>/traces/<sessionId>.jsonl
```

A simple event format is sufficient:

```ts
type TraceEvent = {
  timestamp: string;
  type:
    | 'session.started'
    | 'model.started'
    | 'tool.started'
    | 'tool.completed'
    | 'result.saved'
    | 'session.completed'
    | 'session.failed';
  data: Record<string, unknown>;
};
```

Persist and stream events such as:

- Session started.
- Model turn started.
- `grep_document` started and number of matches returned.
- `read_document` started and character range returned.
- `save_result` completed.
- Token usage and stop reason on the terminal event when available.
- Safe error message when the session fails.

Do not persist or display raw chain-of-thought. Do not include complete document chunks in the trace. Tool events should contain summaries such as offsets, returned character counts, queries, and match counts.

The existing UI only needs a small trace panel that appends events as NDJSON records arrive, followed by the structured result table when `result.saved` is received.

## Implementation tasks

### T-00 — Emit faults before editing

- Read the live code and show the six-item fault report to the trainee.
- Acceptance: the report is visible before any code modification.

### T-01 — Create isolated workspaces

- Add a workspace helper that creates and resolves `workspace/workspace-<uniqueId>/` safely.
- Update upload parsing to store the original file, Markdown document, and `session.json` inside it.
- Return `workspaceId` instead of document text or filesystem paths.
- Acceptance: two uploads with the same filename create separate workspace directories and do not overwrite each other.

### T-02 — Implement custom tools

- Add `read_document`, `grep_document`, and `save_result` with TypeBox schemas and executors.
- Bind executors to the active workspace server-side.
- Acceptance: no tool accepts a path; read and grep cannot leave the active workspace; `save_result` writes a validated `results/result.json`.

### T-03 — Implement the persisted Pi session loop

- Store and reload the Pi context in `session.json`.
- Use `models.stream()` with a stable `sessionId`.
- Execute validated tool calls, append `toolResult` messages, persist after each turn, and stop after `save_result`.
- Add a small fixed tool-call limit.
- Acceptance: the agent reads or greps the workspace document instead of receiving it in the prompt, and the saved context shows the tool-call sequence.

### T-04 — Save and stream traces

- Append safe JSONL events to `traces/<sessionId>.jsonl`.
- Stream the same events to the browser as NDJSON from the extraction response.
- Acceptance: one extraction produces a readable JSONL trace, and the UI receives events before the final result.

### T-05 — Update the UI

- Replace `documentText` client state with `workspaceId`.
- Consume the NDJSON extraction stream.
- Show a small chronological trace panel and the final result table.
- Acceptance: the browser shows read/grep/save progress while extraction runs and never sends the document text back to the server.

### T-06 — Remove legacy paths and verify

- Remove global `uploads/`, `.text-cache/`, and `output/result.json` usage.
- Ignore `/workspace/` in Git.
- Exercise upload, read/grep tool calls, trace streaming, and saved result end to end.
- Acceptance: every artifact from one extraction is contained in its unique workspace and the result returned to the UI matches `results/result.json`.

## Definition of done

The trainee implementation is complete when:

- Uploading creates `workspace/workspace-<uniqueId>/`.
- Original document and extracted Markdown are under `uploads/`.
- The browser receives a workspace ID, not extracted document text or server paths.
- Pi uses a stable session ID and a context persisted in `session.json`.
- The agent can access document content only through `read_document` and `grep_document`.
- The agent saves the validated structured output only through `save_result`.
- The final output exists at `results/result.json`.
- Safe trace events exist at `traces/<sessionId>.jsonl` and appear live in the UI.
- No general filesystem, shell, or coding-agent tools are exposed.
- The old shared upload and output paths are no longer used.
