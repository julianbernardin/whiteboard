# Project documents

Projects are freeform, versioned documents, not change reviews. Read the Components reference below before editing.

- If the user says “use Project” or “usa Proyecto” without a name, call `session_create({kind:"project",open:false})`. This ensures the fixed `sessionId:"project"` idempotently. Use `session_get` and `session_edit` on that ID.
- For a named Project such as “Proyecto SDD MCP”, call `session_list`, filter `kind:"project"`, and match the title exactly after case and whitespace normalization. Use the matching UUID. If none exists, ask whether to create it or call `session_create({kind:"project",title:"SDD MCP",open:false})` when creation was requested. If multiple titles match, ask the user to select one.
- Do not substitute the scratchpad for an explicitly requested Project. Do not keep a global active Project ID.
- Use `session_edit` for diagrams, text, sequences, and structures. Read back with `session_get({sessionId,format:"json",full:true})` before finishing. After the first edit, call `session_open` once if Desktop is available and the user should see it; do not reopen on every edit. Avoid repeating the entire document in chat.
- Projects have no inherited source pins. Every code reference needs explicit `pins:{repositoryId,head,base?}`. Use the existing repository registration tool to obtain `repositoryId` for a block; it does not associate the Project with a review target. Never invent source evidence.
- `session_project_update({sessionId,links})` replaces the entire ordered HTTPS links array. Use `session_history` and `session_restore` to inspect or restore document versions and links. Use `session_rename` for the title.
- Review commands such as `session_set_target`, `session_lens_edit`, `session_attention`, `session_delete`, and diff operations do not apply to Projects.
