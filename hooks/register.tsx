import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage } from 'claude-code'

import type { Goal, Step } from '../types'
import { estimate, formatClock, formatDuration, formatSpan, mergeTasks, padDisplay, displayWidth, progress, quotaLabel, slices } from './meter'
import type { TaskInput } from './meter'
import { PALETTE, STATUS_COLOR, gradientAt, icon, taskColor } from './palette'

const PANE = 'goal-meter'
const TOOL = 'mcp__goal-meter__update'
const goalAtom = atom({ plugin: 'goal-meter', key: 'goal' } as const, null)
const nowAtom = atom({ plugin: 'goal-meter', key: 'now' } as const, 0)


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

const quotaLine = (usage: SessionUsage | null): string =>
  (usage?.rateLimits ?? []).map(l => `${quotaLabel(l.kind)} ${Math.round(l.percentUsed)}%`).join(' · ')

const statusLine = (goal: Goal | null, now: number, usage: SessionUsage | null = null): string | undefined => {
  const quota = quotaLine(usage)
  if (goal === null) return quota === '' ? undefined : `โควต้า ${quota}`
  const goalPart = goalStatus(goal, now)

  return quota === '' ? goalPart : `${goalPart} | ${quota}`
}

const goalStatus = (goal: Goal, now: number): string => {
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
    $.clock.every(500, () => {
      void $.clock.now().then(now => update($, nowAtom, () => now))
    })
    const goal = await read($, goalAtom)
    $.ui.status(statusLine(goal, startNow, await $.session.usage().catch(() => null)))
    if (goal !== null) {
      void $.ui.open({ id: PANE, title: 'Goal meter' }).catch(() => undefined)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const goal = await read($, goalAtom)
    $.ui.status(statusLine(goal, await $.clock.now(), { startedAt: 0, ...e }))

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
    $.ui.status(statusLine(goal, now, await $.session.usage().catch(() => null)))
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
      $.ui.status(statusLine(null, 0, await $.session.usage().catch(() => null)))

      return { text: 'Goal meter cleared.' }
    }
    if (args !== '') {
      const now = await $.clock.now()
      const goal: Goal = { title: args, startedAt: now, doneAt: null, tasks: [] }
      await update($, goalAtom, () => goal)
      $.ui.status(statusLine(goal, now, await $.session.usage().catch(() => null)))
    }
    await $.ui.open({ id: PANE, title: 'Goal meter' })

    return { text: args === '' ? 'Goal meter opened.' : `Goal set: ${args}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const goal = await read($, goalAtom)
    const now = Math.max(await read($, nowAtom), await $.clock.now())
    const cols = e.props.bodyColumns || e.viewport?.columns || 50
    const usage = await $.session.usage().catch(() => null)
    const limits = usage?.rateLimits ?? []
    const labelWidth = Math.max(0, ...limits.map(l => displayWidth(quotaLabel(l.kind)))) + 1
    const quotaBar = Math.max(10, cols - labelWidth - 22)
    const quota = (
      <Box flexDirection="column">
        <Box>
          <Text color={PALETTE.header} bold>
            {'โควต้า Claude '}
          </Text>
          {usage?.context.percent !== undefined && (
            <Text dimColor>{`context ${Math.round(usage.context.percent)}%`}</Text>
          )}
          {usage?.cost !== undefined && <Text dimColor>{` · $${usage.cost.usd.toFixed(2)}`}</Text>}
        </Box>
        {limits.length === 0 && <Text dimColor>ยังไม่มีข้อมูลโควต้า (รอการตอบครั้งแรก หรือไม่ได้ใช้ subscription)</Text>}
        {limits.map(limit => {
          const used = Math.min(100, Math.max(0, limit.percentUsed))
          const cells = Math.round((used / 100) * quotaBar)
          const color = gradientAt(1 - used / 100)
          const resetIn = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt) - now
          return (
            <Box>
              <Text>{padDisplay(quotaLabel(limit.kind), labelWidth)}</Text>
              <Text color={color}>{'█'.repeat(cells)}</Text>
              <Text color="subtle">{'░'.repeat(quotaBar - cells)}</Text>
              <Text bold color={color}>{` ${String(Math.round(limit.percentUsed)).padStart(3)}%`}</Text>
              <Text dimColor>{Number.isFinite(resetIn) ? ` รีเซ็ต ${formatSpan(resetIn)}` : ''}</Text>
            </Box>
          )
        })}
      </Box>
    )

    const badge = (
      <Text backgroundColor={PALETTE.header} color={PALETTE.onHeader} bold>
        {' GOAL '}
      </Text>
    )

    if (goal === null) {
      return (
        <Box flexDirection="column">
          <Box>
            {badge}
            <Text dimColor> ยังไม่มีเป้าหมาย — /goal-meter &lt;เป้าหมาย&gt;</Text>
          </Box>
          <Text> </Text>
          {quota}
        </Box>
      )
    }

    const { done, total, ratio } = progress(goal)
    const { elapsedMs, remainingMs, etaAt } = estimate(goal, now)
    const isGoalDone = goal.doneAt !== null
    const pctText = ` ${Math.round(ratio * 100)}%`
    const width = Math.max(10, cols - pctText.length - 1)
    const isBlinkOn = Math.floor(now / 500) % 2 === 0
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
          {slices(goal, width).map(slice => (
            <Box>
              <Text color={taskColor(slice.task)}>{'█'.repeat(slice.done)}</Text>
              <Text color={taskColor(slice.task)} dimColor={!isBlinkOn}>
                {(isBlinkOn ? '▓' : '░').repeat(slice.running)}
              </Text>
              <Text color="subtle">{'░'.repeat(slice.empty)}</Text>
            </Box>
          ))}
          <Text bold color={gradientAt(ratio)}>{pctText}</Text>
        </Box>
        <Box>
          <Text dimColor>{`${done}/${total} · `}</Text>
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
                  <Text
                    color={taskColor(i)}
                    dimColor={task.status === 'in_progress' && !isBlinkOn}
                  >
                    {task.status === 'pending' ? '░' : '█'}
                  </Text>
                  <Text color={taskColor(i)} bold>{` ${i + 1}.`}</Text>
                  <Text
                    color={task.status === 'pending' ? 'text' : taskColor(i)}
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
                      color={sub.status === 'pending' ? 'text' : taskColor(i)}
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
        <Text> </Text>
        {quota}
      </Box>
    )
  })
}
