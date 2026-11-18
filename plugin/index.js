// Host half: session turns -> SKILL.md + skillgen.json, plus the small HTTP API.
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const name = 'skill-gen'
export const inject = ['webServer', 'sessionQuery', 'llm', 'agents', 'agentDefaultModel']

const API_PREFIX = '/skill-gen/api'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TEXT = 6000
const MAX_BODY = 1024 * 1024

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const path = url.pathname.slice(API_PREFIX.length) || '/'
        if (request.method === 'GET' && path === '/turns') return await sendTurns(ctx, url, response)
        if (request.method === 'GET' && path === '/sessions') return await sendSessions(ctx, response)
        if (request.method === 'GET' && path === '/manifests') return await sendManifests(response)
        if (request.method === 'GET' && path === '/draft') return await sendDraft(url, response)
        if (request.method === 'PUT' && path === '/draft') return await saveDraftRoute(ctx, request, response)
        if (request.method === 'POST' && path === '/prompt-preview') return await promptPreview(ctx, request, response)
        if (request.method === 'POST' && path === '/polish') return await polishRoute(ctx, request, response)
        if (request.method === 'POST' && path === '/generate') return await generate(ctx, request, response)
        send(response, 404, { error: `unknown endpoint: ${request.method} ${path}` })
      } catch (error) {
        send(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))
}

async function sendTurns(ctx, url, response) {
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return send(response, 400, { error: 'sessionId is required' })
  const session = await readSessionData(ctx, sessionId)
  send(response, 200, {
    sessionId,
    title: sessionTitle(session.snapshot),
    cwd: session.snapshot.session.cwd ?? '',
    turns: session.turns,
  })
}

async function sendSessions(ctx, response) {
  const records = await ctx.sessionQuery.listSessions()
  const ids = records.map(record => record.header.id)
  let titles = []
  try {
    titles = await ctx.sessionQuery.readTitleSnapshots(ids)
  } catch {
    titles = []
  }
  const sessions = records.map((record, index) => {
    const result = titles[index]
    const title = result && result.status === 'fulfilled' ? String(result.value?.title ?? '') : ''
    return {
      id: record.header.id,
      title,
      cwd: record.header.cwd ?? '',
      live: record.live,
      createdAt: record.header.createdAt,
      parentSession: record.header.parentSession ?? null,
    }
  })
  send(response, 200, { sessions })
}

async function sendManifests(response) {
  const root = join(dshHome(), 'skills')
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    entries = []
  }
  const manifests = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const data = JSON.parse(await readFile(join(root, entry.name, 'skillgen.json'), 'utf8'))
      if (data && typeof data.skill === 'string' && Array.isArray(data.steps)) {
        manifests.push({ ...data, path: join(root, entry.name) })
      }
    } catch {
      // A missing or malformed manifest is simply not listed.
    }
  }
  manifests.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
  send(response, 200, { manifests })
}

async function sendDraft(url, response) {
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return send(response, 400, { error: 'sessionId is required' })
  send(response, 200, { draft: await readDraft(sessionId) })
}

async function saveDraftRoute(ctx, request, response) {
  const body = await readJson(request)
  const ownerSessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!ownerSessionId) return send(response, 400, { error: 'sessionId is required' })
  const sessions = await loadSessions(ctx, collectSessionIds(body.draft, ownerSessionId))
  if (!sessions.has(ownerSessionId)) return send(response, 400, { error: 'owner session is unavailable' })
  const draft = normalizeDraft(body.draft, ownerSessionId, sessions)
  await writeDraft(draft)
  send(response, 200, { draft })
}

async function generate(ctx, request, response) {
  const body = await readJson(request)
  const ownerSessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!ownerSessionId) return send(response, 400, { error: 'sessionId is required' })
  let raw = body.draft && typeof body.draft === 'object' ? body.draft : await readDraft(ownerSessionId)
  const sessions = await loadSessions(ctx, collectSessionIds(raw, ownerSessionId))
  if (!sessions.has(ownerSessionId)) return send(response, 400, { error: 'owner session is unavailable' })
  let draft = normalizeDraft(raw, ownerSessionId, sessions)
  if (draft.nodes.length === 0) {
    const turnIds = Array.isArray(body.turnIds) ? body.turnIds.map(String) : []
    if (turnIds.length === 0) return send(response, 400, { error: 'select at least one turn' })
    raw = {
      schemaVersion: 3,
      nodes: turnIds.map((id, index) => ({
        id: `n${index + 1}`,
        sessionId: ownerSessionId,
        turnIds: [id],
        title: '',
        parentId: index === 0 ? null : 'n1',
      })),
      defaultEntryId: 'n1',
    }
    draft = normalizeDraft(raw, ownerSessionId, sessions)
  }
  if (draft.nodes.length === 0) return send(response, 400, { error: 'the draft has no valid turns' })

  const aiEnabled = body.ai === undefined ? draft.ai?.enabled !== false : body.ai === true
  const rows = prepareTree(draft, sessions).rows
  const children = buildChildren(rows)
  try {
    assertLeaves(rows, children)
    assertLongPrompts(rows)
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
  if (!aiEnabled) {
    const anonymous = rows.filter(row => isAnonymous(row.node))
    if (anonymous.length > 0) {
      return send(response, 400, {
        error: `anonymous nodes need a title or AI polish: ${anonymous.map(row => row.node.id).join(', ')}`,
      })
    }
  }

  let aiWarning = ''
  let aiCalls = 0
  if (aiEnabled) {
    try {
      const selection = selectModel(ctx, ownerSessionId)
      const result = await runAi(ctx, draft, sessions, selection, requestAbortSignal(request))
      aiCalls = result.calls
    } catch (error) {
      aiWarning = error instanceof Error ? error.message : String(error)
    }
  }

  const aiUsed = aiEnabled && (aiCalls > 0 || draft.nodes.some(node => node.ai !== undefined
    && (String(node.ai.title ?? '').trim() !== '' || String(node.ai.content ?? '').trim() !== '')))
  const written = await writeSkill(ownerSessionId, draft, sessions, body.name, { aiUsed, aiEnabled })
  draft.edits = []
  await writeDraft(draft)
  send(response, 200, {
    ...written,
    draft,
    ai: { enabled: aiEnabled, used: aiUsed, calls: aiCalls, cached: aiCalls === 0, warning: aiWarning },
  })
}

async function readSessionData(ctx, sessionId) {
  const snapshot = await ctx.sessionQuery.readSession(sessionId)
  const turns = extractTurns(snapshot.events)
  return { snapshot, turns, turnById: new Map(turns.map(turn => [turn.id, turn])) }
}

async function loadSessions(ctx, ids) {
  const sessions = new Map()
  for (const sessionId of ids) {
    if (typeof sessionId !== 'string' || sessionId === '') continue
    try {
      sessions.set(sessionId, await readSessionData(ctx, sessionId))
    } catch {
      // A stale session reference is dropped by normalization.
    }
  }
  return sessions
}

function collectSessionIds(raw, ownerSessionId) {
  const ids = new Set([ownerSessionId])
  for (const node of Array.isArray(raw?.nodes) ? raw.nodes : []) {
    if (typeof node?.sessionId === 'string' && node.sessionId !== '') ids.add(node.sessionId)
  }
  return ids
}

function normalizeDraft(raw, ownerSessionId, sessions) {
  const rawNodes = Array.isArray(raw?.nodes) ? raw.nodes : []
  const legacyTree = !(Number(raw?.schemaVersion) >= 2)
  const legacyContent = !(Number(raw?.schemaVersion) >= 3)
  const nodes = []
  const used = new Set()
  for (const [index, value] of rawNodes.entries()) {
    if (value === null || typeof value !== 'object') continue
    const declaredSession = typeof value.sessionId === 'string' && value.sessionId !== ''
      ? value.sessionId
      : ownerSessionId
    const requestedTurnIds = Array.isArray(value.turnIds) ? value.turnIds : []
    if (declaredSession !== ownerSessionId && !sessions.has(declaredSession) && requestedTurnIds.length > 0) continue
    const requestedSession = sessions.has(declaredSession) ? declaredSession : ownerSessionId
    const turnById = sessions.get(requestedSession)?.turnById
    const turnIds = [...new Set(requestedTurnIds.map(String))]
      .filter(id => turnById?.has(id) && !used.has(`${requestedSession}:${id}`))
    const title = typeof value.title === 'string' ? value.title.trim().slice(0, 120) : ''
    const synthetic = turnIds.length === 0 && requestedTurnIds.length === 0
    if (!synthetic && turnIds.length === 0) continue
    const titleMode = value.titleMode === 'ai' || value.titleMode === 'manual' || value.titleMode === 'prompt'
      ? value.titleMode
      : (title !== '' || synthetic ? 'manual' : 'prompt')
    const content = typeof value.content === 'string' ? value.content : ''
    const contentMode = value.contentMode === 'ai' || value.contentMode === 'manual' || value.contentMode === 'original'
      ? value.contentMode
      : (synthetic && content === '' ? 'manual' : 'original')
    const ai = normalizeNodeAi(value.ai, legacyContent)
    if (!synthetic) for (const id of turnIds) used.add(`${requestedSession}:${id}`)
    let id = typeof value.id === 'string' && value.id.trim() !== '' ? value.id.trim() : `n${index + 1}`
    if (nodes.some(node => node.id === id)) id = `n${index + 1}-${Date.now()}`
    const weight = Number.isInteger(value.weight) && value.weight >= 0 && value.weight <= 4 ? value.weight : 2
    nodes.push({
      id,
      sessionId: synthetic ? null : requestedSession,
      turnIds,
      parentId: typeof value.parentId === 'string' ? value.parentId : null,
      titleMode,
      title,
      contentMode,
      content,
      ...(ai === undefined ? {} : { ai }),
      intent: typeof value.intent === 'string' ? value.intent.slice(0, 500) : '',
      weight,
      startable: value.startable === true,
      startCondition: typeof value.startCondition === 'string' ? value.startCondition.slice(0, 300) : '',
      artifacts: Array.isArray(value.artifacts) ? value.artifacts.map(String).slice(0, 20) : [],
      notes: typeof value.notes === 'string' ? value.notes.slice(0, 1000) : '',
      synthetic,
    })
  }
  const ids = new Set(nodes.map(node => node.id))
  if (legacyTree && nodes.length > 1) {
    const rawRoots = new Set((Array.isArray(raw?.roots) ? raw.roots : []).map(String))
    const root = nodes.find(node => rawRoots.has(node.id)) || nodes[0]
    for (const node of nodes) node.parentId = node.id === root.id ? null : root.id
  }
  for (const node of nodes) {
    if (node.parentId !== null && (!ids.has(node.parentId) || node.parentId === node.id)) node.parentId = null
  }
  for (const node of nodes) {
    const seen = new Set([node.id])
    let parent = node.parentId
    while (parent !== null) {
      if (seen.has(parent)) { node.parentId = null; break }
      seen.add(parent)
      parent = nodes.find(candidate => candidate.id === parent)?.parentId ?? null
    }
  }
  const defaultEntryId = ids.has(raw?.defaultEntryId)
    ? raw.defaultEntryId
    : nodes.find(node => node.weight > 0 || node.parentId === null)?.id
  const rawAi = raw?.ai !== null && typeof raw?.ai === 'object' ? raw.ai : {}
  const edits = Array.isArray(raw?.edits) ? raw.edits.slice(-200) : []
  const skill = rawAi.skill !== null && typeof rawAi.skill === 'object' ? rawAi.skill : undefined
  return {
    schemaVersion: 3,
    ownerSessionId,
    nodes,
    ...(defaultEntryId === undefined ? {} : { defaultEntryId }),
    ai: {
      enabled: rawAi.enabled !== false,
      note: typeof rawAi.note === 'string' ? rawAi.note.slice(0, 2000) : '',
      ...(skill === undefined ? {} : { skill }),
    },
    edits,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeNodeAi(value, legacyContent) {
  if (value === null || typeof value !== 'object') return undefined
  const clean = (input) => typeof input === 'string' ? input : undefined
  const title = clean(value.title)
  const content = clean(value.content)
  const list = (input) => Array.isArray(input) ? input.map(item => typeof item === 'string' ? item : '').filter(Boolean) : undefined
  const doList = list(value.do)
  const dontList = list(value.dont)
  const examples = list(value.examples)
  if (title === undefined && content === undefined && doList === undefined && dontList === undefined && examples === undefined && !legacyContent) return undefined
  return {
    ...(title === undefined ? {} : { title: title.slice(0, 120) }),
    ...(content === undefined ? {} : { content }),
    ...(clean(value.check) === undefined ? {} : { check: clean(value.check) }),
    ...(clean(value.gotcha) === undefined ? {} : { gotcha: clean(value.gotcha) }),
    ...(doList === undefined ? {} : { do: doList }),
    ...(dontList === undefined ? {} : { dont: dontList }),
    ...(examples === undefined ? {} : { examples }),
    ...(clean(value.fingerprint) === undefined ? {} : { fingerprint: clean(value.fingerprint).slice(0, 128) }),
    ...(clean(value.updatedAt) === undefined ? {} : { updatedAt: clean(value.updatedAt).slice(0, 64) }),
  }
}

const PROMPT_VERSION = 'skill-gen-ai-v2'
const MAX_CALL_CHARS = 110000
const MAX_PARTIAL_CHARS = 35000

const AI_SYSTEM_PROMPT = `You summarize a batch of skill steps that belong to the same level of one reusable workflow.

Return one JSON object only. Do not wrap it in Markdown fences and do not add commentary.

The exact output shape is:
{
  "items": [
    {
      "title": "short title; only when this item requests a title",
      "content": "summary or instruction; only when this item requests content",
      "check": "optional verification for this item",
      "gotcha": "optional pitfall for this item",
      "do": ["optional concrete action"],
      "dont": ["optional anti-pattern"],
      "examples": ["optional concrete input/output example"]
    }
  ]
}

Hard rules:
- The user prompt lists N items. Return exactly N objects in the same order. Do not return ids, indexes, or extra items.
- Each item lists "needs". Fill only the requested fields. The other field is reference material; do not rewrite it.
- The user prompt may contain USER_NOTE. Treat it as a human instruction for this batch; it must not override the hard rules above.
- An item that lists child titles is a parent item: write a parent-level summary that uses those child titles for structure. Do not repeat every child detail.
- Weight controls depth: 4 or 3 = most important; keep concrete input/output examples and say what to do and what not to do. 2 = concise actionable instruction. 1 = one line. 0 = title/structural phrase only, no body content.
- Use only facts present in that item's own input/output, manual reference, and child summaries. Never invent commands, files, tools, URLs, steps, or examples.
- An item with no input/output and no manual content is a blank leaf. Do not invent it; such an item must be filled by a human before this call.
- You may break the old "input -> output" template. Write natural, direct steps.
- Preserve the item's real input/output content. If an own_output or content_reference contains "...（省略的代码块/表格/图片）" or a "..." gap, treat the omitted text as unavailable and do not invent it.
- Aim for a reply length that fits the weight; this is guidance, not a hard character count.
- Write in the language requested by the user prompt. Be concrete and avoid generic filler.
`;

const AI_PARTIAL_SYSTEM_PROMPT = `You summarize one chunk of the recorded turns of a single skill step.

Return one JSON object only, with no Markdown fences and no commentary:
{"content":"a factual summary of these turns"}

Rules:
- Use only the provided input/output text. Do not invent.
- Keep concrete commands, paths, file names, decisions, errors, and results.
- If the text contains "...（省略的代码块/表格/图片）" or a "..." gap, treat the omitted part as unavailable and do not invent it.
- This is a partial summary for a later merge; do not write a final title.
- Write in the requested language.
`;

const LONG_PROMPT_CHARS = 800
const RESPONSE_HEAD_CHARS = 400
const RESPONSE_TAIL_CHARS = 400

function compressResponse(value) {
  let text = String(value ?? '')
  text = text.replace(/(`{3,}|~{3,})[\s\S]*?(?:\1|$)/g, '...（省略的代码块）')
  text = text.replace(/<pre[\s\S]*?<\/pre>/gi, '...（省略的代码块）')
  text = text.replace(/<code[^>]*>[\s\S]*?\n[\s\S]*?<\/code>/gi, '...（省略的代码块）')
  text = text.replace(/(?:^(?: {4}|\t).*(?:\r?\n|$))+/gm, '...（省略的代码块）\n')
  text = text.replace(/<table[\s\S]*?<\/table>/gi, '...（省略的表格）')
  text = text.replace(/(?:^[ \t]*\|.*\|[ \t]*(?:\r?\n|$)){2,}/gm, '...（省略的表格）\n')
  text = text.replace(/<details[\s\S]*?<\/details>/gi, '...（省略的展开内容）')
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '...（省略的图片）')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '...（省略的图片）')
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '...（省略的图片）')
  text = text.replace(/!\[[^\]]*\]/g, '...（省略的图片）')
  text = text.replace(/<a\b[^>]*href=["'][^"']+\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#][^"']*)?["'][^>]*>[\s\S]*?<\/a>/gi, '...（省略的图片）')
  text = text.replace(/<img\b[^>]*>/gi, '...（省略的图片）')
  text = text.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#][^)]*)?)\)/gi, '...（省略的图片）')
  text = text.replace(/https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#][^\s)]*)?/gi, '...（省略的图片）')
  text = text.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '...（省略的图片）')
  if (text.length <= RESPONSE_HEAD_CHARS + RESPONSE_TAIL_CHARS) return text
  return `${text.slice(0, RESPONSE_HEAD_CHARS)}\n...\n${text.slice(-RESPONSE_TAIL_CHARS)}`
}

function assertLongPrompts(rows) {
  for (const row of rows) {
    const lengths = row.turns.map(turn => String(turn.prompt ?? '').length)
    const longest = lengths.length > 0 ? Math.max(...lengths) : 0
    if (longest <= LONG_PROMPT_CHARS) continue
    const node = row.node
    if (node.titleMode === 'manual' && String(node.title ?? '').trim() !== '') continue
    throw new Error(`节点 ${node.id} 的 prompt 长度为 ${longest}，超过 ${LONG_PROMPT_CHARS} 字符；请把标题来源切到“手动”并填写标题后再生成。`)
  }
}

function selectModel(ctx, ownerSessionId) {
  const agent = ctx.agents.get(ownerSessionId)
  const selection = agent?.model.current() ?? ctx.agentDefaultModel.currentSelection()
  if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string'
    || selection.provider === '' || selection.model === '') {
    throw new Error('no model selection is available for this session')
  }
  return {
    provider: selection.provider,
    model: selection.model,
    ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
  }
}

function hashText(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex')
}

function buildChildren(rows) {
  const children = new Map(rows.map(row => [row.node.id, []]))
  for (const row of rows) {
    const parent = row.node.parentId
    if (parent !== null && children.has(parent)) children.get(parent).push(row)
  }
  return children
}

function hasEvidence(row) {
  return row.turns.some(turn => String(turn.prompt ?? '').trim() !== '' || String(turn.response ?? '').trim() !== '')
}

function assertLeaves(rows, children) {
  for (const row of rows) {
    if ((children.get(row.node.id) ?? []).length > 0) continue
    const node = row.node
    const hasManual = String(node.content ?? '').trim() !== ''
    if (hasEvidence(row) || hasManual) continue
    throw new Error(`叶子节点 ${node.id} 没有输入输出，也没有手填内容；AI 不能凭空生成，请手动填写内容。`)
  }
}

function aiNeeds(node) {
  const anonymous = isAnonymous(node)
  const needsTitle = anonymous || node.titleMode === 'ai'
  const needsContent = node.weight === 0
    ? false
    : (node.contentMode !== 'manual' || (anonymous && String(node.content ?? '').trim() === ''))
  return { needsTitle, needsContent }
}

function makeItem(row, children, note, selection) {
  const node = row.node
  const needs = aiNeeds(node)
  const childRows = children.get(node.id) ?? []
  const isParent = childRows.length > 0
  const parentContent = isParent
    ? (node.contentMode === 'original' ? compressResponse(resolveContent(row)) : resolveContent(row))
    : ''
  const titleReference = isParent
    ? ''
    : (String(node.title ?? '').trim() !== ''
      ? String(node.title)
      : (String(node.ai?.title ?? '').trim() !== '' ? node.ai.title : ''))
  const contentReference = isParent
    ? parentContent
    : (String(node.content ?? '').trim() !== '' ? resolveContent(row) : '')
  return {
    row,
    isParent,
    note: String(note ?? ''),
    model: selection,
    weight: node.weight,
    needsTitle: needs.needsTitle,
    needsContent: needs.needsContent,
    titleReference,
    contentReference,
    turns: isParent ? [] : row.turns,
    children: childRows.map(child => ({ title: nodeTitle(child) })),
    partials: [],
  }
}

function itemPrompt(item) {
  const lines = []
  const needs = [item.needsTitle ? 'title' : '', item.needsContent ? 'content' : ''].filter(Boolean)
  lines.push(`needs: ${needs.join(', ')}`)
  lines.push(`weight: ${item.weight}`)
  if (item.isParent) {
    lines.push('content_reference:')
    lines.push(item.contentReference || '(none)')
    lines.push('children_titles:')
    if (item.children.length === 0) lines.push('(none)')
    else for (const child of item.children) lines.push(`- ${child.title}`)
  } else {
    lines.push('title_reference:')
    lines.push(item.titleReference || '(none)')
    lines.push('content_reference:')
    lines.push(item.contentReference || '(none)')
    lines.push('own_input:')
    lines.push(...(item.turns.length === 0
      ? ['(none)']
      : item.turns.flatMap((turn, index) => [`--- turn ${index + 1} input ---`, String(turn.prompt ?? '')])))
    lines.push('own_output:')
    lines.push(...(item.turns.length === 0
      ? ['(none)']
      : item.turns.flatMap((turn, index) => [`--- turn ${index + 1} output ---`, compressResponse(turn.response)])))
    lines.push('children_titles:')
    lines.push('(none)')
  }
  if (item.partials.length > 0) {
    lines.push('partial_summaries:')
    for (const partial of item.partials) lines.push(`- ${partial}`)
  }
  return lines.join('\n')
}

function itemFingerprint(item) {
  const node = item.row.node
  return createHash('sha256').update(JSON.stringify({
    version: PROMPT_VERSION,
    id: node.id,
    titleMode: node.titleMode,
    contentMode: node.contentMode,
    title: node.title,
    content: node.content,
    weight: node.weight,
    note: item.note,
    model: item.model,
    intent: node.intent,
    startCondition: node.startCondition,
    needsTitle: item.needsTitle,
    needsContent: item.needsContent,
    titleReference: hashText(item.titleReference),
    contentReference: hashText(item.contentReference),
    turns: item.turns.map(turn => [turn.turn, hashText(turn.prompt), hashText(turn.response)]),
    isParent: item.isParent,
    children: item.children.map(child => hashText(child.title)),
    partials: item.partials.map(hashText),
  })).digest('hex')
}

function aiCacheValid(node, item, fingerprint) {
  return node.ai?.fingerprint === fingerprint
    && (!item.needsTitle || String(node.ai.title ?? '').trim() !== '')
    && (!item.needsContent || String(node.ai.content ?? '').trim() !== '')
}

function buildGroupUser(items) {
  const parts = ['LANGUAGE: zh', `USER_NOTE:
${items[0]?.note?.trim() || '(none)'}`, `ITEM_COUNT: ${items.length}`]
  items.forEach((item, index) => {
    parts.push(`ITEM ${index + 1}\n${itemPrompt(item)}`)
  })
  return parts.join('\n\n')
}

function splitBatches(entries) {
  const max = Math.max(12000, MAX_CALL_CHARS - AI_SYSTEM_PROMPT.length)
  const batches = []
  let current = []
  let chars = 0
  for (const entry of entries) {
    const size = itemPrompt(entry.item).length
    if (current.length > 0 && chars + size > max) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(entry)
    chars += size
    if (current.length === 1 && size > max) {
      batches.push(current)
      current = []
      chars = 0
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function chunkTurns(turns, maxChars) {
  const chunks = []
  let current = []
  let chars = 0
  for (const turn of turns) {
    const size = String(turn.prompt ?? '').length + compressResponse(turn.response).length
    if (current.length > 0 && chars + size > maxChars) {
      chunks.push(current)
      current = []
      chars = 0
    }
    current.push(turn)
    chars += size
    if (current.length === 1 && size > maxChars) {
      chunks.push(current)
      current = []
      chars = 0
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function callAi(ctx, system, user, selection, signal) {
  let text = ''
  for await (const chunk of ctx.llm.stream({
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    temperature: 0.2,
    maxTokens: 12000,
    purpose: 'skill-gen-polish',
    ...(signal === undefined ? {} : { signal }),
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error') {
        throw new Error(`LLM ${chunk.reason.failure.code}: ${chunk.reason.failure.message}`)
      }
      if (chunk.reason.kind === 'aborted') throw new Error('AI request was aborted')
    }
  }
  if (text.trim() === '') throw new Error('AI returned an empty response')
  return text
}

function parseJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI response contains no JSON object')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw new Error(`AI response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseAiItems(text, expected) {
  const raw = parseJsonObject(text)
  if (!Array.isArray(raw.items) || raw.items.length !== expected) {
    throw new Error(`AI returned ${Array.isArray(raw.items) ? raw.items.length : 'no'} items; expected ${expected}`)
  }
  const stringList = (value) => Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item : '').filter(Boolean)
    : []
  return raw.items.map(item => ({
    title: typeof item?.title === 'string' ? item.title.trim() : '',
    content: typeof item?.content === 'string' ? item.content.trim() : '',
    check: typeof item?.check === 'string' ? item.check.trim() : '',
    gotcha: typeof item?.gotcha === 'string' ? item.gotcha.trim() : '',
    do: stringList(item?.do),
    dont: stringList(item?.dont),
    examples: stringList(item?.examples),
  }))
}

function parsePartial(text) {
  const raw = parseJsonObject(text)
  if (typeof raw.content !== 'string' || raw.content.trim() === '') {
    throw new Error('partial AI response is missing content')
  }
  return raw.content.trim()
}

function applyAiItem(entry, item) {
  const node = entry.item.row.node
  const ai = { ...(node.ai ?? {}) }
  if (entry.item.needsTitle) ai.title = item.title
  if (entry.item.needsContent) ai.content = item.content
  ai.check = item.check || undefined
  ai.gotcha = item.gotcha || undefined
  ai.do = item.do.length > 0 ? item.do : undefined
  ai.dont = item.dont.length > 0 ? item.dont : undefined
  ai.examples = item.examples.length > 0 ? item.examples : undefined
  ai.fingerprint = entry.fingerprint
  ai.updatedAt = new Date().toISOString()
  node.ai = ai
}

function buildPartialUser(item, turns) {
  const lines = [
    'LANGUAGE: zh',
    `USER_NOTE:
${item.note?.trim() || '(none)'}`,
    `weight: ${item.weight}`,
    'title_reference:',
    item.titleReference || '(none)',
    'content_reference:',
    item.contentReference || '(none)',
    'turns:',
  ]
  turns.forEach((turn, index) => {
    lines.push(`--- turn ${index + 1} input ---`)
    lines.push(String(turn.prompt ?? ''))
    lines.push(`--- turn ${index + 1} output ---`)
    lines.push(compressResponse(turn.response))
  })
  return lines.join('\n')
}

async function prepareOversizedItem(ctx, entry, selection, signal) {
  const estimated = AI_SYSTEM_PROMPT.length + itemPrompt(entry.item).length
  if (estimated <= MAX_CALL_CHARS || entry.item.turns.length <= 1) return { item: entry.item, calls: 0 }
  const chunks = chunkTurns(entry.item.turns, MAX_PARTIAL_CHARS)
  if (chunks.length <= 1) return { item: entry.item, calls: 0 }
  const partials = []
  for (const chunk of chunks) {
    const user = buildPartialUser(entry.item, chunk)
    const text = await callAi(ctx, AI_PARTIAL_SYSTEM_PROMPT, user, selection, signal)
    partials.push(parsePartial(text))
  }
  return { item: { ...entry.item, turns: [], partials }, calls: chunks.length }
}

async function runAi(ctx, draft, sessions, selection, signal) {
  const tree = prepareTree(draft, sessions)
  if (tree.rows.length === 0) throw new Error('the draft has no included steps')
  const children = buildChildren(tree.rows)
  assertLeaves(tree.rows, children)
  assertLongPrompts(tree.rows)
  const depths = [...new Set(tree.rows.map(row => row.depth))].sort((a, b) => b - a)
  let calls = 0
  const levels = []
  for (const depth of depths) {
    const pending = []
    for (const row of tree.rows.filter(item => item.depth === depth)) {
      const needs = aiNeeds(row.node)
      if (!needs.needsTitle && !needs.needsContent) continue
      const item = makeItem(row, children, draft.ai?.note ?? '', selection)
      const fingerprint = itemFingerprint(item)
      if (aiCacheValid(row.node, item, fingerprint)) continue
      pending.push({ item, fingerprint })
    }
    for (const entry of pending) {
      const prepared = await prepareOversizedItem(ctx, entry, selection, signal)
      entry.item = prepared.item
      calls += prepared.calls
    }
    for (const batch of splitBatches(pending)) {
      const user = buildGroupUser(batch.map(entry => entry.item))
      const text = await callAi(ctx, AI_SYSTEM_PROMPT, user, selection, signal)
      calls += 1
      const items = parseAiItems(text, batch.length)
      batch.forEach((entry, index) => {
        if (entry.item.needsTitle && items[index].title === '') {
          throw new Error(`AI did not return a title for the item at position ${index + 1}`)
        }
        if (entry.item.needsContent && items[index].content === '') {
          throw new Error(`AI did not return content for the item at position ${index + 1}`)
        }
        applyAiItem(entry, items[index])
      })
      levels.push({ depth, count: batch.length })
    }
  }
  return { calls, levels }
}

function planAiCalls(draft, sessions, selection) {
  const tree = prepareTree(draft, sessions)
  if (tree.rows.length === 0) throw new Error('the draft has no included steps')
  const children = buildChildren(tree.rows)
  assertLeaves(tree.rows, children)
  assertLongPrompts(tree.rows)
  const depths = [...new Set(tree.rows.map(row => row.depth))].sort((a, b) => b - a)
  const calls = []
  for (const depth of depths) {
    const pending = []
    for (const row of tree.rows.filter(item => item.depth === depth)) {
      const needs = aiNeeds(row.node)
      if (!needs.needsTitle && !needs.needsContent) continue
      const item = makeItem(row, children, draft.ai?.note ?? '', selection)
      const fingerprint = itemFingerprint(item)
      if (aiCacheValid(row.node, item, fingerprint)) continue
      pending.push({ item, fingerprint })
    }
    for (const batch of splitBatches(pending)) {
      const user = buildGroupUser(batch.map(entry => entry.item))
      calls.push({
        depth,
        itemCount: batch.length,
        chars: AI_SYSTEM_PROMPT.length + user.length,
        user,
      })
    }
  }
  return {
    system: AI_SYSTEM_PROMPT,
    calls,
    totalCalls: calls.length,
    totalChars: calls.reduce((sum, call) => sum + call.chars, 0),
    note: '超大节点会额外产生 partial 调用，未计入上面的次数。',
  }
}

async function promptPreview(ctx, request, response) {
  const body = await readJson(request)
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return send(response, 400, { error: 'sessionId is required' })
  const sessions = await loadSessions(ctx, collectSessionIds(body.draft, sessionId))
  if (!sessions.has(sessionId)) return send(response, 400, { error: 'owner session is unavailable' })
  const draft = normalizeDraft(body.draft, sessionId, sessions)
  const selection = selectModel(ctx, sessionId)
  try {
    const plan = planAiCalls(draft, sessions, selection)
    send(response, 200, { model: selection, ...plan })
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

async function polishRoute(ctx, request, response) {
  const body = await readJson(request)
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return send(response, 400, { error: 'sessionId is required' })
  const sessions = await loadSessions(ctx, collectSessionIds(body.draft, sessionId))
  if (!sessions.has(sessionId)) return send(response, 400, { error: 'owner session is unavailable' })
  const draft = normalizeDraft(body.draft, sessionId, sessions)
  const selection = selectModel(ctx, sessionId)
  const result = await runAi(ctx, draft, sessions, selection, requestAbortSignal(request))
  draft.edits = [...(Array.isArray(draft.edits) ? draft.edits : []), {
    id: `edit-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    actor: 'ai',
    action: 'polish',
    calls: result.calls,
  }].slice(-200)
  await writeDraft(draft)
  send(response, 200, { draft, model: selection, ai: result })
}

function requestAbortSignal(request) {
  const controller = new AbortController()
  request.on('aborted', () => controller.abort())
  return controller.signal
}

function draftPath(ownerSessionId) {
  const safe = String(ownerSessionId).replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(dshHome(), 'skill-gen', 'drafts', `${safe}.json`)
}

async function readDraft(ownerSessionId) {
  try {
    return JSON.parse(await readFile(draftPath(ownerSessionId), 'utf8'))
  } catch {
    return null
  }
}

async function writeDraft(draft) {
  await mkdir(join(dshHome(), 'skill-gen', 'drafts'), { recursive: true })
  await writeAtomic(draftPath(draft.ownerSessionId), `${JSON.stringify(draft, null, 2)}\n`)
}

async function writeSkill(ownerSessionId, draft, sessions, requestedName, options = {}) {
  const aiUsed = options.aiUsed === true
  const aiEnabled = options.aiEnabled !== false
  const owner = sessions.get(ownerSessionId)
  const renderDraft = aiEnabled ? draft : {
    ...draft,
    nodes: draft.nodes.map(node => ({
      ...node,
      ai: undefined,
      titleMode: node.titleMode === 'ai' ? 'prompt' : node.titleMode,
    })),
  }
  const tree = prepareTree(renderDraft, sessions)
  if (tree.rows.length === 0) throw new Error('the draft has no steps to write')

  const root = join(dshHome(), 'skills')
  await mkdir(root, { recursive: true })
  const base = skillName(requestedName, ownerSessionId)
  let skill = base
  let suffix = 2
  while (await exists(join(root, skill))) skill = `${base}-${suffix++}`

  const rowById = new Map(tree.rows.map(row => [row.node.id, row]))
  const defaultEntryId = rowById.has(renderDraft.defaultEntryId) ? renderDraft.defaultEntryId : tree.rows[0].node.id
  const titleRow = tree.roots[0] || tree.rows[0]
  const title = nodeTitle(titleRow) || `Trace skill ${String(ownerSessionId).slice(-8)}`
  const whenRow = tree.rows.find(row => row.turns.length > 0) || tree.rows[0]
  const when = whenRow.turns.length > 0
    ? oneLine(whenRow.turns[0].prompt, 160)
    : oneLine(whenRow.node.intent, 160) || '当用户想复用这条工作流时。' 
  const description = `Reusable workflow derived from ${oneLine(title, 80)}`.replace(/[.。]+$/u, '')
  const sourceSessions = [...new Set(tree.rows.map(row => row.node.sessionId).filter(Boolean))]
  const steps = tree.rows.map((row, index) => ({
    id: `step-${row.number}`,
    number: row.number,
    depth: row.depth,
    parentId: row.node.parentId,
    sessionId: row.node.sessionId,
    turnIds: row.node.turnIds,
    title: nodeTitle(row),
    prompt: stepPrompt(skill, row, index, tree.rows.length > index + 1 ? tree.rows[index + 1].number : null),
    startCondition: row.node.startCondition || '',
    next: index + 1 < tree.rows.length ? `step-${tree.rows[index + 1].number}` : null,
    root: row.depth === 0,
  }))
  const manifest = {
    schemaVersion: 3,
    sessionId: ownerSessionId,
    skill,
    title,
    createdAt: new Date().toISOString(),
    generatedWith: aiUsed ? 'ai' : 'deterministic',
    roots: tree.roots.map(row => row.node.id),
    defaultEntryId,
    steps,
  }
  const markdown = renderSkill({
    skill,
    title,
    description,
    when,
    ownerSessionId,
    cwd: owner.snapshot.session.cwd ?? '',
    tree,
    defaultEntryId,
    sourceSessions,
    aiUsed,
    aiEnabled,
  })

  const dir = join(root, skill)
  await mkdir(dir, { recursive: true })
  await writeAtomic(join(dir, 'SKILL.md'), markdown)
  await writeAtomic(join(dir, 'skillgen.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { skill, path: dir, skillPath: join(dir, 'SKILL.md'), manifestPath: join(dir, 'skillgen.json'), steps }
}

function prepareTree(draft, sessions) {
  const byId = new Map(draft.nodes.map(node => [node.id, node]))
  const children = new Map()
  for (const node of draft.nodes) {
    const parentId = node.parentId !== null && byId.has(node.parentId) && node.parentId !== node.id
      ? node.parentId
      : null
    if (!children.has(parentId)) children.set(parentId, [])
    children.get(parentId).push(node)
  }
  const turnOf = (node) => {
    if (node.sessionId === null) return []
    const turnById = sessions.get(node.sessionId)?.turnById
    if (turnById === undefined) return []
    return node.turnIds.map(id => turnById.get(id)).filter(Boolean)
  }
  const included = new Map()
  const include = (node) => {
    if (included.has(node.id)) return included.get(node.id)
    included.set(node.id, false)
    const kids = (children.get(node.id) || []).filter(include)
    const isRoot = node.parentId === null || !byId.has(node.parentId)
    const ok = node.weight > 0 || isRoot || kids.length > 0
    included.set(node.id, ok)
    return ok
  }
  for (const root of children.get(null) || []) include(root)
  for (const node of draft.nodes) if (!included.has(node.id)) include(node)

  const rows = []
  const visit = (node, depth, number) => {
    if (!included.get(node.id)) return
    const kids = (children.get(node.id) || []).filter(child => included.get(child.id))
    const row = { node, depth, number, hasChildren: kids.length > 0, turns: turnOf(node) }
    rows.push(row)
    kids.forEach((child, index) => visit(child, depth + 1, `${number}.${index + 1}`))
  }
  let rootIndex = 0
  for (const root of children.get(null) || []) {
    if (!included.get(root.id)) continue
    rootIndex += 1
    visit(root, 0, String(rootIndex))
  }
  const seen = new Set(rows.map(row => row.node.id))
  for (const node of draft.nodes) {
    if (included.get(node.id) && !seen.has(node.id)) {
      rootIndex += 1
      visit(node, 0, String(rootIndex))
    }
  }
  return { rows, roots: rows.filter(row => row.depth === 0) }
}

function renderSkill({ skill, title, description, when, ownerSessionId, cwd, tree, defaultEntryId, sourceSessions, aiUsed, aiEnabled }) {
  const files = [...new Set(tree.rows.flatMap(row => row.turns.flatMap(turn => turn.files)))].slice(0, 40)
  const scriptFiles = files.filter(file => /\.(?:sh|bash|py|js|mjs|ts|cjs)$/i.test(file))
  const stepBlocks = tree.rows.map((row, index) => {
    const node = row.node
    const useAi = aiEnabled
      && String(node.ai?.content ?? '').trim() !== ''
      && (node.contentMode !== 'manual' || (node.synthetic && String(node.content ?? '').trim() === ''))
    return useAi ? renderAiStep(row, index) : renderStep(row, index)
  }).join('\n')
  const entryRows = tree.rows.filter(row => row.node.startable || row.node.id === defaultEntryId)
  const defaultNumber = tree.rows.find(row => row.node.id === defaultEntryId)?.number ?? tree.rows[0].number
  const entryBlock = [
    '## 可从哪一步开始',
    '',
    `- 默认从第 ${defaultNumber} 步开始。`,
    ...entryRows.map(row => `- 第 ${row.number} 步「${nodeTitle(row)}」：${row.node.startCondition || '无额外前提'}`),
    '',
  ].join('\n')
  const rootTitle = tree.roots.length > 1 ? '## 交付物 / 并列产物' : '## 交付物'
  const rootBlock = [
    rootTitle,
    '',
    ...tree.roots.map(row => `- 第 ${row.number} 步：${nodeTitle(row)}`),
    '',
  ].join('\n')
  const scriptBlock = scriptFiles.length === 0 ? '' : [
    '## 外部文件引用',
    '',
    '> 这些是原始 workspace 中的文件；本 skill 不复制它们，换 workspace 时路径可能失效。',
    '',
    '| 文件 |',
    '|---|',
    ...scriptFiles.map(file => `| \`${file}\` |`),
    '',
  ].join('\n')
  const sourceTurns = [...new Set(tree.rows.flatMap(row =>
    row.turns.map(turn => `${String(row.node.sessionId).slice(-8)}#${turn.turn}`)))]
  return [
    '---',
    `name: ${skill}`,
    `description: ${yamlString(description)}`,
    `whenToUse: ${yamlString(when)}`,
    'metadata:',
    `  sourceSessions: [${sourceSessions.map(id => yamlString(id)).join(', ')}]`,
    `  sourceTurns: [${sourceTurns.map(value => yamlString(value)).join(', ')}]`,
    '  generator: dsh-skill-gen/0.3',
    `  generatedWith: ${aiUsed ? 'ai' : 'deterministic'}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## 何时使用',
    '',
    when,
    '',
    '## 前提',
    '',
    `- 主 session：\`${ownerSessionId}\``,
    `- 原始 workspace：\`${cwd || '(未知)'}\``,
    ...(sourceSessions.length > 1 ? [`- 参与会话：${sourceSessions.map(id => `\`${id}\``).join('、')}`] : []),
    '',
    entryBlock,
    '## 步骤',
    '',
    stepBlocks,
    rootBlock,
    scriptBlock,
    '## 完成检查',
    '',
    '- [ ] 每一步的产物都存在。',
    '- [ ] 最终结果与原始轨迹的目标一致。',
    '',
  ].join('\n')
}

function renderAiStep(row, index) {
  const node = row.node
  const ai = node.ai ?? {}
  const title = nodeTitle(row)
  const level = Math.min(6, 3 + row.depth)
  const lines = [`${'#'.repeat(level)} ${row.number}. ${title}`, '']
  if (String(ai.content ?? '').trim() !== '') lines.push(ai.content, '')
  const weight = node.weight
  if (weight >= 2 && String(ai.check ?? '').trim() !== '') lines.push(`**检查**：${ai.check}`, '')
  if (String(ai.gotcha ?? '').trim() !== '') lines.push(`**注意**：${ai.gotcha}`, '')
  if (weight >= 3 && Array.isArray(ai.do) && ai.do.length > 0) lines.push('**要做**：', ...ai.do.map(item => `- ${item}`), '')
  if (weight >= 3 && Array.isArray(ai.dont) && ai.dont.length > 0) lines.push('**不要做**：', ...ai.dont.map(item => `- ${item}`), '')
  if (weight >= 3 && Array.isArray(ai.examples) && ai.examples.length > 0) lines.push('**示例**：', ...ai.examples.map(item => `- ${item}`), '')
  if (lines.length === 2) return renderStep(row, index)
  return lines.join('\n')
}

function renderStep(row, index) {
  const node = row.node
  const title = nodeTitle(row)
  const level = Math.min(6, 3 + row.depth)
  const heading = `${'#'.repeat(level)} ${row.number}. ${title}`
  const weight = node.weight
  if (weight === 0) return `${heading}\n`
  const detail = weight <= 1 ? 'line' : weight === 2 ? 'brief' : 'full'
  const resolved = resolveContent(row)
  const manualContent = node.contentMode === 'manual' && resolved.trim() !== ''
  const backgrounds = row.turns.map(turn => compressResponse(turn.prompt)).filter(Boolean)
  const actions = manualContent
    ? [resolved]
    : row.turns.map(turn => compressResponse(turn.response)).filter(Boolean)
  const artifacts = Array.isArray(node.artifacts) ? node.artifacts.filter(Boolean) : []
  const sources = row.turns.map(turn => `${String(node.sessionId).slice(-8)} · turn ${turn.turn}`)
  if (detail === 'line') {
    const summary = node.intent || actions[0] || backgrounds[0] || compressResponse(resolved) || '按原始轨迹执行这一步。'
    return `${heading}\n\n${summary}\n`
  }
  const lines = [heading, '']
  if (node.synthetic) lines.push('- 合成步骤（没有直接轨迹证据）')
  if (sources.length > 0) lines.push(`- 来源：${sources.join('；')}`)
  if (node.intent !== '') lines.push(`**意图**：${node.intent}`)
  if (node.startable) lines.push(`- 开始条件：${node.startCondition || '无'}`)
  if (detail === 'brief') {
    if (backgrounds[0]) lines.push(`- 触发/输入：${backgrounds[0]}`)
    if (actions[0]) lines.push(`- 执行：${actions[0]}`)
    lines.push('- 检查：确认这一步的结果已经落盘或已经验证。', '')
    return lines.join('\n')
  }
  const backgroundLimit = weight >= 4 ? 4 : 3
  const actionLimit = weight >= 4 ? 4 : 3
  for (const background of backgrounds.slice(0, backgroundLimit)) lines.push(`- 背景/输入：${background}`)
  if (manualContent) lines.push(`- 执行：${resolved}`)
  else for (const action of actions.slice(0, actionLimit)) lines.push(`- 执行：${action}`)
  if (artifacts.length > 0) lines.push(`- 产物：${artifacts.join('、')}`)
  if (node.notes !== '') lines.push(`- 注意：${oneLine(node.notes, 400)}`)
  lines.push('- 检查：确认这一步的结果已经落盘或已经验证。', '')
  return lines.join('\n')
}

function stepPrompt(skill, row, index, nextNumber) {
  const condition = row.node.startable && row.node.startCondition !== ''
    ? ` 开始条件：${row.node.startCondition}。`
    : ''
  return `[skill: ${skill} · step-${row.number}] 请加载 skill \`${skill}\`，从第 ${row.number} 步「${nodeTitle(row)}」开始。${condition}当前输入：`
}

function nodeTitle(row) {
  const node = row.node
  const fallback = (row.turns[0] ? stepTitle(row.turns[0]) : '') || node.title.trim() || `步骤 ${row.number}`
  if (node.synthetic && node.title.trim() === '' && (node.ai?.title ?? '').trim() !== '') return node.ai.title
  if (node.titleMode === 'manual') return node.title.trim() || fallback
  if (node.titleMode === 'ai') return node.ai?.title?.trim() || fallback
  return (row.turns[0] ? stepTitle(row.turns[0]) : '') || fallback
}

function resolveContent(row) {
  const node = row.node
  const original = row.turns.map(turn => turn.response).filter(Boolean).join('\n\n')
  if (node.synthetic && node.content.trim() === '' && (node.ai?.content ?? '').trim() !== '') return node.ai.content
  if (node.contentMode === 'manual') return node.content.trim() || original
  if (node.contentMode === 'ai') return node.ai?.content?.trim() || original
  return original
}

function isAnonymous(node) {
  return node.synthetic && node.title.trim() === '' && (node.ai?.title ?? '').trim() === ''
}

function extractTurns(events) {
  const turns = []
  let current
  const close = (seq) => {
    if (current === undefined) return
    const end = Number.isFinite(seq) ? Math.max(seq, current.seqStart) : current.seqStart
    current.seqEnd = Math.max(current.seqEnd, end)
    current = undefined
  }
  for (const event of events) {
    if (event.type === 'turn/start') {
      close(event.seq - 1)
      const turn = Number(event.data?.turn ?? turns.length + 1)
      current = {
        id: String(turn),
        turn,
        seqStart: event.seq,
        seqEnd: event.seq,
        prompt: '',
        response: '',
        tools: [],
        files: [],
        commands: [],
        errors: [],
      }
      turns.push(current)
      continue
    }
    if (event.type === 'turn/end') {
      close(event.seq)
      continue
    }
    if (current === undefined) continue
    if (event.type === 'user/message') {
      if (current.prompt !== '') continue
      if (event.data?.source?.kind !== 'user') continue
      current.prompt = textOf(event.data.content).slice(0, MAX_TEXT)
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event.data?.message?.content)
      if (text.trim() !== '') current.response = text.slice(0, MAX_TEXT)
      continue
    }
    if (event.type === 'tool/call') {
      const tool = typeof event.data?.name === 'string' ? event.data.name : ''
      if (tool && !current.tools.includes(tool)) current.tools.push(tool)
      const args = parseJson(event.data?.arguments)
      const file = args?.file_path ?? args?.path
      if ((tool === 'write' || tool === 'edit') && typeof file === 'string' && !current.files.includes(file)) {
        current.files.push(file)
      }
      if (tool === 'bash' && typeof args?.command === 'string') {
        current.commands.push(args.command.slice(0, 300))
      }
      continue
    }
    if (event.type === 'tool/result' && event.data?.error) {
      current.errors.push(String(event.data.error.reason ?? event.data.error.code ?? 'error').slice(0, 300))
    }
  }
  close(events.length === 0 ? 0 : events[events.length - 1].seq)
  return turns.filter(turn => turn.prompt !== '' || turn.response !== '')
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

function parseJson(value) {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function sessionTitle(snapshot) {
  const cwd = snapshot.session.cwd ?? ''
  const name = cwd ? basename(cwd) : 'session'
  return `${name} · ${String(snapshot.session.id).slice(-8)}`
}

function skillName(requestedName, sessionId) {
  const raw = typeof requestedName === 'string' ? requestedName : ''
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  if (cleaned !== '' && SKILL_NAME.test(cleaned)) return cleaned
  return `trace-skill-${String(sessionId).replace(/[^a-zA-Z0-9]/g, '').slice(-8).toLowerCase()}`
}

function stepTitle(turn) {
  return oneLine(turn.prompt, 48) || oneLine(turn.response, 48)
}

function oneLine(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('，'), cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('：'))
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,，。;；:：-]+$/u, '')}…`
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function writeAtomic(path, content) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, body) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
