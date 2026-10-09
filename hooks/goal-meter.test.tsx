import { describe, expect, mock, test } from 'claude-code/testing'

import { slices } from './meter'
import { taskColor } from './palette'

const SURFACES = ['terminal', 'desktop'] as const
const TOOL = 'mcp__goal-meter__update'

describe('goal meter', () => {
  for (const surface of SURFACES) {
    test(`colors done, running and pending items on ${surface}`, async ($, on) => {
      const clock = mock.clock(on, { now: 1_000_000 })
      on('ui.status', () => ({ value: undefined }) as never)
      on('ui.open', () => ({ value: { isPlaced: true } }) as never)
      await $.tool.call({
        tool: TOOL,
        goal: 'Ship login',
        tasks: [
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
        ],
      })

      await clock.advance(10 * 60_000)
      await $.tool.call({
        tool: TOOL,
        tasks: [
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
        ],
      })

      const ui = await $.ui.mount({
        plugin: 'goal-meter',
        surface,
        component: 'Pane',
        requestId: 'goal-meter',
        props: { title: 'Goal meter', isFocused: false, bodyColumns: 60 } as never,
      })

      const texts = await ui.findAll({ type: 'Text' })
      const line = (part: string) => texts.find(t => t.text.includes(part))
      const exact = (part: string) => texts.find(t => t.text === part)
      expect(exact(' Design')?.props.color).toBe(taskColor(0))
      expect(exact(' Build')?.props.color).toBe(taskColor(1))
      expect(exact(' Test')?.props.dimColor).toBe(true)
      // Build is running: its subtasks open below it
      expect(exact('API')?.props.strikethrough).toBe(true)
      expect(exact('UI')?.props.dimColor).toBe(true)
      // leaves: Design(done) API(done) UI(pending) Test(pending) -> 50%
      expect(line('%')?.text).toContain('50%')
      // Design's own color fills its stretch of the bar once it is done
      const designBar = texts.find(t => t.props.color === taskColor(0) && t.text.startsWith('█'))
      expect(designBar?.text.length).toBeGreaterThan(0)
      // 10 min elapsed at 50% -> ~10 min left
      expect(line('ใช้ ')?.text).toContain('10m00s')
      expect(line('เหลือ')?.text).toContain('~10m00s')
      expect(exact(' Build')?.props.bold).toBe(true)
    })
  }
})

test('slices split the bar by task, done then running then empty', () => {
  const step = (status: 'pending' | 'in_progress' | 'done') => ({ title: status, status, startedAt: null, doneAt: null })
  const goal = {
    title: 'g',
    startedAt: 0,
    doneAt: null,
    tasks: [
      { ...step('done'), subtasks: [] },
      { ...step('in_progress'), subtasks: [step('done'), step('in_progress'), step('pending')] },
    ],
  }
  const [a, b] = slices(goal, 40)
  expect(a).toEqual({ task: 0, done: 10, running: 0, empty: 0 })
  expect(b).toEqual({ task: 1, done: 10, running: 10, empty: 10 })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`shows the 5-hour and weekly quota on ${surface}`, async ($, on) => {
    const now = Date.parse('2026-10-09T10:00:00Z')
    mock.clock(on, { now })
    on('session.usage', () => ({
      value: {
        startedAt: now,
        context: { window: 200_000, tokens: 76_000, percent: 38 },
        cost: { usd: 1.24 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 47, resetsAt: '2026-10-09T12:13:00Z' },
          { kind: 'seven_day', percentUsed: 23.5, resetsAt: '2026-10-12T14:00:00Z' },
        ],
      },
    }) as never)

    const ui = await $.ui.mount({
      plugin: 'goal-meter',
      surface,
      component: 'Pane',
      requestId: 'goal-meter',
      props: { title: 'Goal meter', isFocused: false, bodyColumns: 60 } as never,
    })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

    expect(texts).toContain('5 ชม. ')
    expect(texts).toContain(' 47%')
    expect(texts).toContain(' ↻2h13m')
    expect(texts).toContain('  สัปดาห์ ')
    expect(texts).toContain(' 24%')
    expect(texts).toContain(' ↻3d4h')
    expect(texts).toContain('context 38% · $1.24')
    // both windows sit on one row
    const rows = await ui.findAll({ type: 'Box' })
    const quotaRow = rows.find(r => r.text.startsWith('โควต้า'))
    expect(quotaRow?.text).toContain('5 ชม.')
    expect(quotaRow?.text).toContain('สัปดาห์')
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`draws the band above the prompt and hides it on ${surface}`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    on('ui.status', () => ({ value: undefined }) as never)
    // what the engine draws when the mod steps aside
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window: 200_000 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 47 }],
      },
    }) as never)
    await $.tool.call({
      tool: TOOL,
      goal: 'Ship login',
      tasks: [
        { title: 'Design', status: 'done' },
        { title: 'Build', status: 'in_progress' },
      ],
    })

    const band = () =>
      $.ui.mount({
        plugin: 'goal-meter',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
      })
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
  mock.clock(on, { now: 1_000_000 })
  const opened: string[] = []
  const closed: string[] = []
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.open', (_$, e) => (opened.push(e.id), { value: { isPlaced: true } }) as never)
  on('ui.close', (_$, e) => (closed.push(e.id), { value: undefined }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  await $.tool.call({ tool: TOOL, goal: 'Ship', tasks: [{ title: 'Build', status: 'in_progress' }] })
  expect(opened).toEqual(['goal-meter'])

  await $.command.run({ command: 'goal-meter', args: 'mode panel' } as never)
  const band = await $.ui.mount({
    plugin: 'goal-meter',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
  })
  expect((await band.findAll({ type: 'Text' })).length).toBe(0)

  await $.command.run({ command: 'goal-meter', args: 'mode status' } as never)
  expect(closed).toEqual(['goal-meter'])
})
