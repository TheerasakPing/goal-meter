export type Status = 'pending' | 'in_progress' | 'done'

export type Step = {
  title: string
  status: Status
  startedAt: number | null
  doneAt: number | null
}

export type MainTask = Step & { subtasks: Step[] }

// Where the meter shows: the band above the prompt and the status line, the pane, or both.
export type Mode = 'status' | 'panel' | 'both'

export type Goal = {
  title: string
  startedAt: number
  doneAt: number | null
  tasks: MainTask[]
}

declare module 'claude-code' {
  interface PluginState {
    'goal-meter': { goal: Goal | null; now: number; isBandHidden: boolean; mode: Mode }
  }
}
