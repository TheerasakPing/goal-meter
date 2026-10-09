import type { Goal, HistoryEntry } from '../types'
import { activeElapsed, deadlineState, estimate, formatClock, formatDuration, formatUsd, progress } from './meter'

const MARK = { done: '[x]', in_progress: '[~]', pending: '[ ]' } as const

const cell = (text: string): string => text.replace(/\|/g, '\\|')

export const report = (goal: Goal, now: number, cost: number | null, factor = 1): string => {
  const { done, total, ratio } = progress(goal)
  const { elapsedMs, remainingMs, etaAt } = estimate(goal, now, factor)
  const spent = cost !== null && goal.costStart !== null ? Math.max(0, cost - goal.costStart) : null
  const deadline = deadlineState(goal, now, factor)
  const lines = [
    `## ${goal.title}`,
    '',
    `- Progress: ${Math.round(ratio * 100)}% (${done}/${total})`,
    `- Active time: ${formatDuration(activeElapsed(goal, now))} (wall ${formatDuration(elapsedMs)})`,
    goal.doneAt !== null
      ? `- Finished: ${formatClock(goal.doneAt)}`
      : `- ETA: ${etaAt === null || remainingMs === null ? 'not yet' : `${formatClock(etaAt)} (~${formatDuration(remainingMs)} left)`}`,
  ]
  if (spent !== null) lines.push(`- Cost: ${formatUsd(spent)}`)
  if (deadline.kind === 'unknown') lines.push(`- Deadline ${formatClock(deadline.at)}`)
  if (deadline.kind === 'on-time') lines.push(`- Deadline ${formatClock(deadline.at)}: on time`)
  if (deadline.kind === 'late') lines.push(`- Deadline ${formatClock(deadline.at)}: about ${formatDuration(deadline.byMs)} late`)
  lines.push('', '### Tasks', '')
  for (const task of goal.tasks) {
    const time = task.startedAt === null ? '' : ` (${formatDuration((task.doneAt ?? now) - task.startedAt)}${task.costUsd !== null ? `, ${formatUsd(task.costUsd)}` : ''})`
    lines.push(`- ${MARK[task.status]} ${task.title}${time}`)
    for (const sub of task.subtasks) lines.push(`  - ${MARK[sub.status]} ${sub.title}`)
  }

  return lines.join('\n')
}

export const historyTable = (history: readonly HistoryEntry[]): string => {
  if (history.length === 0) return 'No finished goals yet.'
  const rows = [...history]
    .reverse()
    .slice(0, 15)
    .map(h => {
      const d = new Date(h.doneAt)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return `| ${date} | ${cell(h.title)} | ${h.tasks} | ${formatDuration(h.activeMs)} | ${formatUsd(h.costUsd) || '–'} |`
    })

  return ['| Done | Goal | Tasks | Active | Cost |', '| --- | --- | ---: | ---: | ---: |', ...rows].join('\n')
}
