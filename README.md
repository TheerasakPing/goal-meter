<div align="center">

# goal-meter

**A live goal meter for Claude Code.** See the big goal, every main task and subtask, what's done, what's running, how long it took and when it will finish, in a pane beside your session.

[![CI](https://github.com/TheerasakPing/goal-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/TheerasakPing/goal-meter/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/tag/TheerasakPing/goal-meter?label=version&color=6366f1)](https://github.com/TheerasakPing/goal-meter/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757.svg)](https://claude.com/claude-code)

[English](README.md) · [ภาษาไทย](README.th.md)

<img src="docs/preview.svg" alt="goal-meter pane: a goal, a stacked progress bar colored per task, elapsed time and ETA, and a task list with subtasks" width="820">

</div>

## Features

- **Goal, tasks and subtasks.** One goal on top, main tasks below, the running task's subtasks opened as a tree.
- **A color for each task.** Every main task gets its own color, used in its row and in its stretch of the progress bar.
- **One stacked progress bar.** Finished work fills the bar in its task's color, work in progress blinks, and work not started stays gray. The bar fills the pane's full width.
- **Time and ETA.** Time spent on the goal and on each task, the time left, and the clock time it should finish.
- **Status at a glance.** `✔` done (green), `◐` running (amber, spinning), `○` not started (gray). Finished subtasks are struck through.
- **Usage quota.** Your Claude 5-hour and weekly limits on one row, each as a bar with percent used and time until reset, plus context fill and session cost. Bars turn from green to red as you use more.
- **Hands-free.** Claude keeps the meter up to date by itself through the `update` tool. You don't have to do anything.
- **Status line.** `Goal 52% (5/11) · ETA 14:52 | 5 ชม. 47% · สัปดาห์ 24%` stays in the status line while the pane is closed.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install goal-meter --marketplace TheerasakPing/goal-meter
```

Answer `y` to add the marketplace, then pick a scope (`user` is recommended). The mod is active right away.

**Update** to the latest version:

```
claude plugin marketplace update goal-meter
```

> The `/plugin` command works in a terminal session. A mod installed at the user scope also loads in the desktop app's Code tab.

## Usage

Give Claude any multi-step task. The meter opens and fills in as Claude works.

| Command | What it does |
| --- | --- |
| `/goal-meter` | Open the pane |
| `/goal-meter <goal>` | Set a goal yourself and open the pane |
| `/goal-meter clear` | Clear the goal |

The pane opens by itself on a wide terminal. On a narrow one, run `/goal-meter` to open it.

## How it works

The mod registers a tool, `mcp__goal-meter__update`, and adds a short note to the system prompt asking Claude to call it whenever a task starts or finishes. Each call sends the full list:

```json
{
  "goal": "Ship the login flow",
  "tasks": [
    { "title": "Design the screens", "status": "done" },
    {
      "title": "Build the API",
      "status": "in_progress",
      "subtasks": [
        { "title": "POST /login", "status": "done" },
        { "title": "Session tokens", "status": "in_progress" },
        { "title": "Rate limiting", "status": "pending" }
      ]
    },
    { "title": "Test end to end", "status": "pending" }
  ]
}
```

- **Times** are recorded by the mod, not by Claude. An item's clock starts the first time it is seen running and stops the first time it is seen done, and items keep their times across calls by title.
- **A task with subtasks** takes its status from them: done when all are done, running when any has started.
- **Progress** counts leaf units: each subtask, or the task itself when it has none. Done counts 1, running counts ½.
- **ETA** is `elapsed × (1 − progress) ÷ progress`, refreshed every half second.

**Quota** comes from the rate-limit windows the last API response reported (`$.session.usage()`), so it shows once Claude has answered at least once, and only on a Claude subscription.

State lives in the session (`$.state`), so it survives a reload of the mod but starts fresh in a new session.

## Development

```bash
git clone https://github.com/TheerasakPing/goal-meter
cd goal-meter
claude --plugin-dir .          # run Claude Code with the mod loaded from this folder
claude plugin validate .       # check the manifest and hooks module
claude plugin test .           # run hooks/*.test.tsx
```

```
.claude-plugin/
  plugin.json        manifest
  marketplace.json   makes this repo installable with /plugin install
hooks/
  hooks.json         points at register.tsx
  register.tsx       events, the tool, the command and the pane
  meter.ts           pure logic: merging updates, progress, ETA, bar slices
  palette.ts         colors
  goal-meter.test.tsx
types/index.d.ts     the state contract
```

Colors live in `hooks/palette.ts`. Change `PALETTE` or `TASK_COLORS` to restyle the meter.

See [CONTRIBUTING.md](CONTRIBUTING.md) to send a change and [CHANGELOG.md](CHANGELOG.md) for what changed.

## License

[MIT](LICENSE) © TheerasakPing
