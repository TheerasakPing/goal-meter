import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Goal, Step } from '../types'
import { estimate, formatClock, formatDuration, mergeTasks, progress } from './meter'
import type { TaskInput } from './meter'
import { PALETTE, STATUS_COLOR, gradientAt, icon } from './palette'

const PANE = 'goal-meter'
const TOOL = 'mcp__goal-meter__update'
const goalAtom = atom({ plugin: 'goal-meter', key: 'goal' } as const, null)
const nowAtom = atom({ plugin: 'goal-meter', key: 'now' } as const, 0)

const SEGMENTS = 10

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'The big goal in one line. Omit to keep the current one.' },
    tasks: {
      type: 'array',
      description: 'The FULL list of main tasks, in order (it replaces the previous list).',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
              },
              required: ['title', 'status'],
            },
          },
        },
        required: ['title', 'status'],
      },
    },
  },
}

const GUIDE = [
  '# Goal meter',
  `The person watches a goal meter pane. For any multi-step task, call ${TOOL} first with the big goal and the main tasks (each with subtasks where useful), all "pending" or "in_progress".`,
  'Call it again, with the full list, every time a task or subtask starts or finishes, so the colors, elapsed time and ETA stay true. Mark everything "done" when the goal is reached.',
].join('\n')

const statusLine = (goal: Goal, now: number): string => {
  const { done, total, ratio } = progress(goal)
  const { remainingMs, etaAt } = estimate(goal, now)
  const pct = Math.round(ratio * 100)
  if (goal.doneAt !== null) return `Goal: ${goal.title} · เสร็จแล้ว ✔`
  const eta = etaAt === null || remainingMs === null ? 'ETA –' : `ETA ${formatClock(etaAt)}`

  return `Goal ${pct}% (${done}/${total}) · ${eta}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'goal-meter',
      description: 'Goal meter: open the pane, set a goal, or clear it',
      argumentHint: '[goal text | clear]',
    })
    await $.tool.register({
      name: 'update',
      description:
        'Update the goal meter the person watches: the big goal, main tasks and subtasks with their status (pending, in_progress, done). Send the full task list every call.',
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    const startNow = await $.clock.now()
    await update($, nowAtom, () => startNow)
    $.clock.every(1000, () => {
      void $.clock.now().then(now => update($, nowAtom, () => now))
    })
    const goal = await read($, goalAtom)
    if (goal !== null) {
      $.ui.status(statusLine(goal, startNow))
      void $.ui.open({ id: PANE, title: 'Goal meter' }).catch(() => undefined)
    }

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

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { goal?: string; tasks?: TaskInput[] }
    const now = await $.clock.now()
    const prev = await read($, goalAtom)
    const title = input.goal?.trim() || prev?.title || 'เป้าหมาย'
    const isNewGoal = prev === null || (input.goal !== undefined && input.goal.trim() !== prev.title)
    const base: Goal = isNewGoal
      ? { title, startedAt: now, doneAt: null, tasks: [] }
      : { ...prev, title }
    const tasks = input.tasks === undefined ? base.tasks : mergeTasks(input.tasks, base.tasks, now)
    const isDone = tasks.length > 0 && tasks.every(task => task.status === 'done')
    const goal: Goal = { ...base, tasks, doneAt: isDone ? (base.doneAt ?? now) : null }

    await update($, goalAtom, () => goal)
    $.ui.status(statusLine(goal, now))
    if (isNewGoal) void $.ui.open({ id: PANE, title: 'Goal meter' }).catch(() => undefined)
    if (isDone && base.doneAt === null) {
      $.ui.toast(`สำเร็จ: ${goal.title} (${formatDuration(estimate(goal, now).elapsedMs)})`)
    }
    const { done, total } = progress(goal)

    return { result: `Goal meter updated: ${done}/${total} done.` }
  })

  on('command.run', { command: 'goal-meter' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'clear') {
      await update($, goalAtom, () => null)
      $.ui.status(undefined)

      return { text: 'Goal meter cleared.' }
    }
    if (args !== '') {
      const now = await $.clock.now()
      const goal: Goal = { title: args, startedAt: now, doneAt: null, tasks: [] }
      await update($, goalAtom, () => goal)
      $.ui.status(statusLine(goal, now))
    }
    await $.ui.open({ id: PANE, title: 'Goal meter' })

    return { text: args === '' ? 'Goal meter opened.' : `Goal set: ${args}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const goal = await read($, goalAtom)
    const now = Math.max(await read($, nowAtom), await $.clock.now())
    const cols = e.props.bodyColumns || e.viewport?.columns || 50

    const badge = (
      <Text backgroundColor={PALETTE.header} color={PALETTE.onHeader} bold>
        {' GOAL '}
      </Text>
    )

    if (goal === null) {
      return (
        <Box>
          {badge}
          <Text dimColor> ยังไม่มีเป้าหมาย — /goal-meter &lt;เป้าหมาย&gt;</Text>
        </Box>
      )
    }

    const { done, total, ratio } = progress(goal)
    const { elapsedMs, remainingMs, etaAt } = estimate(goal, now)
    const isGoalDone = goal.doneAt !== null
    const width = Math.max(SEGMENTS, Math.min(24, cols - 30))
    const seg = width / SEGMENTS
    const filledCells = Math.round(Math.min(1, ratio) * width)
    const segments = Array.from({ length: SEGMENTS }, (_, k) => {
      const from = Math.round(k * seg)
      const to = Math.round((k + 1) * seg)
      const full = Math.max(0, Math.min(to, filledCells) - from)
      return { full: '█'.repeat(full), empty: '░'.repeat(to - from - full), color: gradientAt((k + 0.5) / SEGMENTS) }
    })
    const stepTime = (step: Step): string =>
      step.startedAt === null ? '' : formatDuration((step.doneAt ?? now) - step.startedAt)
    const dots = (subs: readonly Step[]) =>
      subs.map(sub => (
        <Text color={STATUS_COLOR[sub.status]}>{sub.status === 'done' ? '●' : sub.status === 'in_progress' ? '◉' : '·'}</Text>
      ))

    return (
      <Box flexDirection="column">
        <Box>
          {badge}
          <Text bold color={isGoalDone ? PALETTE.done : 'claude'} wrap="truncate-end">
            {` ${goal.title}`}
          </Text>
        </Box>
        <Box>
          {segments.map(s => (
            <Text color={s.color}>{s.full}</Text>
          ))}
          <Text color="subtle">{segments.map(s => s.empty).join('')}</Text>
          <Text bold color={gradientAt(ratio)}>{` ${Math.round(ratio * 100)}%`}</Text>
          <Text dimColor>{` ${done}/${total} `}</Text>
          <Text color={PALETTE.elapsed}>{`ใช้ ${formatDuration(elapsedMs)}`}</Text>
          {isGoalDone ? (
            <Text bold color={PALETTE.done}> · สำเร็จ ✔</Text>
          ) : remainingMs === null || etaAt === null ? (
            <Text color={PALETTE.remaining}> · ประเมิน…</Text>
          ) : (
            <Box>
              <Text color={PALETTE.remaining}>{` · เหลือ ~${formatDuration(remainingMs)}`}</Text>
              <Text color={PALETTE.eta} bold>{` · เสร็จ ${formatClock(etaAt)}`}</Text>
            </Box>
          )}
        </Box>
        {goal.tasks.map((task, i) => {
          const isOpen = task.status === 'in_progress' && task.subtasks.length > 0
          return (
            <Box flexDirection="column">
              <Box justifyContent="space-between">
                <Box>
                  <Text color={STATUS_COLOR[task.status]} bold>{`${icon(task.status, now)} `}</Text>
                  <Text color={PALETTE.header} bold>{`${i + 1}.`}</Text>
                  <Text
                    color={task.status === 'pending' ? 'text' : STATUS_COLOR[task.status]}
                    bold={task.status === 'in_progress'}
                    dimColor={task.status === 'pending'}
                    wrap="truncate-end"
                  >
                    {` ${task.title}`}
                  </Text>
                </Box>
                <Box>
                  {!isOpen && dots(task.subtasks)}
                  <Text color={STATUS_COLOR[task.status]} dimColor={task.status !== 'in_progress'}>
                    {stepTime(task) ? ` ${stepTime(task)}` : ''}
                  </Text>
                </Box>
              </Box>
              {isOpen &&
                task.subtasks.map((sub, j) => (
                  <Box>
                    <Text color="subtle">{j === task.subtasks.length - 1 ? '  └ ' : '  ├ '}</Text>
                    <Text color={STATUS_COLOR[sub.status]}>{`${icon(sub.status, now)} `}</Text>
                    <Text
                      color={sub.status === 'pending' ? 'text' : STATUS_COLOR[sub.status]}
                      dimColor={sub.status !== 'in_progress'}
                      strikethrough={sub.status === 'done'}
                      wrap="truncate-end"
                    >
                      {sub.title}
                    </Text>
                  </Box>
                ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
