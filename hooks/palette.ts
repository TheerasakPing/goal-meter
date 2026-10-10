import type { Status } from '../types'

export const PALETTE = {
  header: '#6366f1',
  onHeader: '#ffffff',
  elapsed: '#3b82f6',
  remaining: '#a855f7',
  eta: '#10b981',
  onChip: '#ffffff',
  done: '#22c55e',
  running: '#f59e0b',
  pending: 'inactive',
  branch: 'subtle',
  paneBg: '#000000',
} as const

export const STATUS_COLOR: Record<Status, string> = {
  done: PALETTE.done,
  in_progress: PALETTE.running,
  pending: PALETTE.pending,
}

// One color per main task, reused in its row and its stretch of the bar.
const TASK_COLORS = ['#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#eab308', '#06b6d4', '#84cc16'] as const

export const taskColor = (i: number): string => TASK_COLORS[i % TASK_COLORS.length] ?? '#3b82f6'

const SPINNER = ['◐', '◓', '◑', '◒'] as const

export const icon = (status: Status, now: number): string =>
  status === 'done' ? '✔' : status === 'pending' ? '○' : (SPINNER[Math.floor(now / 1000) % 4] ?? '◐')

// Red → amber → green, so the bar warms up as work gets done.
const STOPS: readonly [number, number, number][] = [
  [0xef, 0x44, 0x44],
  [0xf5, 0x9e, 0x0b],
  [0x22, 0xc5, 0x5e],
]

const hex = (n: number): string => Math.round(n).toString(16).padStart(2, '0')

export const gradientAt = (t: number): string => {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const a = STOPS[i] ?? STOPS[0]!
  const b = STOPS[i + 1] ?? a

  return `#${hex(a[0] + (b[0] - a[0]) * f)}${hex(a[1] + (b[1] - a[1]) * f)}${hex(a[2] + (b[2] - a[2]) * f)}`
}
