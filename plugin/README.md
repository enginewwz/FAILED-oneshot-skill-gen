# plugin

Minimal dsh plugin for generating one skill from one session and inserting its
steps into the composer.

## Files

- `index.js` — host half. Reads a session through `ctx.sessionQuery`, writes
  `SKILL.md` + `skillgen.json` under `$DSH_HOME/skills/<name>/`, and serves
  `/skill-gen/api/{turns,generate,manifests}`.
- `client.js` — browser half. Hand-written `__ModuleLoader__.load` bundle; no
  build step. Registers:
  - `conversation.session.header.actions` — “生成 Skill” opens the main panel.
  - `main[key=skill-gen]` — three-column draft editor: turn candidates,
    recursive mount tree, final step preview; 5-level weight slider, synthetic
    roots/intermediate nodes, entry point, default entry, per-node title/content
    modes, AI polish controls, prompt preview, autosave, generate.
  - `conversation.input.dock` — “Skill 步骤” button, skill switcher, “注入 skill”
    (`/<skill-name>`) and step-prompt buttons. It only fills the composer with
    `inputActions.setDraft`; it never submits.
- `package.json` — package name/exports and `dsh.client` declaration.

## Host API

All endpoints are same-origin and require the normal browser cookie.

- `GET /skill-gen/api/turns?sessionId=<id>` — session title, cwd, turn cards.
- `GET /skill-gen/api/sessions` — accessible sessions for the left-column
  session switcher.
- `GET /skill-gen/api/draft?sessionId=<id>` — the saved draft, or `null`.
- `PUT /skill-gen/api/draft` — body `{ sessionId, draft }`; validates turn ids
  and normalizes node fields.
- `POST /skill-gen/api/generate` — body `{ sessionId, draft?, turnIds?, name? }`;
  uses the supplied/saved draft, or falls back to `turnIds`, writes the skill and
  manifest, returns paths and steps.
- `GET /skill-gen/api/manifests` — every `skillgen.json` found under
  `$DSH_HOME/skills`; the dock uses this for its switcher.
- `POST /skill-gen/api/prompt-preview` — builds the exact system/user AI prompt
  without calling a model.
- `POST /skill-gen/api/polish` — post-order AI calls, batched per level; writes
  per-node summaries, cached by fingerprint. `original` content is reference for
  the final AI rewrite; `manual` content is preserved.

## Skill output

`SKILL.md` is the only file the model sees as a skill. `skillgen.json` is a
sidecar for the dock: step id, title, prompt template, start condition, next.
The skill is not copied, generalized, or LLM-polished in this version.

## Loading

The isolated dev home loads `plugin/index.js` through
`.dsh/skill-gen/dev.patch.yml`; `scripts/dsh-skillgen.sh` applies it
automatically. The client bundle is discovered from the nearest `package.json`
(`dsh.client` + `exports["./client"]`).

## Draft model

`nodes` form a forest via `parentId` (null = top-level root); sibling order is
array order. A node has `sessionId`, `turnIds`, `titleMode`
(`prompt`/`ai`/`manual`), manual `title`, `contentMode`
(`original`/`ai`/`manual`), manual `content`, optional `ai` cache, `intent`,
`weight` 0–4 (2 = default), `startable`, `startCondition`, `artifacts`, `notes`,
and `synthetic` for turn-less roots/intermediate nodes. `defaultEntryId` selects
the default starting step. Nodes from several sessions can share one root.
Drafts live in `$DSH_HOME/skill-gen/drafts/<ownerSessionId>.json` and carry
`ai.enabled`, `ai.note`, AI caches, and a bounded `edits` log.

## Limits

- Deterministic generation only; no model call.
- One skill per run; steps come from draft nodes.
- The editor is a three-column form/tree, not a drag canvas; merge suggestions
  are not implemented yet. There is no send/load tracking or next-step state.
- AI polish is implemented but has not been run against a model in this checkout;
  prompts are reviewable from the UI or `docs/ai-prompts.md`. Leaves with no
  input/output require manual content; AI never invents them.
- Generation detail is derived from the 5-level weight; there is no manual
  detail control.
- Scripts are referenced as absolute paths; nothing is copied or executed.
- The test workspace shares `.dsh/skills` with the main harness; generated test
  skills are visible to a main session whose workspace is this repository.
