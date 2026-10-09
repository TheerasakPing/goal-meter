import type { Goal, MainTask, Status, Step } from '../types'

export type StepInput = { title: string; status?: string }
export type TaskInput = StepInput & { subtasks?: StepInput[] }

const STATUSES: readonly Status[] = ['pending', 'in_progress', 'done']

const toStatus = (raw: string | undefined): Status =>
  STATUSES.includes(raw as Status) ? (raw as Status) : 'pending'

// Keep the times an item already had when the model resends the list.
const mergeStep = (input: StepInput, prev: Step | undefined, now: number): Step => {
  const status = toStatus(input.status)
  const isStarted = status !== 'pending'
  const startedAt = isStarted ? (prev?.startedAt ?? now) : null
  const doneAt = status === 'done' ? (prev?.doneAt ?? now) : null

  return { title: input.title, status, startedAt, doneAt }
}

export const mergeTasks = (
  inputs: readonly TaskInput[],
  prev: readonly MainTask[],
  now: number,
): MainTask[] =>
  inputs.map(input => {
    const old = prev.find(task => task.title === input.title)
    const subtasks = (input.subtasks ?? []).map(sub =>
      mergeStep(sub, old?.subtasks.find(s => s.title === sub.title), now),
    )
    const hasSubtasks = subtasks.length > 0
    // A task with subtasks follows them: done when all are, running when any is.
    const derived: Status = !hasSubtasks
      ? toStatus(input.status)
      : subtasks.every(s => s.status === 'done')
        ? 'done'
        : subtasks.some(s => s.status !== 'pending')
          ? 'in_progress'
          : toStatus(input.status) === 'done'
            ? 'in_progress'
            : toStatus(input.status)
    const self = mergeStep({ title: input.title, status: derived }, old, now)
    const firstStart = subtasks
      .map(s => s.startedAt)
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b)[0]

    return {
      ...self,
      startedAt: self.startedAt === null ? null : Math.min(self.startedAt, firstStart ?? self.startedAt),
      subtasks,
    }
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

export const estimate = (
  goal: Goal,
  now: number,
): { elapsedMs: number; remainingMs: number | null; etaAt: number | null } => {
  const end = goal.doneAt ?? now
  const elapsedMs = Math.max(0, end - goal.startedAt)
  const { ratio } = progress(goal)

  if (goal.doneAt !== null || ratio >= 1) {
    return { elapsedMs, remainingMs: 0, etaAt: end }
  }
  if (ratio <= 0 || elapsedMs < 1000) {
    return { elapsedMs, remainingMs: null, etaAt: null }
  }
  const remainingMs = Math.round((elapsedMs * (1 - ratio)) / ratio)

  return { elapsedMs, remainingMs, etaAt: now + remainingMs }
}

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

export const formatSpan = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}m`

  return `${m}m`
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

export const padDisplay = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)))
