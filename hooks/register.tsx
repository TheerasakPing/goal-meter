import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Agent, Goal, HistoryEntry, MainTask, Mode, ModelInfo } from '../types'
import {
  deadlineState,
  estimate,
  etaFactor,
  formatClock,
  formatDuration,
  mergeTasks,
  modelText,
  newGoal,
  notePrediction,
  parseDeadline,
  progress,
  quotaLabel,
  setPaused,
  startActive,
  stopActive,
  toHistory,
  toStatus,
} from './meter'
import type { TaskInput } from './meter'
import { addSamples, alertKind, alertThreshold, newAlerts } from './quota'
import { historyTable, report } from './report'
import {
  MODES,
  STORE,
  MAX_HISTORY,
  costOf,
  hasPanel,
  hasStatus,
} from './state'
import { Band, Pane } from './views'
import type { Actions, Els, View } from './views'

const goalAtom = atom({ plugin: 'goal-meter', key: 'goal' } as const, null)
const nowAtom = atom({ plugin: 'goal-meter', key: 'now' } as const, 0)
const isBandHiddenAtom = atom({ plugin: 'goal-meter', key: 'isBandHidden' } as const, false)
const modeAtom = atom({ plugin: 'goal-meter', key: 'mode' } as const, 'both')
const isMutedAtom = atom({ plugin: 'goal-meter', key: 'isMuted' } as const, false)
const isTurnRunningAtom = atom({ plugin: 'goal-meter', key: 'isTurnRunning' } as const, false)
const agentsAtom = atom({ plugin: 'goal-meter', key: 'agents' } as const, [])
const quotaSamplesAtom = atom({ plugin: 'goal-meter', key: 'quotaSamples' } as const, [])
const alertedAtom = atom({ plugin: 'goal-meter', key: 'alerted' } as const, [])
const etaFactorAtom = atom({ plugin: 'goal-meter', key: 'etaFactor' } as const, 1)
const modelAtom = atom({ plugin: 'goal-meter', key: 'model' } as const, null)

const PANE = 'goal-meter'
const TOOL = 'mcp__goal-meter__update'

const SOUND_DONE = 'sounds/done.wav'
const SOUND_ALERT = 'sounds/alert.wav'
const MAX_AGENTS = 8
const MIRRORED_TITLE = 'งานใน session นี้'

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
  },
  required: ['title', 'status'],
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'The big goal in one line. Omit to keep the current one.' },
    tasks: {
      type: 'array',
      description: 'The FULL list of main tasks, in order (it replaces the previous list).',
      items: {
        type: 'object',
        properties: { ...STEP_SCHEMA.properties, subtasks: { type: 'array', items: STEP_SCHEMA } },
        required: ['title', 'status'],
      },
    },
  },
}

const GUIDE = [
  '# Goal meter',
  `The person watches a goal meter. For any multi-step task, call ${TOOL} first with the big goal and the main tasks (each with subtasks where useful), all "pending" or "in_progress".`,
  'Call it again, with the full list, every time a task or subtask starts or finishes, so the colors, elapsed time and ETA stay true. Mark everything "done" when the goal is reached.',
].join('\n')

const HELP = [
  '/goal-meter                 show the meter',
  '/goal-meter <goal>          set a goal',
  '/goal-meter pause | resume  stop or restart the active-time clock',
  '/goal-meter deadline 17:00  set a deadline (off to remove)',
  '/goal-meter report          summary of the goal as Markdown',
  '/goal-meter history         goals finished before',
  '/goal-meter mode status | panel | both',
  '/goal-meter sound on | off',
  '/goal-meter hide | pane | clear',
].join('\n')

// --- engine helpers (functions given $ live in this file) --------------------

const usageOf = ($: EngineInterface): Promise<SessionUsage | null> => $.session.usage().catch(() => null)

// Writes the goal for this session and keeps a copy for the next one.
const saveGoal = async ($: EngineInterface, goal: Goal | null): Promise<void> => {
  await update($, goalAtom, () => goal)
  await (goal === null ? $.store.delete(STORE.goal) : $.store.set(STORE.goal, goal)).catch(() => undefined)
}

const loadHistory = async ($: EngineInterface): Promise<HistoryEntry[]> => {
  const raw = await $.store.get(STORE.history).catch(() => undefined)

  return Array.isArray(raw) ? (raw as HistoryEntry[]) : []
}

const appendHistory = async ($: EngineInterface, entry: HistoryEntry): Promise<HistoryEntry[]> => {
  const history = [...(await loadHistory($)), entry].slice(-MAX_HISTORY)
  await $.store.set(STORE.history, history).catch(() => undefined)

  return history
}

const playSound = async ($: EngineInterface, asset: string): Promise<void> => {
  if (await read($, isMutedAtom)) return
  await $.audio.play({ asset }).catch(() => undefined)
}

// --- status line ---------------------------------------------------------------

const statusLine = (
  goal: Goal | null,
  now: number,
  usage: SessionUsage | null,
  factor: number,
  agents: readonly Agent[],
  model: ModelInfo | null,
): string | undefined => {
  const quota = (usage?.rateLimits ?? []).map(l => `${quotaLabel(l.kind)} ${Math.round(l.percentUsed)}%`).join(' · ')
  const tail = [quota === '' ? '' : goal === null ? `โควต้า ${quota}` : quota, model === null ? '' : modelText(model)]
    .filter(Boolean)
    .join(' | ')
  if (goal === null) return tail === '' ? undefined : tail
  const parts = [goalStatus(goal, now, factor)]
  const running = agents.filter(a => a.doneAt === null).length
  if (running > 0) parts.push(`agent ${running}`)
  const deadline = deadlineState(goal, now, factor)
  if (deadline.kind === 'late') parts.push(`ช้ากว่ากำหนด ~${formatDuration(deadline.byMs)}`)

  return tail === '' ? parts.join(' · ') : `${parts.join(' · ')} | ${tail}`
}

const goalStatus = (goal: Goal, now: number, factor: number): string => {
  const { done, total, ratio } = progress(goal)
  if (goal.doneAt !== null) return `Goal: ${goal.title} · เสร็จแล้ว ✔`
  const { remainingMs, etaAt } = estimate(goal, now, factor)
  const eta = goal.isPaused ? 'หยุดนับ' : etaAt === null || remainingMs === null ? 'ETA –' : `ETA ${formatClock(etaAt)}`
  const current = goal.tasks.find(task => task.status === 'in_progress')
  const doing = current === undefined ? '' : ` · ◐ ${current.title}`

  return `Goal ${Math.round(ratio * 100)}% (${done}/${total})${doing} · ${eta}`
}

const refreshStatus = async ($: EngineInterface, usage?: SessionUsage | null): Promise<void> => {
  if (!hasStatus(await read($, modeAtom))) {
    $.ui.status(undefined)
    return
  }
  const text = statusLine(
    await read($, goalAtom),
    await $.clock.now(),
    usage === undefined ? await usageOf($) : usage,
    await read($, etaFactorAtom),
    await read($, agentsAtom),
    await read($, modelAtom),
  )
  $.ui.status(text)
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Goal meter' }).catch(() => undefined)

// --- writing the goal -------------------------------------------------------------

// Every change of the goal goes through here: done detection, history, sound, status.
const commit = async ($: EngineInterface, prev: Goal | null, next: Goal, now: number, cost: number | null): Promise<Goal> => {
  const isDone = next.tasks.length > 0 && next.tasks.every(task => task.status === 'done')
  let goal: Goal = isDone ? stopActive({ ...next, doneAt: next.doneAt ?? now }, now) : { ...next, doneAt: null }
  goal = notePrediction(goal, now)
  await saveGoal($, goal)

  const isNew = prev === null || prev.startedAt !== goal.startedAt
  if (isNew) {
    await update($, isBandHiddenAtom, () => false)
    if (hasPanel(await read($, modeAtom))) void openPane($)
  }
  if (goal.doneAt !== null && (prev === null || prev.doneAt === null || isNew)) {
    const history = await appendHistory($, toHistory(goal, now, cost))
    await update($, etaFactorAtom, () => etaFactor(history))
    $.ui.toast(`สำเร็จ: ${goal.title} (${formatDuration(estimate(goal, now).activeMs || now - goal.startedAt)})`)
    void playSound($, SOUND_DONE)
  }
  await refreshStatus($)

  return goal
}

// The built-in task list drives the meter unless the meter's own tool is in use.
const mirror = async ($: EngineInterface, edit: (tasks: MainTask[], now: number, cost: number | null) => MainTask[]): Promise<void> => {
  const prev = await read($, goalAtom)
  if (prev !== null && prev.source === 'meter' && prev.doneAt === null) return
  const now = await $.clock.now()
  const cost = costOf(await usageOf($))
  const base =
    prev === null || prev.doneAt !== null
      ? newGoal(MIRRORED_TITLE, 'tasks', now, cost, await read($, isTurnRunningAtom))
      : { ...prev, source: 'tasks' as const }
  const tasks = edit(base.tasks, now, cost)
  if (tasks.length === 0 && prev === null) return
  await commit($, prev, { ...base, tasks }, now, cost)
}

const asInput = (task: MainTask): TaskInput => ({
  title: task.title,
  status: task.status,
  ...(task.id === undefined ? {} : { id: task.id }),
  subtasks: task.subtasks.map(s => ({ title: s.title, status: s.status })),
})

const view = async ($: EngineInterface, els: Els, cols: number): Promise<View> => ({
  els,
  goal: await read($, goalAtom),
  now: Math.max(await read($, nowAtom), await $.clock.now()),
  cols,
  usage: await usageOf($),
  samples: await read($, quotaSamplesAtom),
  agents: await read($, agentsAtom),
  factor: await read($, etaFactorAtom),
  model: await read($, modelAtom),
})

const actions = ($: EngineInterface): Actions => ({
  continueTask: title => void $.prompt.submit({ text: `ทำงาน "${title}" ต่อ` }).catch(() => undefined),
  togglePause: () =>
    void (async () => {
      const goal = await read($, goalAtom)
      if (goal === null) return
      await saveGoal($, setPaused(goal, !goal.isPaused, await $.clock.now(), await read($, isTurnRunningAtom)))
      await refreshStatus($)
    })(),
  setMode: mode =>
    void (async () => {
      await update($, modeAtom, () => mode)
      await $.store.set(STORE.mode, mode).catch(() => undefined)
      await refreshStatus($)
      if (!hasPanel(mode)) await $.ui.close({ id: PANE })
    })(),
  toggleMute: () =>
    void (async () => {
      const isMuted = !(await read($, isMutedAtom))
      await update($, isMutedAtom, () => isMuted)
      await $.store.set(STORE.muted, isMuted).catch(() => undefined)
    })(),
})

// --- register ------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'goal-meter',
      description: 'Goal meter: show it, set a goal or deadline, pause, report, history, mode, sound',
      argumentHint: '[goal | pause | resume | deadline HH:MM | report | history | mode | sound | hide | pane | clear]',
    })
    await $.tool.register({
      name: 'update',
      description:
        'Update the goal meter the person watches: the big goal, main tasks and subtasks with their status (pending, in_progress, done). Send the full task list every call.',
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    const now = await $.clock.now()
    await update($, nowAtom, () => now)
    $.clock.every(500, () => {
      void $.clock.now().then(t => update($, nowAtom, () => t))
    })

    const mode = await $.store.get(STORE.mode).catch(() => undefined)
    await update($, modeAtom, () => (MODES.includes(mode as Mode) ? (mode as Mode) : 'both'))
    const isMuted = (await $.store.get(STORE.muted).catch(() => false)) === true
    await update($, isMutedAtom, () => isMuted)
    const factor = etaFactor(await loadHistory($))
    await update($, etaFactorAtom, () => factor)

    // A goal from an earlier session carries on, its clock stopped until a turn runs.
    if ((await read($, goalAtom)) === null) {
      const saved = (await $.store.get(STORE.goal).catch(() => undefined)) as Goal | undefined
      if (saved !== undefined && saved !== null && typeof saved === 'object' && saved.doneAt === null) {
        await update($, goalAtom, () => stopActive(saved, now))
      }
    }

    const usage = await usageOf($)
    await update($, quotaSamplesAtom, s => addSamples(s, usage?.rateLimits ?? [], now))
    await refreshStatus($, usage)
    if ((await read($, goalAtom)) !== null && hasPanel(await read($, modeAtom))) void openPane($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, isTurnRunningAtom, () => true)
    const goal = await read($, goalAtom)
    if (goal !== null) await saveGoal($, startActive(goal, await $.clock.now()))

    return next(e)
  })

  // Each main-loop request names the model it goes to (a /model switch or a fallback shows on the next one).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const model: ModelInfo = { id: e.model, effort: e.effort === undefined ? null : String(e.effort) }
      const prev = await read($, modelAtom)
      if (prev?.id !== model.id || prev.effort !== model.effort) {
        await update($, modelAtom, () => model)
        await refreshStatus($)
      }
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId !== undefined) {
      await update($, agentsAtom, list => list.map(a => (a.id === e.agentId && a.doneAt === null ? { ...a, doneAt: now } : a)))
    } else {
      await update($, isTurnRunningAtom, () => false)
      const goal = await read($, goalAtom)
      if (goal !== null) await saveGoal($, stopActive(goal, now))
    }
    await refreshStatus($)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId !== undefined) {
      const agent: Agent = {
        id: spawned.agentId,
        description: e.description,
        type: e.subagentType,
        startedAt: await $.clock.now(),
        doneAt: null,
      }
      await update($, agentsAtom, list => [...list, agent].slice(-MAX_AGENTS))
      await refreshStatus($)
    }

    return spawned
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, quotaSamplesAtom, s => addSamples(s, e.rateLimits, now))
    const fresh = newAlerts(await read($, alertedAtom), e.rateLimits)
    if (fresh.length > 0) {
      await update($, alertedAtom, list => [...list, ...fresh].slice(-50))
      const top = fresh.reduce((a, b) => (alertThreshold(b) > alertThreshold(a) ? b : a))
      $.ui.toast(`โควต้า ${quotaLabel(alertKind(top))} ใช้ไปแล้ว ${alertThreshold(top)}%`)
      void playSound($, SOUND_ALERT)
    }
    await refreshStatus($, { startedAt: 0, ...e })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const goal = await read($, goalAtom)
    const current =
      goal === null ? '' : `\nCurrent goal: ${goal.title} (${progress(goal).done}/${progress(goal).total} done).`

    return {
      ...composed,
      sections: [...composed.sections, { id: 'goal-meter:guide', text: GUIDE + current, scope: 'session' }],
    }
  })

  on('tool.call', { tool: 'mcp__goal-meter__update' }, async ($, e) => {
    const input = e as unknown as { goal?: string; tasks?: TaskInput[] }
    const now = await $.clock.now()
    const cost = costOf(await usageOf($))
    const prev = await read($, goalAtom)
    const title = input.goal?.trim() || prev?.title || 'เป้าหมาย'
    const isNewGoal =
      prev === null ||
      prev.doneAt !== null ||
      (input.goal !== undefined && input.goal.trim() !== prev.title && prev.source !== 'manual')
    const base: Goal = isNewGoal
      ? newGoal(title, 'meter', now, cost, await read($, isTurnRunningAtom))
      : { ...prev, title, source: 'meter' }
    const tasks = input.tasks === undefined ? base.tasks : mergeTasks(input.tasks, base.tasks, now, cost)
    const goal = await commit($, prev, { ...base, tasks }, now, cost)
    const { done, total } = progress(goal)

    return { result: `Goal meter updated: ${done}/${total} done.` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError !== true && ran.deny === undefined) {
      const todos = e.todos.map(t => ({ title: t.content, status: toStatus(t.status) }))
      await mirror($, (tasks, now, cost) => mergeTasks(todos, tasks, now, cost)).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    if (ran.isError !== true && ran.deny === undefined && id !== undefined) {
      await mirror($, (tasks, now, cost) =>
        mergeTasks([...tasks.map(asInput), { title: e.subject, status: 'pending', id }], tasks, now, cost),
      ).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError !== true && ran.deny === undefined) {
      await mirror($, (tasks, now, cost) => {
        const inputs = tasks.flatMap((task): TaskInput[] => {
          if (task.id !== e.taskId) return [asInput(task)]
          if (e.status === 'deleted') return []
          return [{ ...asInput(task), title: e.subject ?? task.title, status: e.status === undefined ? task.status : toStatus(e.status) }]
        })
        return mergeTasks(inputs, tasks, now, cost)
      }).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'goal-meter' }, async ($, e) => {
    const args = e.args.trim()
    const [word = '', ...rest] = args.split(/\s+/)
    const value = rest.join(' ')
    const now = await $.clock.now()
    const goal = await read($, goalAtom)

    switch (word) {
      case 'help':
        return { text: HELP }
      case 'clear':
        await saveGoal($, null)
        await refreshStatus($)
        return { text: 'Goal meter cleared.' }
      case 'hide':
        await update($, isBandHiddenAtom, () => true)
        return { text: 'Goal meter hidden. /goal-meter shows it again.' }
      case 'pane':
        await $.ui.open({ id: PANE, title: 'Goal meter' })
        return { text: 'Goal meter pane opened.' }
      case 'pause':
      case 'resume': {
        if (goal === null) return { text: 'No goal to pause.' }
        await saveGoal($, setPaused(goal, word === 'pause', now, await read($, isTurnRunningAtom)))
        await refreshStatus($)
        return { text: word === 'pause' ? 'Active-time clock paused.' : 'Active-time clock running again.' }
      }
      case 'deadline': {
        if (goal === null) return { text: 'Set a goal first.' }
        if (value === 'off') {
          await saveGoal($, { ...goal, deadlineAt: null })
          return { text: 'Deadline removed.' }
        }
        const at = parseDeadline(value, now)
        if (at === null) return { text: 'Use /goal-meter deadline HH:MM (for example 17:00), or off.' }
        await saveGoal($, { ...goal, deadlineAt: at })
        await refreshStatus($)
        return { text: `Deadline set: ${formatClock(at)}` }
      }
      case 'report':
        if (goal === null) return { text: 'No goal yet.' }
        return { text: report(goal, now, costOf(await usageOf($)), await read($, etaFactorAtom)) }
      case 'history':
        return { text: historyTable(await loadHistory($)) }
      case 'sound': {
        const isMuted = value === 'off' ? true : value === 'on' ? false : !(await read($, isMutedAtom))
        await update($, isMutedAtom, () => isMuted)
        await $.store.set(STORE.muted, isMuted).catch(() => undefined)
        return { text: `Sound ${isMuted ? 'off' : 'on'}.` }
      }
      case 'mode': {
        if (!MODES.includes(value as Mode)) {
          return { text: `Mode: ${await read($, modeAtom)}. Use /goal-meter mode status | panel | both` }
        }
        const mode = value as Mode
        await update($, modeAtom, () => mode)
        await $.store.set(STORE.mode, mode).catch(() => undefined)
        await update($, isBandHiddenAtom, () => false)
        await refreshStatus($)
        if (hasPanel(mode)) await openPane($)
        else await $.ui.close({ id: PANE })
        return { text: `Goal meter mode: ${mode}` }
      }
      case '':
        break
      default: {
        const cost = costOf(await usageOf($))
        await commit($, goal, newGoal(args, 'manual', now, cost, await read($, isTurnRunningAtom)), now, cost)
      }
    }
    await update($, isBandHiddenAtom, () => false)
    const mode = await read($, modeAtom)
    if (hasPanel(mode)) await openPane($)

    return { text: args === '' ? `Goal meter shown (mode: ${mode}). /goal-meter help lists the commands.` : `Goal set: ${args}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const goal = await read($, goalAtom)
    const usage = await usageOf($)
    const isHidden = e.props.hasSurvey || (await read($, isBandHiddenAtom)) || !hasStatus(await read($, modeAtom))
    if (isHidden || (goal === null && (usage?.rateLimits ?? []).length === 0 && (await read($, modelAtom)) === null)) return next(e)

    return Band(await view($, $.ui.resolve(e) as unknown as Els, e.props.bodyColumns || 80))
  })

  on('ui.render', { component: 'Pane', requestId: 'goal-meter' }, async ($, e) => {
    const v = await view($, $.ui.resolve(e) as unknown as Els, e.props.bodyColumns || e.viewport?.columns || 50)

    return Pane(v, actions($), await read($, modeAtom), await read($, isMutedAtom))
  })
}
