import type { Goal, HistoryEntry, MainTask, Source, Status, Step } from '../types'

export type StepInput = { title: string; status?: string }
export type TaskInput = StepInput & { subtasks?: StepInput[]; id?: string }

const STATUSES: readonly Status[] = ['pending', 'in_progress', 'done']

export const toStatus = (raw: string | undefined): Status =>
  raw === 'completed' ? 'done' : STATUSES.includes(raw as Status) ? (raw as Status) : 'pending'

export const newGoal = (title: string, source: Source, now: number, cost: number | null, isTurnRunning: boolean): Goal => ({
  title,
  source,
  startedAt: now,
  doneAt: null,
  tasks: [],
  activeMs: 0,
  activeFrom: isTurnRunning ? now : null,
  isPaused: false,
  deadlineAt: null,
  costStart: cost,
  predictedTotalMs: null,
})

// Keep the times and costs an item already had when the list is sent again.
const mergeStep = (input: StepInput, prev: Step | undefined, now: number, cost: number | null): Step => {
  const status = toStatus(input.status)
  const isStarted = status !== 'pending'
  const startedAt = isStarted ? (prev?.startedAt ?? now) : null
  const doneAt = status === 'done' ? (prev?.doneAt ?? now) : null
  const costStart = isStarted ? (prev?.costStart ?? cost) : null
  const costUsd =
    status !== 'done' ? null : (prev?.costUsd ?? (cost !== null && costStart !== null ? Math.max(0, cost - costStart) : null))

  return { title: input.title, status, startedAt, doneAt, costStart, costUsd }
}

const deriveStatus = (own: Status, subtasks: readonly Step[]): Status => {
  if (subtasks.length === 0) return own
  if (subtasks.every(s => s.status === 'done')) return 'done'
  if (subtasks.some(s => s.status !== 'pending')) return 'in_progress'

  return own === 'done' ? 'in_progress' : own
}

export const mergeTasks = (
  inputs: readonly TaskInput[],
  prev: readonly MainTask[],
  now: number,
  cost: number | null = null,
): MainTask[] =>
  inputs.map(input => {
    const old = prev.find(task => (input.id !== undefined ? task.id === input.id : task.title === input.title))
    const subtasks = (input.subtasks ?? []).map(sub =>
      mergeStep(sub, old?.subtasks.find(s => s.title === sub.title), now, cost),
    )
    const status = deriveStatus(toStatus(input.status), subtasks)
    const self = mergeStep({ title: input.title, status }, old, now, cost)
    const firstStart = subtasks
      .map(s => s.startedAt)
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b)[0]
    const task: MainTask = {
      ...self,
      startedAt: self.startedAt === null ? null : Math.min(self.startedAt, firstStart ?? self.startedAt),
      subtasks,
    }

    return input.id === undefined ? task : { ...task, id: input.id }
  })

const weight = (status: Status): number =>
  status === 'done' ? 1 : status === 'in_progress' ? 0.5 : 0

// Leaf units: each subtask, or the task itself when it has none.
export const progress = (goal: Goal): { done: number; total: number; ratio: number } => {
  const leaves = goal.tasks.flatMap(task =>
    task.subtasks.length > 0 ? task.subtasks : [task],
  )
  const total = leaves.length
  const done = leaves.filter(s => s.status === 'done').length
  const ratio = total === 0 ? 0 : leaves.reduce((sum, s) => sum + weight(s.status), 0) / total

  return { done, total, ratio }
}

// --- active time -----------------------------------------------------------

export const activeElapsed = (goal: Goal, now: number): number =>
  goal.activeMs + (goal.activeFrom !== null && !goal.isPaused && goal.doneAt === null ? Math.max(0, now - goal.activeFrom) : 0)

export const startActive = (goal: Goal, now: number): Goal =>
  goal.isPaused || goal.activeFrom !== null || goal.doneAt !== null ? goal : { ...goal, activeFrom: now }

export const stopActive = (goal: Goal, now: number): Goal =>
  goal.activeFrom === null ? goal : { ...goal, activeMs: activeElapsed(goal, now), activeFrom: null }

export const setPaused = (goal: Goal, isPaused: boolean, now: number, isTurnRunning: boolean): Goal => {
  if (isPaused === goal.isPaused) return goal
  if (isPaused) return { ...stopActive(goal, now), isPaused: true }

  return { ...goal, isPaused: false, activeFrom: isTurnRunning ? now : null }
}

// --- estimates -------------------------------------------------------------

export type Estimate = {
  elapsedMs: number
  activeMs: number
  remainingMs: number | null
  etaAt: number | null
}

// The rate is taken from active time once any turn was timed, wall time before that.
export const estimate = (goal: Goal, now: number, factor = 1): Estimate => {
  const end = goal.doneAt ?? now
  const elapsedMs = Math.max(0, end - goal.startedAt)
  const activeMs = activeElapsed(goal, now)
  const basis = activeMs > 0 ? activeMs : elapsedMs
  const { ratio } = progress(goal)

  if (goal.doneAt !== null || ratio >= 1) {
    return { elapsedMs, activeMs, remainingMs: 0, etaAt: end }
  }
  if (ratio <= 0 || basis < 1000) {
    return { elapsedMs, activeMs, remainingMs: null, etaAt: null }
  }
  const remainingMs = Math.round(((basis * (1 - ratio)) / ratio) * factor)

  return { elapsedMs, activeMs, remainingMs, etaAt: now + remainingMs }
}

// Remember, once, what the total was predicted to be at the half-way mark.
export const notePrediction = (goal: Goal, now: number): Goal => {
  if (goal.predictedTotalMs !== null || progress(goal).ratio < 0.5) return goal
  const { remainingMs } = estimate(goal, now)
  if (remainingMs === null) return goal
  const basis = activeElapsed(goal, now) || now - goal.startedAt

  return { ...goal, predictedTotalMs: basis + remainingMs }
}

// How far past predictions ran: the median of actual / predicted, kept between 0.5 and 2.
export const etaFactor = (history: readonly HistoryEntry[]): number => {
  const ratios = history
    .filter(h => h.predictedTotalMs !== null && h.predictedTotalMs > 0 && h.activeMs > 0)
    .map(h => h.activeMs / (h.predictedTotalMs as number))
    .sort((a, b) => a - b)
  if (ratios.length < 2) return 1
  const mid = Math.floor(ratios.length / 2)
  const median = ratios.length % 2 === 1 ? (ratios[mid] ?? 1) : ((ratios[mid - 1] ?? 1) + (ratios[mid] ?? 1)) / 2

  return Math.min(2, Math.max(0.5, median))
}

export const toHistory = (goal: Goal, now: number, cost: number | null): HistoryEntry => ({
  title: goal.title,
  startedAt: goal.startedAt,
  doneAt: goal.doneAt ?? now,
  activeMs: activeElapsed(goal, now),
  costUsd: cost !== null && goal.costStart !== null ? Math.max(0, cost - goal.costStart) : null,
  tasks: goal.tasks.length,
  predictedTotalMs: goal.predictedTotalMs,
})

// --- deadline --------------------------------------------------------------

// "17:00" means the next 17:00 from now.
export const parseDeadline = (text: string, now: number): number | null => {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim())
  if (m === null) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const d = new Date(now)
  d.setHours(h, min, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)

  return d.getTime()
}

export type DeadlineState = { kind: 'none' } | { kind: 'unknown'; at: number } | { kind: 'on-time' | 'late'; at: number; byMs: number }

export const deadlineState = (goal: Goal, now: number, factor = 1): DeadlineState => {
  if (goal.deadlineAt === null) return { kind: 'none' }
  const finish = goal.doneAt ?? estimate(goal, now, factor).etaAt
  if (finish === null) return { kind: 'unknown', at: goal.deadlineAt }
  const diff = goal.deadlineAt - finish

  return diff >= 0 ? { kind: 'on-time', at: goal.deadlineAt, byMs: diff } : { kind: 'late', at: goal.deadlineAt, byMs: -diff }
}

// --- formatting ------------------------------------------------------------

export const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`

  return `${sec}s`
}

export const formatClock = (at: number): string => {
  const d = new Date(at)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const formatSpan = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`

  return `${m}m`
}

export const formatUsd = (usd: number | null): string => (usd === null ? '' : `$${usd.toFixed(2)}`)

export type Slice = { task: number; done: number; running: number; empty: number }

// Splits `width` cells among the tasks by their leaf units, in task order,
// each task's cells split into done, running and not yet started.
export const slices = (goal: Goal, width: number): Slice[] => {
  const units = goal.tasks.map(task => Math.max(1, task.subtasks.length))
  const total = units.reduce((a, b) => a + b, 0)
  let unitsBefore = 0

  return goal.tasks.map((task, i) => {
    const u = units[i] ?? 1
    const from = Math.round((unitsBefore / total) * width)
    unitsBefore += u
    const cells = Math.round((unitsBefore / total) * width) - from
    const leaves = task.subtasks.length > 0 ? task.subtasks : [task]
    const doneUnits = leaves.filter(s => s.status === 'done').length
    const runUnits = leaves.filter(s => s.status === 'in_progress').length
    const done = Math.round((doneUnits / u) * cells)
    const running = Math.min(cells - done, Math.max(runUnits > 0 ? 1 : 0, Math.round((runUnits / u) * cells)))

    return { task: i, done, running, empty: cells - done - running }
  })
}

const QUOTA_LABELS: Record<string, string> = {
  five_hour: '5 ชม.',
  seven_day: 'สัปดาห์',
  spend_limit: 'วงเงิน',
}

export const quotaLabel = (kind: string): string =>
  QUOTA_LABELS[kind] ?? kind.replace(/_/g, ' ')

// Thai vowel and tone marks that sit above or below a letter take no column.
const isZeroWidth = (ch: string): boolean => /[ัิ-ฺ็-๎]/.test(ch)

export const displayWidth = (text: string): number => [...text].filter(ch => !isZeroWidth(ch)).length

export const truncate = (text: string, width: number): string =>
  displayWidth(text) <= width ? text : `${[...text].slice(0, Math.max(1, width - 1)).join('')}…`
