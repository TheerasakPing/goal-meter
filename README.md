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

**Progress**

- **Goal, tasks and subtasks.** One goal on top, main tasks below, the running task's subtasks opened as a tree.
- **A color for each task**, used in its row and in its stretch of one stacked progress bar. Finished work fills the bar, work in progress blinks, work not started stays gray.
- **Status at a glance.** `✔` done (green), `◐` running (amber, spinning), `○` not started (gray). Finished subtasks are struck through.
- **Hands-free.** Claude keeps the meter current through the `update` tool, and when it uses Claude Code's own task list instead (`TodoWrite`, `TaskCreate`, `TaskUpdate`), the meter follows that list by itself.

**Time**

- **Active time, not wall time.** The clock runs only while Claude is working on a turn, so a lunch break does not wreck the ETA. Both are shown: `ทำงานจริง 12m (ผ่านไป 40m)`.
- **ETA that learns.** Each finished goal records how far its half-way prediction was off; later ETAs are scaled by the median of that history.
- **Deadline.** `/goal-meter deadline 17:00` shows whether the ETA makes it, or how late it would be.
- **Pause.** Stop and restart the clock with `/goal-meter pause` / `resume` or the pane's button.

**Cost and quota**

- **Cost per goal and per task**, from the session's spend between start and finish.
- **Usage quota.** Your Claude 5-hour and weekly limits on one row, with percent used and time until reset.
- **Quota forecast.** From how fast each window rose this period: `5 ชม. หมดราว 15:40`. A red warning shows when a window would run out before the goal is done.
- **Quota alerts** at 80% and 90%, as a toast and a sound, once per window period.

**Everything else**

- **Subagents.** Agents Claude starts show in the pane while they run, and their count in the band.
- **Report and history.** `/goal-meter report` gives a Markdown summary for a standup; `/goal-meter history` lists finished goals with their time and cost.
- **Carries over.** A goal in progress is kept when you start a new session.
- **Buttons.** In the pane, press a task to ask Claude to continue it, and use the pause, mode and sound buttons.
- **Sounds** when a goal is reached and when a quota alert fires (`/goal-meter sound off` to mute).

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install goal-meter --marketplace TheerasakPing/goal-meter
```

Answer `y` to add the marketplace, then pick a scope (`user` is recommended). The mod is active right away.

**Update** to the latest version, in a terminal:

```
claude plugin marketplace update goal-meter
claude plugin update goal-meter@goal-meter
```

The first command fetches the new version list, the second updates the installed mod. Then start a new session.

> The `/plugin` command works in a terminal session. A mod installed at the user scope also loads in the desktop app's Code tab.

## Where it works

| Where | Works |
| --- | --- |
| Claude Code in a terminal | ✅ Install and use |
| Claude Desktop, **Code** tab | ✅ Install from a terminal at the `user` scope; it loads there too |
| Claude Code in VS Code, mobile | Should work (not tested) |
| claude.ai chat, Claude app chat | ❌ No mod support there |

The usage quota needs a Claude subscription (Pro or Max) and shows after Claude's first reply in a session. Built against Claude Code 2.1.295's early-access mod API.

## Usage

Give Claude any multi-step task. The meter fills in as Claude works.

| Command | What it does |
| --- | --- |
| `/goal-meter` | Show the meter |
| `/goal-meter <goal>` | Set a goal yourself |
| `/goal-meter pause` · `resume` | Stop or restart the active-time clock |
| `/goal-meter deadline 17:00` | Set a deadline (`off` removes it) |
| `/goal-meter report` | Markdown summary of the goal |
| `/goal-meter history` | Goals finished before |
| `/goal-meter mode status` · `panel` · `both` | Where the meter shows (default `both`) |
| `/goal-meter sound on` · `off` | Sounds for goal done and quota alerts |
| `/goal-meter hide` | Hide the band above the prompt (the status line stays) |
| `/goal-meter pane` | Open the full pane |
| `/goal-meter clear` | Clear the goal |
| `/goal-meter help` | List the commands |

The mode and the sound setting are remembered across sessions. The meter shows in up to three places:

- **Above the prompt**, a two-row band: the goal, the stacked progress bar, ETA, the task in progress, running agents, the deadline and the quota, plus a red line when a quota would run out first.
- **In the status line**, one line of text: `Goal 52% (5/11) · ◐ Build the API · ETA 14:52 | 5 ชม. 47% · สัปดาห์ 24%`.
- **In a pane**, the full meter with every task and subtask, cost per task, quota forecast, agents and buttons. It opens by itself when a goal starts in `panel` or `both` mode, or any time with `/goal-meter pane`.

In the pane: `p` pauses or resumes, `m` cycles the mode, `s` toggles sound, and pressing a task asks Claude to continue it.

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

When Claude uses Claude Code's own task tools instead, the mod reads `TodoWrite`, `TaskCreate` and `TaskUpdate` calls and builds the same list (by task id for `TaskCreate`/`TaskUpdate`). A goal written by the `update` tool wins: the built-in list never overwrites it.

- **Times** are recorded by the mod, not by Claude. An item's clock starts the first time it is seen running and stops the first time it is seen done.
- **Active time** runs from `turn.start` to `turn.complete` of the main conversation, and not while paused.
- **Progress** counts leaf units: each subtask, or the task itself when it has none. Done counts 1, running counts ½.
- **ETA** is `active time × (1 − progress) ÷ progress × factor`. The factor is the median of `actual ÷ predicted` over finished goals (each predicted at its half-way mark), kept between 0.5 and 2, and 1 until two goals are recorded.
- **Cost** of a task is the session's cost when it finished minus the cost when it started.
- **Quota** comes from the rate-limit windows the last API response reported (`$.session.usage()`), so it shows once Claude has answered at least once, and only on a Claude subscription. The forecast needs two readings at least 2 minutes apart in the same window period.

The goal, mode, sound setting and history are kept with `$.store`, so they survive a new session; everything else lives in the session.

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
  register.tsx       events, tools, the command, state, and the two drawings' hooks
  views.tsx          the band above the prompt and the pane
  meter.ts           pure logic: merging, progress, active time, ETA, deadline, bar slices
  quota.ts           quota readings, forecast and alerts
  report.ts          /goal-meter report and history as Markdown
  state.ts           shared constants
  palette.ts         colors
  goal-meter.test.tsx
sounds/              done.wav, alert.wav
types/index.d.ts     the state contract
```

Colors live in `hooks/palette.ts`. Change `PALETTE` or `TASK_COLORS` to restyle the meter.

See [CONTRIBUTING.md](CONTRIBUTING.md) to send a change and [CHANGELOG.md](CHANGELOG.md) for what changed.

## License

[MIT](LICENSE) © TheerasakPing
