import type { SessionUsage } from 'claude-code'

import type { Mode } from '../types'


export const MODES: readonly Mode[] = ['status', 'panel', 'both']
export const hasStatus = (mode: Mode) => mode !== 'panel'
export const hasPanel = (mode: Mode) => mode !== 'status'

// Keys in $.store, kept across sessions.
export const STORE = { mode: 'mode', muted: 'muted', goal: 'goal', history: 'history' } as const
export const MAX_HISTORY = 100

export const costOf = (usage: SessionUsage | null): number | null => usage?.cost?.usd ?? null
