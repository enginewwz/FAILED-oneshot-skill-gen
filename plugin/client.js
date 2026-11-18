// Browser half: header action, generator panel, and composer step dock.
window.__ModuleLoader__.load({
  id: 'dsh-skill-gen',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/skill-gen/api'

    const COLORS = {
      border: 'var(--dsh-border, #d0d7de)',
      surface: 'var(--dsh-surface, #ffffff)',
      text: 'var(--dsh-text, #1f2328)',
      muted: 'var(--dsh-muted, #57606a)',
      accent: 'var(--dsh-accent, #0969da)',
      danger: '#cf222e',
    }

    const smallButton = {
      font: 'inherit',
      fontSize: 12,
      color: 'inherit',
      background: 'transparent',
      border: `1px solid ${COLORS.border}`,
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      lineHeight: 1.4,
    }

    const inputStyle = {
      font: 'inherit',
      fontSize: 12,
      color: 'inherit',
      background: 'transparent',
      border: `1px solid ${COLORS.border}`,
      borderRadius: 5,
      padding: '3px 6px',
      minWidth: 0,
    }

    const cardStyle = {
      border: `1px solid ${COLORS.border}`,
      borderRadius: 10,
      padding: 12,
      minWidth: 0,
    }

    const tinyButton = { ...smallButton, padding: '2px 6px', fontSize: 11 }
    const primaryButton = {
      ...smallButton,
      background: COLORS.accent,
      color: '#fff',
      borderColor: COLORS.accent,
      padding: '8px 14px',
      fontSize: 13,
    }
    const labelStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 12,
      color: COLORS.muted,
    }
    const preStyle = {
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      background: 'rgba(127,127,127,.08)',
      borderRadius: 6,
      padding: 8,
      fontSize: 12,
      maxHeight: 180,
      overflow: 'auto',
    }

    const panelStyle = {
      height: '100%',
      overflow: 'auto',
      boxSizing: 'border-box',
      padding: 24,
      color: COLORS.text,
    }

    const rowStyle = { display: 'flex', alignItems: 'center', gap: 8 }
    const mutedStyle = { color: COLORS.muted, fontSize: 12 }

    async function api(path, options) {
      const response = await fetch(API + path, {
        credentials: 'same-origin',
        ...options,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }

    function titleOf(turn) {
      const line = String(turn.prompt || '').split('\n')[0].trim()
      return line === '' ? `Turn ${turn.turn}` : line.slice(0, 100)
    }

    function HeaderAction({ open }) {
      return h('button', {
        type: 'button',
        onClick: open,
        title: '从当前会话生成 skill',
        style: smallButton,
      }, '生成 Skill')
    }

    async function saveDraft(sessionId, draft) {
      return api('/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, draft }),
      })
    }

    const WEIGHT_LABELS = ['省略', '一行', '默认', '详细', '重点']
    const TITLE_MODES = [['prompt', '原始 prompt'], ['ai', 'AI 总结'], ['manual', '手动']]
    const CONTENT_MODES = [['original', '原始输出'], ['ai', 'AI 总结'], ['manual', '手动']]

    function sessionShort(id) {
      return String(id ?? '').slice(-8)
    }

    function sessionLabel(session, ownerSessionId) {
      const cwd = String(session.cwd || '')
      const base = cwd.split('/').filter(Boolean).pop() || 'session'
      const title = session.title || base
      return `${title}${session.id === ownerSessionId ? '（当前）' : ` · ${sessionShort(session.id)}`}`
    }

    function initialDraft(ownerSessionId, turns) {
      const nodes = turns.map((turn, index) => ({
        id: `n${index + 1}`,
        sessionId: ownerSessionId,
        turnIds: [turn.id],
        parentId: index === 0 ? null : 'n1',
        titleMode: 'prompt',
        title: '',
        contentMode: 'original',
        content: '',
        intent: '',
        weight: 2,
        startable: false,
        startCondition: '',
        artifacts: [],
        notes: '',
        synthetic: false,
      }))
      return {
        schemaVersion: 3,
        ownerSessionId,
        nodes,
        defaultEntryId: nodes[0]?.id,
        ai: { enabled: true, note: '' },
        edits: [],
      }
    }

    function normalizeClientDraft(raw, ownerSessionId) {
      const legacy = !(Number(raw?.schemaVersion) >= 2)
      const nodes = []
      for (const [index, value] of (Array.isArray(raw?.nodes) ? raw.nodes : []).entries()) {
        if (value === null || typeof value !== 'object') continue
        const turnIds = Array.isArray(value.turnIds) ? value.turnIds.map(String) : []
        const synthetic = value.synthetic === true || turnIds.length === 0
        const title = typeof value.title === 'string' ? value.title : ''
        const titleMode = value.titleMode === 'ai' || value.titleMode === 'manual' || value.titleMode === 'prompt'
          ? value.titleMode
          : (title !== '' || synthetic ? 'manual' : 'prompt')
        const content = typeof value.content === 'string' ? value.content : ''
        const contentMode = value.contentMode === 'ai' || value.contentMode === 'manual' || value.contentMode === 'original'
          ? value.contentMode
          : (synthetic && content === '' ? 'manual' : 'original')
        nodes.push({
          id: typeof value.id === 'string' && value.id !== '' ? value.id : `n${index + 1}`,
          sessionId: synthetic ? null : (typeof value.sessionId === 'string' ? value.sessionId : ownerSessionId),
          turnIds,
          parentId: typeof value.parentId === 'string' ? value.parentId : null,
          titleMode,
          title,
          contentMode,
          content,
          ai: value.ai !== null && typeof value.ai === 'object' ? value.ai : undefined,
          intent: typeof value.intent === 'string' ? value.intent : '',
          weight: Number.isInteger(value.weight) && value.weight >= 0 && value.weight <= 4 ? value.weight : 2,
          startable: value.startable === true,
          startCondition: typeof value.startCondition === 'string' ? value.startCondition : '',
          artifacts: Array.isArray(value.artifacts) ? value.artifacts : [],
          notes: typeof value.notes === 'string' ? value.notes : '',
          synthetic,
        })
      }
      const ids = new Set(nodes.map(node => node.id))
      if (legacy && nodes.length > 1) {
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
      return {
        schemaVersion: 3,
        ownerSessionId,
        nodes,
        ...(defaultEntryId === undefined ? {} : { defaultEntryId }),
        ai: {
          enabled: raw?.ai?.enabled !== false,
          note: typeof raw?.ai?.note === 'string' ? raw.ai.note : '',
          ...(raw?.ai?.skill && typeof raw.ai.skill === 'object' ? { skill: raw.ai.skill } : {}),
        },
        edits: Array.isArray(raw?.edits) ? raw.edits.slice(-200) : [],
      }
    }

    function parentOf(node, ids) {
      return node.parentId !== null && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null
    }

    function treeRows(nodes) {
      const ids = new Set(nodes.map(node => node.id))
      const byParent = new Map()
      for (const node of nodes) {
        const parent = parentOf(node, ids)
        if (!byParent.has(parent)) byParent.set(parent, [])
        byParent.get(parent).push(node)
      }
      const rows = []
      const visited = new Set()
      const visit = (parent, depth, prefix) => {
        const children = byParent.get(parent) || []
        children.forEach((node, index) => {
          if (visited.has(node.id)) return
          visited.add(node.id)
          const number = prefix ? `${prefix}.${index + 1}` : String(index + 1)
          rows.push({ node, depth, number })
          visit(node.id, depth + 1, number)
        })
      }
      visit(null, 0, '')
      for (const node of nodes) {
        if (visited.has(node.id)) continue
        visited.add(node.id)
        rows.push({ node, depth: 0, number: '?' })
      }
      return rows
    }

    function descendantsOf(nodes, id) {
      const descendants = new Set()
      let changed = true
      while (changed) {
        changed = false
        for (const node of nodes) {
          if (node.parentId === null || descendants.has(node.id)) continue
          if (node.parentId === id || descendants.has(node.parentId)) {
            descendants.add(node.id)
            changed = true
          }
        }
      }
      return descendants
    }

    function apply(ctx) {
      const target = { sessionId: undefined, listeners: new Set() }
      const targetSource = {
        getSnapshot: () => target.sessionId,
        subscribe: (listener) => {
          target.listeners.add(listener)
          return () => { target.listeners.delete(listener) }
        },
      }
      const openPanel = (sessionId) => {
        target.sessionId = sessionId
        for (const listener of [...target.listeners]) listener()
        ctx.layout.selectPanel('skill-gen')
      }

      function Panel({ useTarget, back }) {
        const ownerSessionId = useTarget(value => value)
        const [sessions, setSessions] = React.useState([])
        const [sourceSessionId, setSourceSessionId] = React.useState('')
        const [turnsCache, setTurnsCache] = React.useState({})
        const [draft, setDraft] = React.useState(null)
        const [selected, setSelected] = React.useState(() => new Set())
        const [mountId, setMountId] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const [saveState, setSaveState] = React.useState('idle')
        const [busy, setBusy] = React.useState(false)
        const [result, setResult] = React.useState(null)
        const [aiWarning, setAiWarning] = React.useState('')
        const [promptPreview, setPromptPreview] = React.useState(null)
        const [reload, setReload] = React.useState(0)
        const loadingSessions = React.useRef(new Set())
        const failedSessions = React.useRef(new Set())

        React.useEffect(() => {
          if (!ownerSessionId) {
            setSessions([]); setTurnsCache({}); setDraft(null); setSelected(new Set())
            setSourceSessionId(''); setMountId(null); setError('')
            return
          }
          let alive = true
          setLoading(true); setError(''); setNotice(''); setResult(null); setSaveState('idle')
          loadingSessions.current = new Set()
          failedSessions.current = new Set()
          Promise.all([
            api('/sessions').catch(() => ({ sessions: [] })),
            api(`/turns?sessionId=${encodeURIComponent(ownerSessionId)}`),
            api(`/draft?sessionId=${encodeURIComponent(ownerSessionId)}`),
          ]).then(([sessionData, turnData, draftData]) => {
            if (!alive) return
            const ownerTurns = Array.isArray(turnData.turns) ? turnData.turns : []
            let list = Array.isArray(sessionData.sessions) ? sessionData.sessions : []
            if (!list.some(item => item.id === ownerSessionId)) {
              list = [{ id: ownerSessionId, title: turnData.title || '', cwd: turnData.cwd || '' }, ...list]
            }
            list = [
              ...list.filter(item => item.id === ownerSessionId),
              ...list.filter(item => item.id !== ownerSessionId),
            ]
            let nextDraft = draftData.draft
            if (!nextDraft || !Array.isArray(nextDraft.nodes)) nextDraft = initialDraft(ownerSessionId, ownerTurns)
            nextDraft = normalizeClientDraft(nextDraft, ownerSessionId)
            setSessions(list)
            setTurnsCache({ [ownerSessionId]: turnData })
            setDraft(nextDraft)
            setSourceSessionId(ownerSessionId)
            setSelected(new Set())
            setMountId(null)
            setLoading(false)
            loadingSessions.current.add(ownerSessionId)
          }).catch(fetchError => {
            if (!alive) return
            setLoading(false); setError(fetchError.message)
          })
          return () => { alive = false }
        }, [ownerSessionId, reload])

        React.useEffect(() => {
          if (!ownerSessionId || !sourceSessionId || turnsCache[sourceSessionId]) return
          let alive = true
          api(`/turns?sessionId=${encodeURIComponent(sourceSessionId)}`)
            .then(data => {
              if (!alive) return
              setTurnsCache(previous => previous[sourceSessionId] ? previous : { ...previous, [sourceSessionId]: data })
            })
            .catch(fetchError => {
              if (!alive) return
              setNotice(fetchError.message)
              setSourceSessionId(ownerSessionId)
            })
          return () => { alive = false }
        }, [ownerSessionId, sourceSessionId, turnsCache])

        React.useEffect(() => {
          if (!draft) return
          for (const node of draft.nodes) {
            const sessionId = node.sessionId
            if (!sessionId || turnsCache[sessionId] || loadingSessions.current.has(sessionId) || failedSessions.current.has(sessionId)) continue
            loadingSessions.current.add(sessionId)
            api(`/turns?sessionId=${encodeURIComponent(sessionId)}`)
              .then(data => setTurnsCache(previous => previous[sessionId] ? previous : { ...previous, [sessionId]: data }))
              .catch(() => { failedSessions.current.add(sessionId) })
              .finally(() => { loadingSessions.current.delete(sessionId) })
          }
        }, [draft, turnsCache])

        React.useEffect(() => {
          if (!draft || !ownerSessionId) return
          setSaveState('saving')
          const timer = window.setTimeout(() => {
            saveDraft(ownerSessionId, draft)
              .then(() => { setSaveState('saved'); setNotice('') })
              .catch(saveError => { setSaveState('error'); setNotice(saveError.message) })
          }, 700)
          return () => window.clearTimeout(timer)
        }, [draft, ownerSessionId])

        const sourceData = turnsCache[sourceSessionId]
        const sourceTurns = Array.isArray(sourceData?.turns) ? sourceData.turns : []
        const rows = draft ? treeRows(draft.nodes) : []
        const rowById = new Map(rows.map(row => [row.node.id, row]))
        const nodeIds = new Set((draft?.nodes || []).map(node => node.id))
        const roots = rows.filter(row => row.depth === 0)
        const used = new Set()
        for (const row of rows) {
          if (!row.node.sessionId) continue
          for (const turnId of row.node.turnIds) used.add(`${row.node.sessionId}:${turnId}`)
        }
        const usedSource = new Set(
          [...used].filter(key => sourceSessionId !== '' && key.startsWith(`${sourceSessionId}:`))
            .map(key => key.slice(sourceSessionId.length + 1)),
        )
        const effectiveMountId = mountId !== null && rowById.has(mountId) ? mountId : null
        const mountRow = effectiveMountId === null ? undefined : rowById.get(effectiveMountId)
        const stepCount = rows.length
        const saveLabel = saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败' : ''
        const ownerSession = sessions.find(item => item.id === ownerSessionId)
        const sourceSession = sessions.find(item => item.id === sourceSessionId)
        const ownerTitle = ownerSession?.title || ownerSession?.cwd?.split('/').filter(Boolean).pop() || sessionShort(ownerSessionId)

        const turnById = (node, turnId) => {
          if (!node.sessionId) return undefined
          const data = turnsCache[node.sessionId]
          return data?.turns?.find(turn => turn.id === turnId)
        }
        const firstTurnOf = (node) => {
          for (const turnId of node.turnIds) {
            const turn = turnById(node, turnId)
            if (turn) return turn
          }
          return undefined
        }
        const nodeTitle = (node) => {
          const turn = firstTurnOf(node)
          const fallback = turn ? titleOf(turn) : '未命名步骤'
          if (node.synthetic && String(node.title ?? '').trim() === '' && String(node.ai?.title ?? '').trim() !== '') return node.ai.title
          if (node.titleMode === 'manual') return String(node.title ?? '').trim() || fallback
          if (node.titleMode === 'ai') return String(node.ai?.title ?? '').trim() || fallback
          return fallback
        }
        const nodeContent = (node) => {
          const turn = firstTurnOf(node)
          const original = turn?.response || ''
          if (node.synthetic && String(node.content ?? '').trim() === '' && String(node.ai?.content ?? '').trim() !== '') return node.ai.content
          if (node.contentMode === 'manual') return String(node.content ?? '').trim() || original
          if (node.contentMode === 'ai') return String(node.ai?.content ?? '').trim() || original
          return original
        }
        const isAnonymous = (node) => node.synthetic
          && String(node.title ?? '').trim() === ''
          && String(node.ai?.title ?? '').trim() === ''
        const recordEdit = (nodeId, field, value) => mutate(current => ({
          ...current,
          edits: [...(Array.isArray(current.edits) ? current.edits : []), {
            id: `edit-${Date.now().toString(36)}`,
            at: new Date().toISOString(),
            actor: 'human',
            nodeId,
            field,
            value: String(value ?? '').slice(0, 4000),
          }].slice(-200),
        }))
        const nodeTurnLabels = (node) => {
          if (node.synthetic) return ['合成节点']
          return node.turnIds.map(turnId => {
            const turn = turnById(node, turnId)
            return `${sessionShort(node.sessionId)} · #${turn ? turn.turn : turnId}`
          })
        }
        const siblingsOf = (node) => {
          const parent = parentOf(node, nodeIds)
          return draft.nodes.filter(item => parentOf(item, nodeIds) === parent)
        }

        const mutate = (fn) => setDraft(current => current ? fn(current) : current)
        const updateNode = (id, patch) => mutate(current => ({
          ...current,
          nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch } : node),
        }))

        const toggleTurn = (id) => setSelected(previous => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id); else next.add(id)
          return next
        })

        const addNode = () => {
          const available = [...selected].filter(id => !usedSource.has(id))
          if (available.length === 0) { setNotice('先勾选未使用的 turn'); return }
          const first = sourceTurns.find(turn => turn.id === available[0])
          const node = {
            id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            sessionId: sourceSessionId,
            turnIds: available,
            parentId: effectiveMountId,
            titleMode: 'prompt',
            title: first ? titleOf(first).slice(0, 80) : '',
            contentMode: 'original',
            content: '',
            intent: '',
            weight: 2,
            startable: false,
            startCondition: '',
            artifacts: [],
            notes: '',
            synthetic: false,
          }
          mutate(current => ({
            ...current,
            nodes: [...current.nodes, node],
            defaultEntryId: current.defaultEntryId || node.id,
          }))
          setSelected(new Set())
          setNotice(`已加入 ${available.length} 个 turn`)
        }

        const addSynthetic = (parentId) => {
          const node = {
            id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            sessionId: null,
            turnIds: [],
            parentId: parentId ?? null,
            titleMode: 'manual',
            title: parentId ? '新中间节点' : '新根节点',
            contentMode: 'manual',
            content: '',
            intent: '',
            weight: 2,
            startable: false,
            startCondition: '',
            artifacts: [],
            notes: '',
            synthetic: true,
          }
          mutate(current => ({
            ...current,
            nodes: [...current.nodes, node],
            defaultEntryId: current.defaultEntryId || node.id,
          }))
          setNotice('已新建合成节点')
        }

        const removeSubtree = (node) => {
          const descendants = descendantsOf(draft.nodes, node.id)
          const message = descendants.size > 0
            ? `删除「${nodeTitle(node)}」及其 ${descendants.size} 个子节点？`
            : `删除「${nodeTitle(node)}」？`
          if (!window.confirm(message)) return
          const remove = new Set([node.id, ...descendants])
          mutate(current => {
            const nodes = current.nodes.filter(item => !remove.has(item.id))
            const defaultEntryId = remove.has(current.defaultEntryId)
              ? (nodes.find(item => item.weight > 0 || item.parentId === null) || nodes[0])?.id
              : current.defaultEntryId
            return { ...current, nodes, defaultEntryId }
          })
          if (remove.has(mountId)) setMountId(null)
          setSelected(new Set())
        }

        const changeParent = (node, parentId) => {
          if (parentId === node.id) return
          if (parentId !== null && descendantsOf(draft.nodes, node.id).has(parentId)) return
          updateNode(node.id, { parentId: parentId === '' ? null : parentId })
        }

        const moveNode = (node, delta) => {
          mutate(current => {
            const ids = new Set(current.nodes.map(item => item.id))
            const parent = parentOf(node, ids)
            const siblings = current.nodes.filter(item => parentOf(item, ids) === parent)
            const position = siblings.findIndex(item => item.id === node.id)
            const target = siblings[position + delta]
            if (!target) return current
            const from = current.nodes.findIndex(item => item.id === node.id)
            const to = current.nodes.findIndex(item => item.id === target.id)
            const nodes = [...current.nodes]
            const [moved] = nodes.splice(from, 1)
            nodes.splice(to, 0, moved)
            return { ...current, nodes }
          })
        }

        const setWeight = (node, value) => updateNode(node.id, { weight: Number(value) })
        const setStartable = (node, value) => updateNode(node.id, {
          startable: value,
          ...(value ? {} : { startCondition: '' }),
        })
        const setDefaultEntry = (node) => mutate(current => ({ ...current, defaultEntryId: node.id }))

        const clearNodes = () => {
          if (!window.confirm('清空所有步骤？')) return
          mutate(current => ({ ...current, nodes: [], defaultEntryId: undefined }))
          setMountId(null)
          setSelected(new Set())
        }

        const aiEnabled = draft?.ai?.enabled !== false
        const anonymousRows = rows.filter(row => isAnonymous(row.node))
        const childCounts = new Map(rows.map(row => [row.node.id, 0]))
        for (const row of rows) {
          if (row.node.parentId !== null && childCounts.has(row.node.parentId)) {
            childCounts.set(row.node.parentId, childCounts.get(row.node.parentId) + 1)
          }
        }
        const blankLeafRows = rows.filter(row => {
          if ((childCounts.get(row.node.id) ?? 0) > 0) return false
          const node = row.node
          return !Array.isArray(node.turnIds) || (node.turnIds.length === 0
            && String(node.content ?? '').trim() === '')
        })
        const longPromptRows = rows.filter(row => {
          const prompts = (row.node.turnIds ?? [])
            .map(turnId => turnById(row.node, turnId)?.prompt)
            .filter(value => typeof value === 'string')
          return prompts.some(prompt => prompt.length > 800)
            && (row.node.titleMode !== 'manual' || String(row.node.title ?? '').trim() === '')
        })

        const toggleAi = (enabled) => mutate(current => ({
          ...current,
          ai: { ...(current.ai ?? {}), enabled, note: current.ai?.note ?? '' },
        }))
        const setAiNote = (note) => mutate(current => ({
          ...current,
          ai: { ...(current.ai ?? {}), enabled: current.ai?.enabled !== false, note },
        }))
        const showPrompt = async () => {
          if (!draft) return
          setPromptPreview(null)
          try {
            const data = await api('/prompt-preview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: ownerSessionId, draft }),
            })
            setPromptPreview(data)
          } catch (previewError) {
            setNotice(previewError.message)
          }
        }

        const generate = async () => {
          if (!draft || draft.nodes.length === 0 || busy) return
          if (blankLeafRows.length > 0) {
            setNotice('存在空白叶子节点：叶子没有输入输出时只能手填内容，AI 不能凭空生成。')
            return
          }
          if (longPromptRows.length > 0) {
            setNotice('存在超过 800 字符的长 prompt：请把这些节点的标题来源切到“手动”并填写标题。')
            return
          }
          if (!aiEnabled && anonymousRows.length > 0) {
            setNotice('存在匿名节点：请先填写标题，或启用 AI 润色。')
            return
          }
          setBusy(true); setResult(null); setAiWarning(''); setNotice('')
          try {
            const written = await api('/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: ownerSessionId, draft, ai: aiEnabled }),
            })
            setResult(written)
            setAiWarning(written.ai?.warning || '')
            if (written.draft) setDraft(written.draft)
            setSaveState('saved')
          } catch (generateError) {
            setNotice(generateError.message)
          } finally {
            setBusy(false)
          }
        }

        const goBack = async () => {
          if (draft && ownerSessionId) {
            try { await saveDraft(ownerSessionId, draft) } catch { /* keep local state */ }
          }
          back()
        }

        const reloadData = async () => {
          if (draft && ownerSessionId) {
            try { await saveDraft(ownerSessionId, draft) } catch { /* reload server state */ }
          }
          loadingSessions.current = new Set()
          failedSessions.current = new Set()
          setReload(value => value + 1)
        }

        if (!ownerSessionId) return h('div', { style: panelStyle }, h('p', null, '没有目标会话，请从会话头部的“生成 Skill”打开。'))
        if (loading) return h('div', { style: panelStyle }, h('p', null, '读取会话…'))
        if (error) return h('div', { style: panelStyle }, h('p', { style: { color: COLORS.danger } }, error))
        if (!draft) return h('div', { style: panelStyle }, h('p', null, '读取草稿…'))

        const column = { ...cardStyle, padding: 10 }
        const columnScroll = { maxHeight: '68vh', overflow: 'auto' }

        return h('div', { style: panelStyle },
          h('div', { style: { ...rowStyle, justifyContent: 'space-between', marginBottom: 10 } },
            h('div', null,
              h('h1', { style: { fontSize: 20, margin: 0 } }, '生成 Skill'),
              h('div', { style: mutedStyle }, `${ownerTitle} · ${stepCount} 步 · ${roots.length} 根${saveLabel ? ` · ${saveLabel}` : ''}`),
            ),
            h('div', { style: rowStyle },
              h('button', { type: 'button', style: smallButton, onClick: reloadData }, '重新加载'),
              h('button', { type: 'button', style: smallButton, onClick: goBack }, '返回对话'),
            ),
          ),
          notice !== '' && h('p', { style: { color: COLORS.muted, fontSize: 12 } }, notice),
          h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'minmax(230px, 0.85fr) minmax(380px, 1.7fr) minmax(250px, 1fr)',
              gap: 12,
              alignItems: 'start',
            },
          },
            h('section', { style: column },
              h('div', { style: { ...rowStyle, justifyContent: 'space-between', marginBottom: 6 } },
                h('strong', null, '备选 Turns'),
                h('span', mutedStyle, `${sourceTurns.length}`),
              ),
              h('select', {
                value: sourceSessionId,
                onChange: event => { setSourceSessionId(event.target.value); setSelected(new Set()) },
                style: { ...inputStyle, width: '100%', marginBottom: 6 },
              },
                sessions.map(item => h('option', { key: item.id, value: item.id }, sessionLabel(item, ownerSessionId))),
              ),
              h('div', { style: { ...mutedStyle, marginBottom: 6, wordBreak: 'break-all' } },
                sourceSession?.cwd || sourceData?.cwd || '',
              ),
              h('div', { style: { ...rowStyle, flexWrap: 'wrap', marginBottom: 6 } },
                h('button', {
                  type: 'button', style: tinyButton,
                  onClick: () => setSelected(new Set(sourceTurns.filter(turn => !usedSource.has(turn.id)).map(turn => turn.id))),
                }, '全选可用'),
                h('button', { type: 'button', style: tinyButton, onClick: () => setSelected(new Set()) }, '清空'),
                h('button', {
                  type: 'button', style: smallButton, onClick: addNode, disabled: selected.size === 0,
                }, `加入中间（${selected.size}）`),
              ),
              h('div', { style: { ...mutedStyle, marginBottom: 6 } },
                `挂载到：${mountRow ? `${mountRow.number} ${nodeTitle(mountRow.node)}` : '顶层根节点'}`,
              ),
              h('div', { style: columnScroll },
                !sourceData && h('p', { style: mutedStyle }, '读取 session…'),
                sourceData && sourceTurns.length === 0 && h('p', { style: mutedStyle }, '这个会话没有可用 turn。'),
                sourceTurns.map(turn => {
                  const isUsed = usedSource.has(turn.id)
                  return h('div', {
                    key: turn.id,
                    style: { padding: '6px 0', borderBottom: `1px solid ${COLORS.border}`, opacity: isUsed ? 0.55 : 1 },
                  },
                    h('label', { style: { ...rowStyle, alignItems: 'flex-start', cursor: isUsed ? 'default' : 'pointer' } },
                      h('input', {
                        type: 'checkbox',
                        checked: selected.has(turn.id),
                        disabled: isUsed,
                        onChange: () => toggleTurn(turn.id),
                        style: { marginTop: 3 },
                      }),
                      h('div', { style: { flex: 1, minWidth: 0 } },
                        h('div', { style: { fontWeight: 600, fontSize: 12 } }, `#${turn.turn} ${titleOf(turn)}`),
                        h('div', { style: { ...mutedStyle, fontSize: 11 } },
                          `${turn.tools.length} tools · ${turn.files.length} files`,
                          isUsed ? ' · 已用' : '',
                        ),
                        h('details', { style: { marginTop: 2 } },
                          h('summary', { style: { cursor: 'pointer', ...mutedStyle, fontSize: 11 } }, '展开'),
                          h('pre', { style: preStyle }, turn.prompt || '(无 prompt)'),
                          h('pre', { style: preStyle }, turn.response || '(无回复)'),
                        ),
                      ),
                    ),
                  )
                }),
              ),
            ),
            h('section', { style: column },
              h('div', { style: { ...rowStyle, justifyContent: 'space-between', marginBottom: 6 } },
                h('strong', null, '挂载关系'),
                h('span', mutedStyle, `${roots.length} 根`),
              ),
              h('div', { style: { ...rowStyle, flexWrap: 'wrap', marginBottom: 6 } },
                h('span', { style: { ...mutedStyle, fontSize: 11 } },
                  `挂载点：${mountRow ? `${mountRow.number} ${nodeTitle(mountRow.node)}` : '顶层'}`),
                h('button', { type: 'button', style: tinyButton, onClick: () => setMountId(null) }, '挂到顶层'),
                h('button', { type: 'button', style: tinyButton, onClick: () => addSynthetic(null) }, '新建根节点'),
                h('button', {
                  type: 'button', style: tinyButton, disabled: effectiveMountId === null,
                  onClick: () => addSynthetic(effectiveMountId),
                }, '新建子节点'),
                h('button', { type: 'button', style: tinyButton, onClick: clearNodes, disabled: stepCount === 0 }, '清空'),
              ),
              h('div', { style: columnScroll },
                stepCount === 0 && h('p', { style: mutedStyle }, '从左侧加入 turn，或在上面新建一个合成根节点。'),
                rows.map(row => {
                  const node = row.node
                  const descendants = descendantsOf(draft.nodes, node.id)
                  const parentOptions = rows.filter(item =>
                    item.node.id !== node.id && !descendants.has(item.node.id))
                  const siblings = siblingsOf(node)
                  const position = siblings.findIndex(item => item.id === node.id)
                  const isMount = effectiveMountId === node.id
                  return h('div', {
                    key: node.id,
                    style: {
                      marginLeft: row.depth * 16,
                      border: `1px solid ${isMount ? COLORS.accent : COLORS.border}`,
                      borderRadius: 8,
                      padding: 8,
                      marginBottom: 8,
                      background: isMount ? 'rgba(9,105,218,.06)' : 'rgba(127,127,127,.03)',
                    },
                  },
                    h('div', { style: { ...rowStyle, marginBottom: 4 } },
                      h('strong', { style: { minWidth: 34, fontSize: 12 } }, row.number),
                      h('div', { style: { flex: 1, minWidth: 0 } },
                        node.titleMode === 'manual'
                          ? h('input', {
                              value: node.title ?? '',
                              maxLength: 120,
                              onChange: event => updateNode(node.id, { title: event.target.value }),
                              onBlur: event => recordEdit(node.id, 'title', event.target.value),
                              placeholder: '手动标题',
                              style: { ...inputStyle, width: '100%', fontWeight: 600 },
                            })
                          : h('div', { style: { fontWeight: 600, fontSize: 12, padding: '3px 0' } },
                              nodeTitle(node),
                              node.titleMode === 'ai' && !node.ai?.title && h('span', { style: { ...mutedStyle, fontSize: 11 } }, '（待 AI 生成）'),
                            ),
                      ),
                      h('button', {
                        type: 'button', style: tinyButton, disabled: position <= 0,
                        onClick: () => moveNode(node, -1),
                      }, '↑'),
                      h('button', {
                        type: 'button', style: tinyButton, disabled: position < 0 || position >= siblings.length - 1,
                        onClick: () => moveNode(node, 1),
                      }, '↓'),
                    ),
                    h('div', { style: { ...rowStyle, flexWrap: 'wrap', marginBottom: 4 } },
                      h('label', { style: labelStyle }, '挂到',
                        h('select', {
                          value: node.parentId ?? '',
                          onChange: event => changeParent(node, event.target.value),
                          style: { ...inputStyle, maxWidth: 190 },
                        },
                          h('option', { value: '' }, '顶层根节点'),
                          parentOptions.map(item => h('option', { key: item.node.id, value: item.node.id },
                            `${item.number} ${nodeTitle(item.node)}`)),
                        ),
                      ),
                      node.synthetic && h('span', { style: { ...mutedStyle, fontSize: 11 } }, '合成'),
                      node.parentId === null && h('span', { style: { ...mutedStyle, fontSize: 11 } }, '根'),
                      isAnonymous(node) && h('span', { style: { color: COLORS.danger, fontSize: 11 } }, '匿名'),
                    ),
                    h('div', { style: { ...rowStyle, flexWrap: 'wrap', marginBottom: 4 } },
                      h('label', { style: labelStyle }, '标题',
                        h('select', {
                          value: node.titleMode,
                          onChange: event => updateNode(node.id, { titleMode: event.target.value }),
                          style: inputStyle,
                        }, TITLE_MODES.map(([value, label]) => h('option', { key: value, value }, label))),
                      ),
                      h('label', { style: labelStyle }, '内容',
                        h('select', {
                          value: node.contentMode,
                          onChange: event => updateNode(node.id, { contentMode: event.target.value }),
                          style: inputStyle,
                        }, CONTENT_MODES.map(([value, label]) => h('option', { key: value, value }, label))),
                      ),
                    ),
                    h('div', { style: { ...rowStyle, flexWrap: 'wrap', marginBottom: 4 } },
                      h('span', { style: { ...mutedStyle, fontSize: 11 } }, '权重'),
                      h('input', {
                        type: 'range', min: 0, max: 4, step: 1, value: node.weight,
                        onChange: event => setWeight(node, event.target.value),
                        style: { width: 110 },
                      }),
                      h('span', { style: { ...mutedStyle, fontSize: 11 } }, `${node.weight} ${WEIGHT_LABELS[node.weight] ?? ''}`),
                      h('label', { style: labelStyle },
                        h('input', {
                          type: 'checkbox', checked: node.startable,
                          onChange: event => setStartable(node, event.target.checked),
                        }), '介入点',
                      ),
                      h('label', { style: labelStyle },
                        h('input', {
                          type: 'radio',
                          name: `skillgen-entry-${ownerSessionId}`,
                          checked: draft.defaultEntryId === node.id,
                          onChange: () => setDefaultEntry(node),
                        }), '默认起点',
                      ),
                    ),
                    node.startable && h('input', {
                      value: node.startCondition,
                      onChange: event => updateNode(node.id, { startCondition: event.target.value }),
                      placeholder: '从这里开始需要先满足什么',
                      style: { ...inputStyle, width: '100%', marginBottom: 4 },
                    }),
                    h('input', {
                      value: node.intent,
                      onChange: event => updateNode(node.id, { intent: event.target.value }),
                      placeholder: '这一步要达成什么（intent）',
                      style: { ...inputStyle, width: '100%', marginBottom: 4 },
                    }),
                    node.contentMode === 'manual'
                      ? h('textarea', {
                          value: node.content ?? '',
                          onChange: event => updateNode(node.id, { content: event.target.value }),
                          onBlur: event => recordEdit(node.id, 'content', event.target.value),
                          placeholder: '手动填写这一步的内容/总结',
                          rows: 2,
                          style: { ...inputStyle, width: '100%', marginBottom: 4, resize: 'vertical' },
                        })
                      : h('div', { style: { ...mutedStyle, fontSize: 11, marginBottom: 4, wordBreak: 'break-word' } },
                          node.contentMode === 'ai'
                            ? (node.ai?.content || '待 AI 生成（最终输出时填充）')
                            : (String(nodeContent(node) || '').slice(0, 300) || '（原始输出为空）'),
                        ),
                    h('div', { style: { ...mutedStyle, fontSize: 11, marginBottom: 4, wordBreak: 'break-all' } },
                      nodeTurnLabels(node).join(' · '),
                    ),
                    h('div', { style: { ...rowStyle, flexWrap: 'wrap' } },
                      h('button', {
                        type: 'button', style: tinyButton,
                        onClick: () => setMountId(node.id),
                      }, isMount ? '当前挂载点' : '设为挂载点'),
                      h('button', { type: 'button', style: tinyButton, onClick: () => addSynthetic(node.id) }, '新建子节点'),
                      h('button', {
                        type: 'button', style: { ...tinyButton, color: COLORS.danger },
                        onClick: () => removeSubtree(node),
                      }, '删除'),
                    ),
                  )
                }),
              ),
            ),
            h('section', { style: column },
              h('div', { style: { ...rowStyle, justifyContent: 'space-between', marginBottom: 6 } },
                h('strong', null, '最终步骤'),
                h('span', mutedStyle, `${stepCount}`),
              ),
              h('div', { style: { ...mutedStyle, fontSize: 11, marginBottom: 6 } },
                '中间修改会实时同步到这里；根节点决定交付物。',
              ),
              h('div', { style: columnScroll },
                stepCount === 0 && h('p', { style: mutedStyle }, '还没有步骤。'),
                rows.map(row => {
                  const node = row.node
                  return h('div', {
                    key: node.id,
                    style: {
                      marginLeft: row.depth * 10,
                      padding: '5px 0',
                      borderBottom: `1px solid ${COLORS.border}`,
                      fontSize: 12,
                    },
                  },
                    h('div', { style: { ...rowStyle, alignItems: 'flex-start' } },
                      h('span', { style: { color: COLORS.muted, minWidth: 34 } }, row.number),
                      h('div', { style: { flex: 1, minWidth: 0 } },
                        h('div', { style: { fontWeight: node.weight === 0 ? 400 : 600 } }, nodeTitle(node)),
                        h('div', { style: { ...mutedStyle, fontSize: 11 } },
                          `权重 ${node.weight}`,
                          node.parentId === null ? ' · 根' : '',
                          node.startable ? ' · 介入点' : '',
                          node.synthetic ? ' · 合成' : '',
                          node.weight === 0 ? ' · 省略' : '',
                        ),
                      ),
                    ),
                  )
                }),
              ),
              h('div', { style: { marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` } },
                h('label', { style: labelStyle },
                  h('input', {
                    type: 'checkbox', checked: aiEnabled,
                    onChange: event => toggleAi(event.target.checked),
                  }), '最终输出启用 AI 润色',
                ),
                h('textarea', {
                  value: draft.ai?.note ?? '',
                  onChange: event => setAiNote(event.target.value),
                  placeholder: '给 AI 的补充描述（会嵌入 prompt，可选）',
                  rows: 2,
                  style: { ...inputStyle, width: '100%', marginTop: 4, marginBottom: 4, resize: 'vertical' },
                }),
                h('button', {
                  type: 'button', style: { ...tinyButton, marginBottom: 6 },
                  onClick: showPrompt, disabled: stepCount === 0,
                }, '查看发给 AI 的 Prompt'),
                anonymousRows.length > 0 && h('div', {
                  style: { color: COLORS.danger, fontSize: 11, marginBottom: 4 },
                }, `匿名节点：${anonymousRows.map(row => row.number).join(', ')}（${aiEnabled ? 'AI 生成时填充' : '请手填或启用 AI'}）`),
                blankLeafRows.length > 0 && h('div', {
                  style: { color: COLORS.danger, fontSize: 11, marginBottom: 4 },
                }, `空白叶子节点：${blankLeafRows.map(row => row.number).join(', ')}。叶子节点没有输入输出时只能手填内容，AI 不能凭空生成。`),
                longPromptRows.length > 0 && h('div', {
                  style: { color: COLORS.danger, fontSize: 11, marginBottom: 4 },
                }, `长 prompt 需手填标题：${longPromptRows.map(row => row.number).join(', ')}（超过 800 字符；完整 prompt 可在左侧 turn 展开查看）。`),
                promptPreview && h('div', {
                  style: { marginBottom: 8, padding: 8, border: `1px solid ${COLORS.border}`, borderRadius: 8 },
                },
                  h('div', { style: { ...mutedStyle, fontSize: 11, marginBottom: 4 } },
                    `${promptPreview.model?.provider}/${promptPreview.model?.model} · ${promptPreview.totalCalls ?? 0} 次调用 · ${promptPreview.totalChars ?? 0} 字符`),
                  h('details', { open: true },
                    h('summary', { style: { cursor: 'pointer', ...mutedStyle, fontSize: 11 } }, 'system prompt'),
                    h('pre', { style: { ...preStyle, maxHeight: 360 } }, promptPreview.system),
                  ),
                  ...(promptPreview.calls ?? []).map((call, index) => h('details', { key: index, open: index === 0 },
                    h('summary', { style: { cursor: 'pointer', ...mutedStyle, fontSize: 11 } },
                      `第 ${index + 1} 次 · 层 ${call.depth} · ${call.itemCount} 项 · ${call.chars} 字符`),
                    h('pre', { style: { ...preStyle, maxHeight: 480 } }, call.user),
                  )),
                  (promptPreview.calls ?? []).length === 0 && h('div', { style: { ...mutedStyle, fontSize: 11 } },
                    '当前没有需要 AI 润色的节点（缓存命中或全部手动）。'),
                  h('div', { style: { ...mutedStyle, fontSize: 11, marginTop: 4 } },
                    '发给模型的模型回复会移除代码块/表格/图片并只保留前后 400 字；完整 prompt/回复在左侧 turn 展开查看。'),
                  promptPreview.note && h('div', { style: { ...mutedStyle, fontSize: 11, marginTop: 4 } }, promptPreview.note),
                ),
                h('button', {
                  type: 'button', onClick: generate,
                  disabled: busy || stepCount === 0 || blankLeafRows.length > 0 || longPromptRows.length > 0 || (!aiEnabled && anonymousRows.length > 0),
                  style: {
                    ...primaryButton,
                    width: '100%',
                    opacity: busy || stepCount === 0 || blankLeafRows.length > 0 || longPromptRows.length > 0 || (!aiEnabled && anonymousRows.length > 0) ? 0.5 : 1,
                  },
                }, busy ? '生成中…' : `${aiEnabled ? 'AI 生成 Skill' : '生成 Skill'}（${stepCount} 步）`),
                h('div', { style: { ...mutedStyle, fontSize: 11, marginTop: 4 } },
                  aiEnabled ? '按层批量调用，可能多次；失败回退确定性结果；不自动发送。' : '确定性生成，不调用模型。',
                ),
                aiWarning !== '' && h('div', { style: { color: COLORS.danger, fontSize: 11, marginTop: 4 } }, `AI 润色失败：${aiWarning}`),
                result && h('div', {
                  style: { marginTop: 10, padding: 8, border: `1px solid ${COLORS.border}`, borderRadius: 8 },
                },
                  h('div', { style: { fontWeight: 600, fontSize: 12 } }, `已生成：${result.skill}`),
                  h('div', { style: { ...mutedStyle, fontSize: 11, wordBreak: 'break-all' } }, result.path),
                  result.ai?.used !== undefined && h('div', { style: { ...mutedStyle, fontSize: 11 } },
                    `AI 润色：${result.ai.used ? ((result.ai.calls ?? 0) > 0 ? `${result.ai.calls} 次调用应用` : '使用缓存') : '未使用'}`),
                  h('button', { type: 'button', style: { ...smallButton, marginTop: 6 }, onClick: goBack }, '回到对话使用'),
                ),
              ),
            ),
          ),
        )
      }

      function Dock({ sessionId, inputActions, useInput }) {
        const input = useInput(state => state)
        const [open, setOpen] = React.useState(false)
        const [manifests, setManifests] = React.useState([])
        const [selectedSkill, setSelectedSkill] = React.useState('')
        const [notice, setNotice] = React.useState('')
        const [error, setError] = React.useState('')

        React.useEffect(() => {
          setOpen(false)
          setManifests([])
          setSelectedSkill('')
          setNotice('')
          setError('')
        }, [sessionId])

        React.useEffect(() => {
          if (!open) return
          let alive = true
          setError('')
          api('/manifests')
            .then(data => {
              if (!alive) return
              const list = Array.isArray(data.manifests) ? data.manifests : []
              setManifests(list)
              setSelectedSkill(previous => {
                if (list.some(item => item.skill === previous)) return previous
                const preferred = list.find(item => item.sessionId === sessionId) || list[0]
                return preferred?.skill || ''
              })
            })
            .catch(fetchError => {
              if (alive) setError(fetchError.message)
            })
          return () => { alive = false }
        }, [open, sessionId])

        const manifest = manifests.find(item => item.skill === selectedSkill)
        const disabled = !inputActions || input?.phase !== 'plain'

        const insert = (prompt, options = {}) => {
          if (disabled || typeof prompt !== 'string' || prompt === '') return
          const replaceDraft = options.replace === true
          const occurrences = input?.occurrences?.length ?? 0
          if (occurrences > 0 && !window.confirm('当前输入框有内联引用，继续会丢失这些引用。继续？')) return
          const draft = input?.draft ?? ''
          if (replaceDraft && draft.trim() !== '' && !window.confirm('输入框已有内容，替换为 skill 命令？')) return
          const next = replaceDraft || draft.trim() === '' ? prompt : `${draft.replace(/\s+$/, '')}\n\n${prompt}`
          inputActions.setDraft(next)
          setNotice(replaceDraft ? '已加入 skill 命令' : '已加入输入框')
          setOpen(false)
          window.setTimeout(() => setNotice(''), 2500)
        }

        const wholeSkill = () => {
          if (!manifest) return
          insert(`[skill: ${manifest.skill}] 请加载 skill \`${manifest.skill}\`，并按其中的步骤执行。当前输入：`)
        }

        const injectSkill = () => {
          if (manifest) insert(`/${manifest.skill}`, { replace: true })
        }

        return h('div', {
          'data-skillgen-dock': '',
          style: { position: 'relative', display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '2px 0' },
        },
          notice !== '' && h('span', { style: { ...mutedStyle, alignSelf: 'center' } }, notice),
          h('button', {
            type: 'button',
            onClick: () => setOpen(value => !value),
            disabled: input?.phase !== undefined && input.phase !== 'plain',
            title: '选择一个 skill 步骤，加入输入框',
            'data-skillgen-dock-button': '',
            style: {
              ...smallButton,
              padding: '6px 12px',
              fontWeight: 600,
              background: 'rgba(127,127,127,.08)',
              opacity: input?.phase !== undefined && input.phase !== 'plain' ? 0.5 : 1,
            },
          }, `Skill 步骤${manifests.length > 0 ? ` (${manifests.length})` : ''} ${open ? '▾' : '▸'}`),
          open && h('div', {
            onClick: event => event.stopPropagation(),
            style: {
              position: 'absolute',
              right: 0,
              bottom: 'calc(100% + 8px)',
              width: 'min(440px, 86vw)',
              maxHeight: 420,
              overflow: 'auto',
              boxSizing: 'border-box',
              padding: 12,
              background: COLORS.surface,
              color: COLORS.text,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,.14)',
              textAlign: 'left',
            },
          },
            h('div', { style: { ...rowStyle, justifyContent: 'space-between', marginBottom: 8 } },
              h('strong', null, 'Skill 步骤'),
              h('button', { type: 'button', style: smallButton, onClick: () => setOpen(false) }, '关闭'),
            ),
            error !== '' && h('p', { style: { color: COLORS.danger, fontSize: 12 } }, error),
            manifests.length === 0 && h('p', { style: mutedStyle }, '还没有带 skillgen.json 的 skill。先从会话头部“生成 Skill”生成一个。'),
            manifests.length > 0 && h('div', null,
              h('label', { style: { display: 'block', marginBottom: 8 } },
                h('div', { style: mutedStyle }, '切换 skill'),
                h('select', {
                  value: selectedSkill,
                  onChange: event => setSelectedSkill(event.target.value),
                  style: {
                    width: '100%',
                    marginTop: 4,
                    padding: '4px 6px',
                    font: 'inherit',
                    color: 'inherit',
                    background: COLORS.surface,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 6,
                  },
                }, manifests.map(item => h('option', { key: item.skill, value: item.skill },
                  `${item.skill}（${(item.steps || []).length} 步）`,
                ))),
              ),
              manifest && h('div', null,
                h('div', { style: { display: 'flex', gap: 4, marginBottom: 8 } },
                  h('button', {
                    type: 'button',
                    onClick: injectSkill,
                    disabled,
                    title: `把 /${manifest.skill} 加入输入框`,
                    style: {
                      ...smallButton,
                      flex: 1,
                      fontWeight: 600,
                      opacity: disabled ? 0.5 : 1,
                    },
                  }, `注入 skill（/${manifest.skill}）`),
                  h('button', {
                    type: 'button',
                    onClick: wholeSkill,
                    disabled,
                    style: { ...smallButton, opacity: disabled ? 0.5 : 1 },
                  }, '完整 prompt'),
                ),
                h('div', { style: { display: 'grid', gap: 6 } },
                  (manifest.steps || []).map((step, index) => h('button', {
                    key: step.id || String(index),
                    type: 'button',
                    onClick: () => insert(step.prompt),
                    disabled,
                    style: {
                      ...smallButton,
                      textAlign: 'left',
                      padding: '6px 8px',
                      opacity: disabled ? 0.5 : 1,
                    },
                  }, `${index + 1}. ${step.title || step.id || 'step'}`)),
                ),
              ),
            ),
          ),
        )
      }

      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'skill-gen',
        order: 20,
        inject: (sessionId) => ({ open: () => openPanel(sessionId) }),
      }, HeaderAction))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'skill-gen',
        inject: () => ({
          hooks: { target: targetSource },
          back: () => ctx.layout.selectPanel(null),
        }),
      }, Panel))

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'skill-gen',
        order: 20,
      }, Dock))
    }

    return { inject: ['slots', 'layout'], apply }
  },
})
