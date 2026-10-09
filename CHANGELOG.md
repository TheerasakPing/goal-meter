# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- A two-row band above the prompt: goal, stacked progress bar, ETA, the task in progress and the quota.
- `/goal-meter hide` hides the band; `/goal-meter pane` opens the full pane.
- The status line names the task in progress.

### Changed
- The pane no longer opens by itself; the band above the prompt is the default view.

## [0.3.0] - 2026-10-09

### Added
- Claude usage quota in the pane: the 5-hour and weekly windows side by side on one row, each with a bar, percent used and time until it resets, plus context fill and session cost below.
- Quota in the status line (`5 ชม. 47% · สัปดาห์ 24%`), kept current as the engine measures the session.

## [0.2.0] - 2026-10-09

### Added
- A color for each main task, used in its row, its subtasks and its stretch of the progress bar.
- A stacked progress bar across the full pane width: done work in the task's color, running work blinking, the rest gray.

### Changed
- The pane refreshes every 500 ms so running work can blink.
- Stats moved to their own line under the bar.

## [0.1.0] - 2026-10-09

### Added
- Goal meter pane with goal, main tasks and subtasks, colored status, elapsed time and ETA.
- `mcp__goal-meter__update` tool for Claude to keep the meter current.
- `/goal-meter` command to open the pane, set a goal or clear it.
- Status line summary and a toast when the goal is reached.

[0.3.0]: https://github.com/TheerasakPing/goal-meter/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TheerasakPing/goal-meter/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TheerasakPing/goal-meter/releases/tag/v0.1.0
