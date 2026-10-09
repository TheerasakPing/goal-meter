import type { QuotaSample } from '../types'

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const MAX_SAMPLES = 60
const MIN_SPAN_MS = 2 * 60_000
export const THRESHOLDS = [80, 90] as const

// Keep the readings of each window's current period, newest last.
export const addSamples = (samples: readonly QuotaSample[], limits: readonly Limit[], now: number): QuotaSample[] => {
  const fresh = limits.map(l => ({ kind: l.kind, at: now, pct: l.percentUsed, resetsAt: l.resetsAt ?? null }))
  const kept = samples.filter(s => fresh.some(f => f.kind === s.kind && f.resetsAt === s.resetsAt) || !fresh.some(f => f.kind === s.kind))

  return [...kept, ...fresh].slice(-MAX_SAMPLES)
}

// When the window would reach 100% at the rate it rose this period; null when it
// is not rising, too few readings span enough time, or it resets first.
export const exhaustAt = (samples: readonly QuotaSample[], limit: Limit, now: number): number | null => {
  const period = samples.filter(s => s.kind === limit.kind && s.resetsAt === (limit.resetsAt ?? null))
  const first = period[0]
  if (first === undefined) return null
  const span = now - first.at
  const rise = limit.percentUsed - first.pct
  if (span < MIN_SPAN_MS || rise <= 0) return null
  const at = now + ((100 - limit.percentUsed) / rise) * span
  const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)

  return Number.isFinite(resetsAt) && at >= resetsAt ? null : Math.round(at)
}

// The thresholds a window has crossed that were not yet announced this period.
export const newAlerts = (alerted: readonly string[], limits: readonly Limit[]): string[] =>
  limits.flatMap(l =>
    THRESHOLDS.filter(t => l.percentUsed >= t)
      .map(t => `${l.kind}|${l.resetsAt ?? ''}|${t}`)
      .filter(key => !alerted.includes(key)),
  )

export const alertThreshold = (key: string): number => Number(key.split('|')[2] ?? 0)
export const alertKind = (key: string): string => key.split('|')[0] ?? ''
