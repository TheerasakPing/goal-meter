export type Status = 'pending' | 'in_progress' | 'done'

export type Step = {
  title: string
  status: Status
  startedAt: number | null
  doneAt: number | null
  // Session cost (USD) when the step started, and what it cost once done.
  costStart: number | null
  costUsd: number | null
}

// `id` is the built-in task list's id when the task was mirrored from it.
export type MainTask = Step & { subtasks: Step[]; id?: string }

// Where the meter shows: the band above the prompt and the status line, the pane, or both.
export type Mode = 'status' | 'panel' | 'both'

// Who writes the task list: the meter's own tool, the built-in task tools, or the person.
export type Source = 'meter' | 'tasks' | 'manual'

export type Goal = {
  title: string
  source: Source
  startedAt: number
  doneAt: number | null
  tasks: MainTask[]
  // Time a turn was running while the meter was not paused.
  activeMs: number
  activeFrom: number | null
  isPaused: boolean
  deadlineAt: number | null
  costStart: number | null
  // Total active time predicted when the goal first passed half way, to calibrate later ETAs.
  predictedTotalMs: number | null
}

export type Agent = {
  id: string
  description: string
  type: string
  startedAt: number
  doneAt: number | null
}

export type QuotaSample = { kind: string; at: number; pct: number; resetsAt: string | null }

// The model the main loop last sent a request to, and its reasoning effort.
export type ModelInfo = { id: string; effort: string | null }

export type HistoryEntry = {
  title: string
  startedAt: number
  doneAt: number
  activeMs: number
  costUsd: number | null
  tasks: number
  predictedTotalMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'goal-meter': {
      goal: Goal | null
      now: number
      isBandHidden: boolean
      mode: Mode
      isMuted: boolean
      isTurnRunning: boolean
      agents: Agent[]
      quotaSamples: QuotaSample[]
      alerted: string[]
      etaFactor: number
      model: ModelInfo | null
    }
  }
}
