---
name: ui-review
description: Launch a throwaway headless infinidraw instance, draw on the canvas and screenshot it to review UI changes. Use after changing anything under src/ that affects rendering (renderer.ts, index.css, index.html, canvas or toolbar code), or when asked to check, review or screenshot the UI.
---

# UI review

`scripts/ui.mjs` runs the dev build headless (no window, no Xvfb) with a temp profile, so it cannot touch the user's own app data and it runs alongside their dev instance. All state lives in `/tmp/infinidraw-ui`.

```bash
node scripts/ui.mjs start [1280x800]           # waits until the app has rendered
node scripts/ui.mjs shot [file.png]            # prints the PNG path, then Read it
node scripts/ui.mjs click <css | text=... | x,y>
node scripts/ui.mjs hover <css | text=... | x,y>
node scripts/ui.mjs drag 200,200 500,400       # press, move in steps, release
node scripts/ui.mjs key r                      # single chars, named keys, or Ctrl+z / Shift+Ctrl+z
node scripts/ui.mjs type "some text"           # into the focused element (e.g. a text shape)
node scripts/ui.mjs eval "<js>"                # runs in the renderer, prints the JSON result
node scripts/ui.mjs stop                       # kills the app and deletes /tmp/infinidraw-ui
```

## Workflow

1. `start`.
2. Get the canvas into the state your change affects: pick a tool (toolbar `click` or its shortcut `key`), `drag` to draw shapes, `click` to select them. Then `shot` and Read the PNG.
3. Review it against the Styling section of `AGENTS.md`: minimal, shape-first, no clutter.
4. Renderer edits hot-reload into the running instance, so just shoot again. Changes to `main.ts` or `preload.ts` need `stop` then `start`.
5. Always `stop` when done, including after failures.

## Notes

- Coordinates for `click`, `hover` and `drag` are viewport pixels at the `start` size, with 0,0 at the top left.
- `text=` matches the innermost visible element containing that text. Canvas content has no DOM, so target shapes by coordinates.
- Prefer `eval` over screenshots for factual checks (shape count in app state, selected tool, computed styles). Use screenshots for layout and visual review.
- Exercise the interaction, not just the end state: draw, select, move, resize, undo (`key Ctrl+z`) where the change touches them.
- The app renders the shared working tree, so another agent's unfinished edits can show up. If `git status` lists changes that aren't yours, wait until they're done before reviewing.
- If `start` fails, read `/tmp/infinidraw-ui/app.log`, then run `stop` before retrying.
