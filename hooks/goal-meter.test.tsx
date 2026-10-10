import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import type { Goal } from '../types'
import {
  deadlineState,
  estimate,
  etaFactor,
  mergeTasks,
  modelLabel,
  newGoal,
  parseDeadline,
  setPaused,
  slices,
  startActive,
  stopActive,
} from './meter'
import { PALETTE, taskColor } from './palette'
import { addSamples, exhaustAt, newAlerts } from './quota'
import { historyTable, report } from './report'

const SURFACES = ['terminal', 'desktop'] as const
const TOOL = 'mcp__goal-meter__update'
const T0 = Date.parse('2026-10-09T10:00:00Z')

type Usage = { percent?: number; cost?: number; limits?: { kind: string; percentUsed: number; resetsAt?: string }[] }

// The world beneath the mod: clock, store, the ui nouns it calls and the session's usage.
const setup = (on: On, usage: Usage = {}, stored: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, stored)
  const seen = { opened: [] as string[], closed: [] as string[], toasts: [] as string[], sounds: [] as string[], prompts: [] as string[], statuses: [] as (string | undefined)[] }
  on('ui.status', (_$, e) => (seen.statuses.push((e as { text?: string }).text), { value: undefined }) as never)
  on('ui.open', (_$, e) => (seen.opened.push(e.id), { value: { isPlaced: true } }) as never)
  on('ui.close', (_$, e) => (seen.closed.push(e.id), { value: undefined }) as never)
  on('ui.toast', (_$, e) => (seen.toasts.push(String((e as { text: unknown }).text)), { value: undefined }) as never)
  on('audio.play', (_$, e) => (seen.sounds.push(JSON.stringify(e)), { value: undefined }) as never)
  on('prompt.submit', (_$, e) => (seen.prompts.push(e.text), { drop: 'test' }) as never)
  on('session.usage', () => ({
    value: {
      startedAt: T0,
      context: { window: 200_000, ...(usage.percent === undefined ? {} : { percent: usage.percent }) },
      ...(usage.cost === undefined ? {} : { cost: { usd: usage.cost } }),
      rateLimits: usage.limits ?? [],
    },
  }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  return { clock, seen }
}

// The mod's state is read back through what it reports and draws.
type Run = { command: { run: (e: never) => Promise<{ text?: string }> } }
const reportOf = async ($: Run): Promise<string> =>
  (await $.command.run({ command: 'goal-meter', args: 'report' } as never)).text ?? ''

const PANE_PROPS = { title: 'Goal meter', isFocused: false, bodyColumns: 70 } as never
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 90 } as never

const LOGIN = [
  { title: 'Design', status: 'done' },
  {
    title: 'Build',
    status: 'in_progress',
    subtasks: [
      { title: 'API', status: 'done' },
      { title: 'UI', status: 'pending' },
    ],
  },
  { title: 'Test', status: 'pending' },
]

describe('pane', () => {
  for (const surface of SURFACES) {
    test(`colors done, running and pending items on ${surface}`, async ($, on) => {
      const { clock } = setup(on)
      await $.tool.call({ tool: TOOL, goal: 'Ship login', tasks: LOGIN })
      await clock.advance(10 * 60_000)
      await $.tool.call({ tool: TOOL, tasks: LOGIN })

      const ui = await $.ui.mount({ plugin: 'goal-meter', surface, component: 'Pane', requestId: 'goal-meter', props: PANE_PROPS })
      const texts = await ui.findAll({ type: 'Text' })
      const line = (part: string) => texts.find(t => t.text.includes(part))
      const exact = (part: string) => texts.find(t => t.text === part)
      expect(exact(' Design')?.props.color).toBe(taskColor(0))
      expect(exact(' Build')?.props.color).toBe(taskColor(1))
      expect(exact(' Build')?.props.bold).toBe(true)
      expect(exact(' Test')?.props.dimColor).toBe(true)
      expect(exact('API')?.props.strikethrough).toBe(true)
      expect(exact('UI')?.props.dimColor).toBe(true)
      // 10 min elapsed at 50% -> ~10 min left
      expect(line('ทำงานจริง')?.text).toContain('10m00s')
      expect(line('เหลือ')?.text).toContain('~10m00s')
      expect(line('%')?.text).toContain('50%')
      const designBar = texts.find(t => t.props.color === taskColor(0) && t.text.startsWith('█'))
      expect(designBar?.text.length).toBeGreaterThan(0)
    })

    test(`shows the 5-hour and weekly quota on one row on ${surface}`, async ($, on) => {
      setup(on, {
        percent: 38,
        cost: 1.24,
        limits: [
          { kind: 'five_hour', percentUsed: 47, resetsAt: '2026-10-09T12:13:00Z' },
          { kind: 'seven_day', percentUsed: 23.5, resetsAt: '2026-10-12T14:00:00Z' },
        ],
      })
      const ui = await $.ui.mount({ plugin: 'goal-meter', surface, component: 'Pane', requestId: 'goal-meter', props: PANE_PROPS })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts).toContain('5 ชม. ')
      expect(texts).toContain(' 47%')
      expect(texts).toContain(' ↻2h13m')
      expect(texts).toContain('  สัปดาห์ ')
      expect(texts).toContain(' 24%')
      expect(texts).toContain(' ↻3d4h')
      expect(texts).toContain('context 38% · $1.24')
    })

    test(`pause button and task buttons work on ${surface}`, async ($, on) => {
      const { seen } = setup(on)
      await $.tool.call({ tool: TOOL, goal: 'Ship login', tasks: LOGIN })
      const ui = await $.ui.mount({ plugin: 'goal-meter', surface, component: 'Pane', requestId: 'goal-meter', props: PANE_PROPS })

      await ui.press({ key: 'pause' })
      expect((await ui.find({ key: 'pause' }))?.props.label).toBe('นับต่อ')
      await ui.press({ key: 'pause' })
      expect((await ui.find({ key: 'pause' }))?.props.label).toBe('หยุดนับ')

      await ui.press({ key: 'task-2' })
      expect(seen.prompts).toEqual(['ทำงาน "Test" ต่อ'])
    })
  }
})

describe('band above the prompt', () => {
  for (const surface of SURFACES) {
    test(`draws the band and hides it on ${surface}`, async ($, on) => {
      setup(on, { limits: [{ kind: 'five_hour', percentUsed: 47 }] })
      await $.tool.call({ tool: TOOL, goal: 'Ship login', tasks: [{ title: 'Design', status: 'done' }, { title: 'Build', status: 'in_progress' }] })
      const band = () => $.ui.mount({ plugin: 'goal-meter', surface, component: 'AbovePrompt', props: BAND_PROPS })
      const texts = (await (await band()).findAll({ type: 'Text' })).map(t => t.text)
      expect(texts).toContain('Ship login ')
      expect(texts).toContain('2/2 ')
      expect(texts).toContain('Build')
      expect(texts).toContain('5 ชม. ')

      await $.command.run({ command: 'goal-meter', args: 'hide' } as never)
      const hidden = await (await band()).findAll({ type: 'Text' })
      expect(hidden.some(t => t.text === 'Ship login ')).toBe(false)
    })
  }

  test('panel mode leaves the band to the engine and status mode closes the pane', async ($, on) => {
    const { seen } = setup(on)
    await $.tool.call({ tool: TOOL, goal: 'Ship', tasks: [{ title: 'Build', status: 'in_progress' }] })
    expect(seen.opened).toEqual(['goal-meter'])

    await $.command.run({ command: 'goal-meter', args: 'mode panel' } as never)
    const band = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect((await band.findAll({ type: 'Text' })).length).toBe(0)

    await $.command.run({ command: 'goal-meter', args: 'mode status' } as never)
    expect(seen.closed).toEqual(['goal-meter'])
  })

  test('forecasts when a quota window runs out', () => {
    const samples = addSamples([], [{ kind: 'five_hour', percentUsed: 50, resetsAt: '2026-10-09T15:00:00Z' }], T0)
    const later = T0 + 10 * 60_000
    // 50% -> 70% in 10 minutes: 100% about 15 minutes later, before the reset
    expect(exhaustAt(samples, { kind: 'five_hour', percentUsed: 70, resetsAt: '2026-10-09T15:00:00Z' }, later)).toBe(later + 15 * 60_000)
    // a slow rise that resets first gives no forecast
    expect(exhaustAt(samples, { kind: 'five_hour', percentUsed: 51, resetsAt: '2026-10-09T15:00:00Z' }, later)).toBe(null)
  })
})

describe('built-in task list', () => {
  test('mirrors TodoWrite when the meter tool is not in use', async ($, on) => {
    setup(on)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Read the code', status: 'completed', activeForm: 'Reading' },
        { content: 'Fix the bug', status: 'in_progress', activeForm: 'Fixing' },
      ],
    })
    const text = await reportOf($)
    expect(text).toContain('## งานใน session นี้')
    expect(text).toContain('- [x] Read the code')
    expect(text).toContain('- [~] Fix the bug')
  })

  test('mirrors TaskCreate and TaskUpdate by id', async ($, on) => {
    setup(on)
    let next = 1
    on('tool.call', { tool: 'TaskCreate' }, (_$, e) => ({ result: { task: { id: String(next++), subject: (e as { subject: string }).subject } } }) as never)
    on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: (e as { taskId: string }).taskId, updatedFields: [] } }) as never)
    await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: '' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Ship', description: '' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress', subject: 'Ship it' })
    let text = await reportOf($)
    expect(text).toContain('- [x] Write tests')
    expect(text).toContain('- [~] Ship it')

    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
    text = await reportOf($)
    expect(text).not.toContain('Ship it')
    // every task left is done: the goal is reached
    expect(text).toContain('- Finished:')
  })

  test('leaves a goal the meter tool writes alone', async ($, on) => {
    setup(on)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({ tool: TOOL, goal: 'Ship login', tasks: LOGIN })
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Other', status: 'pending', activeForm: 'x' }] })
    const text = await reportOf($)
    expect(text).toContain('## Ship login')
    expect(text).not.toContain('Other')
  })
})

describe('goal lifecycle', () => {
  test('a finished goal toasts, plays a sound and lands in the history', async ($, on) => {
    const { seen } = setup(on, { cost: 2 })
    await $.tool.call({ tool: TOOL, goal: 'Ship', tasks: [{ title: 'Build', status: 'in_progress' }] })
    await $.tool.call({ tool: TOOL, tasks: [{ title: 'Build', status: 'done' }] })
    expect(seen.toasts.some(t => t.startsWith('สำเร็จ: Ship'))).toBe(true)
    expect(seen.sounds.some(s => s.includes('sounds/done.wav'))).toBe(true)
    const { text } = await $.command.run({ command: 'goal-meter', args: 'history' } as never)
    expect(text).toContain('| Ship | 1 |')
  })

  test('deadline, report and pause commands', async ($, on) => {
    setup(on, { cost: 1 })
    await $.tool.call({ tool: TOOL, goal: 'Ship', tasks: LOGIN })
    const set = await $.command.run({ command: 'goal-meter', args: 'deadline 23:59' } as never)
    expect(set.text).toContain('Deadline set')
    expect(await reportOf($)).toContain('- Deadline 23:59')
    const bad = await $.command.run({ command: 'goal-meter', args: 'deadline soon' } as never)
    expect(bad.text).toContain('HH:MM')

    const { text } = await $.command.run({ command: 'goal-meter', args: 'report' } as never)
    expect(text).toContain('## Ship')
    expect(text).toContain('- [x] Design')
    expect(text).toContain('  - [ ] UI')

    const paused = await $.command.run({ command: 'goal-meter', args: 'pause' } as never)
    expect(paused.text).toBe('Active-time clock paused.')
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', component: 'Pane', requestId: 'goal-meter', props: PANE_PROPS })
    expect((await ui.findAll({ type: 'Text' })).some(t => t.text.includes('หยุดนับอยู่'))).toBe(true)
  })
})

describe('pure logic', () => {
  const goalWith = (tasks: Goal['tasks']): Goal => ({ ...newGoal('g', 'meter', 0, null, false), tasks })

  test('slices split the bar by task, done then running then empty', () => {
    const goal = goalWith(mergeTasks(
      [
        { title: 'a', status: 'done' },
        { title: 'b', status: 'in_progress', subtasks: [{ title: '1', status: 'done' }, { title: '2', status: 'in_progress' }, { title: '3', status: 'pending' }] },
      ],
      [],
      0,
    ))
    const [a, b] = slices(goal, 40)
    expect(a).toEqual({ task: 0, done: 10, running: 0, empty: 0 })
    expect(b).toEqual({ task: 1, done: 10, running: 10, empty: 10 })
  })

  test('active time counts only while a turn runs and the clock is not paused', () => {
    let goal = newGoal('g', 'meter', 0, null, false)
    goal = startActive(goal, 1_000)
    goal = stopActive(goal, 61_000) // 60 s of work
    goal = startActive(goal, 600_000)
    goal = setPaused(goal, true, 630_000, true) // 30 s more, then paused
    goal = startActive(goal, 700_000) // ignored while paused
    goal = stopActive(goal, 900_000)
    expect(goal.activeMs).toBe(90_000)
    goal = setPaused(goal, false, 900_000, true)
    expect(goal.activeFrom).toBe(900_000)
  })

  test('ETA uses active time and the history factor', () => {
    const goal = { ...goalWith(mergeTasks([{ title: 'a', status: 'done' }, { title: 'b', status: 'pending' }], [], 0)), activeMs: 60_000 }
    expect(estimate(goal, 3_600_000).remainingMs).toBe(60_000)
    expect(estimate(goal, 3_600_000, 1.5).remainingMs).toBe(90_000)
  })

  test('task cost is the session cost spent between start and done', () => {
    const started = mergeTasks([{ title: 'a', status: 'in_progress' }], [], 0, 1.0)
    const done = mergeTasks([{ title: 'a', status: 'done' }], started, 10, 1.75)
    expect(done[0]?.costUsd).toBe(0.75)
  })

  test('eta factor is the clamped median of actual over predicted', () => {
    const h = (activeMs: number, predictedTotalMs: number) => ({ title: 't', startedAt: 0, doneAt: 1, activeMs, costUsd: null, tasks: 1, predictedTotalMs })
    expect(etaFactor([h(100, 100)])).toBe(1)
    expect(etaFactor([h(150, 100), h(130, 100), h(120, 100)])).toBe(1.3)
    expect(etaFactor([h(900, 100), h(800, 100)])).toBe(2)
  })

  test('deadline parses HH:MM to the next such time and judges the ETA', () => {
    const now = new Date(2026, 9, 9, 16, 0).getTime()
    expect(parseDeadline('17:00', now)).toBe(new Date(2026, 9, 9, 17, 0).getTime())
    expect(parseDeadline('09:30', now)).toBe(new Date(2026, 9, 10, 9, 30).getTime())
    expect(parseDeadline('25:00', now)).toBe(null)
    const goal = { ...goalWith(mergeTasks([{ title: 'a', status: 'done' }, { title: 'b', status: 'pending' }], [], 0)), startedAt: now - 3_600_000, deadlineAt: now + 30 * 60_000 }
    // an hour for half: an hour left, past a deadline 30 minutes away
    expect(deadlineState(goal, now).kind).toBe('late')
  })

  test('quota alerts fire once per threshold and period', () => {
    const limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: 'r1' }]
    const first = newAlerts([], limits)
    expect(first).toEqual(['five_hour|r1|80', 'five_hour|r1|90'])
    expect(newAlerts(first, limits)).toEqual([])
    expect(newAlerts(first, [{ kind: 'five_hour', percentUsed: 85, resetsAt: 'r2' }])).toEqual(['five_hour|r2|80'])
  })

  test('report and history render as Markdown', () => {
    const goal = goalWith(mergeTasks(LOGIN, [], 0))
    expect(report(goal, 60_000, null)).toContain('- [~] Build')
    expect(historyTable([])).toBe('No finished goals yet.')
  })
})

describe('engine events', () => {
  test('active time runs between turn.start and turn.complete', async ($, on) => {
    const { clock } = setup(on)
    on('turn.start', () => ({ turnId: 't1' }) as never)
    on('turn.complete', () => ({ text: '' }) as never)
    await $.tool.call({ tool: TOOL, goal: 'Ship', tasks: [{ title: 'a', status: 'in_progress' }, { title: 'b', status: 'pending' }] })
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await clock.advance(5 * 60_000)
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'end_turn', text: '' } as never)
    await clock.advance(30 * 60_000) // idle: not counted
    const text = await reportOf($)
    expect(text).toContain('- Active time: 5m00s (wall 35m00s)')
  })

  test('quota thresholds toast and sound once', async ($, on) => {
    const { seen } = setup(on)
    on('session.measure', () => ({ changed: ['rateLimits'] }) as never)
    const measure = (pct: number) =>
      $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: pct, resetsAt: 'r1' }], changed: ['rateLimits'] } as never)
    await measure(50)
    await measure(82)
    await measure(83)
    expect(seen.toasts).toEqual(['โควต้า 5 ชม. ใช้ไปแล้ว 80%'])
    expect(seen.sounds.filter(s => s.includes('alert')).length).toBe(1)
  })

  test('subagents show in the pane while they run', async ($, on) => {
    setup(on)
    on('agent.spawn', () => ({ model: 'm', agentId: 'ag1' }) as never)
    on('turn.complete', () => ({ text: '' }) as never)
    await $.agent.spawn({ prompt: 'p', description: 'Search the docs', subagentType: 'Explore' } as never)
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', component: 'Pane', requestId: 'goal-meter', props: PANE_PROPS })
    let texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('Search the docs')
    expect(texts).toContain(' (Explore)')
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'x', agentId: 'ag1', reason: 'end_turn', text: '' } as never)
    texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.some(t => t.startsWith('✔'))).toBe(true)
  })

  test('shows the model the main loop runs on, not a subagent\'s', async ($, on) => {
    const { seen } = setup(on)
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
    })
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)) void _
    for await (const _ of $.turn.step({ turnId: 's', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'ag1' } as never)) void _
    expect(seen.statuses.at(-1)).toBe('Opus 5.5 · high')
    const ui = await $.ui.mount({ plugin: 'goal-meter', surface: 'terminal', component: 'Pane', requestId: 'goal-meter', props: PANE_PROPS })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain(' ◆ Opus 5.5 · high')
    expect((await ui.findAll({ type: 'Box' }))[0]?.props.backgroundColor).toBe(PALETTE.paneBg)
  })

  test('a goal in progress carries over to the next session', async ($, on) => {
    const saved = { ...newGoal('Long job', 'meter', T0 - 3_600_000, null, true), tasks: mergeTasks([{ title: 'a', status: 'in_progress' }], [], T0) }
    setup(on, {}, { goal: saved })
    on('session.start', () => ({ cwd: '/tmp' }) as never)
    on('command.register', () => ({ value: { command: 'goal-meter' } }) as never)
    on('tool.register', () => ({ value: { tool: TOOL } }) as never)
    await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
    const text = await reportOf($)
    expect(text).toContain('## Long job')
    expect(text).toContain('- [~] a')
  })
})

describe('model label', () => {
  test('shortens model ids', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-4-5-20250929[1m]')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('gpt-5.6-sol')).toBe('gpt-5.6-sol')
  })
})
