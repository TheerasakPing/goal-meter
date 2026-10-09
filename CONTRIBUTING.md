# Contributing

Thanks for helping improve goal-meter.

## Run it locally

```bash
claude --plugin-dir .
```

Claude Code loads the mod from this folder and reloads it when you save a file.

## Before you open a pull request

```bash
claude plugin validate .
claude plugin test .
```

Both must pass. CI runs the same two commands.

- Keep pure logic (merging, progress, ETA, bar slices) in `hooks/meter.ts` and add a test for it.
- Keep colors in `hooks/palette.ts`.
- The engine reads `register.tsx` statically: every function that is given `$`, and every `atom(...)`, must be declared in that file, and hook matchers must be literals. Pure logic and drawing (which gets the element table, not `$`) can live in other files.
- If you change what the pane shows, add or update a test in `hooks/goal-meter.test.tsx` that mounts it on both the `terminal` and `desktop` surfaces.
- Add a line under an `Unreleased` heading in `CHANGELOG.md`.

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Commit, tag `vX.Y.Z`, push the tag, and create a GitHub release.
