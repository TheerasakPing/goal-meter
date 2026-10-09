import { describe, expect, mock, test } from 'claude-code/testing'

import { PALETTE } from './palette'

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
      expect(exact(' Design')?.props.color).toBe(PALETTE.done)
      expect(exact(' Build')?.props.color).toBe(PALETTE.running)
      expect(exact(' Test')?.props.dimColor).toBe(true)
      // Build is running: its subtasks open below it
      expect(exact('API')?.props.strikethrough).toBe(true)
      expect(exact('UI')?.props.dimColor).toBe(true)
      // leaves: Design(done) API(done) UI(pending) Test(pending) -> 50%
      expect(line('%')?.text).toContain('50%')
      // 10 min elapsed at 50% -> ~10 min left
      expect(line('ใช้ ')?.text).toContain('10m00s')
      expect(line('เหลือ')?.text).toContain('~10m00s')
      expect(exact(' Build')?.props.bold).toBe(true)
    })
  }
})
