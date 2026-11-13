---
name: ui-review
description: Launch a throwaway headless infinidraw instance, check the UI against baseline snapshots, and drive and screenshot it to review UI changes. Use after changing anything under src/ that affects what the user sees or does (App.tsx, shapes.ts, Menu.tsx, index.css, index.html), or when asked to check, review or screenshot the UI.
---

# UI review

`scripts/ui.mjs` runs the dev build headless (no window, no Xvfb) with a temp profile, so it cannot touch the user's own app data and runs alongside their dev instance. All state lives in `/tmp/infinidraw-ui-$UI_SESSION`.

Always set a session name of your own so you never collide with another agent's instance:

```bash
export UI_SESSION=<short-unique-name>
node scripts/ui.mjs start [1280x800]                 # waits until the app has rendered
node scripts/ui.mjs reset "$(cat .claude/skills/ui-review/scene.json)"   # or reset '{}' for empty
node scripts/ui.mjs snapshots [name...] [--update]   # compare against baselines, see below
node scripts/ui.mjs shot [file.png]                  # prints the PNG path, then Read it
node scripts/ui.mjs click|dblclick|rightclick|hover <css | text=... | x,y>   # click also takes a trailing Shift
node scripts/ui.mjs drag 200,200 500,400 [Shift]     # press, move in steps, release
node scripts/ui.mjs wheel 640,400 0,-300 Ctrl        # Ctrl zooms at the point, without it pans by dx,dy
node scripts/ui.mjs key r                            # single chars, named keys, or Ctrl+z / Shift+Ctrl+z
node scripts/ui.mjs type "some text"                 # into the focused element (the text editor)
node scripts/ui.mjs eval "<js>"                      # runs in the renderer, prints the JSON result
node scripts/ui.mjs stop                             # kills the app and deletes the session dir
```

## Snapshots

`snapshots` resets the app into each state in `SNAPSHOTS` (`scripts/ui.mjs`) and compares a screenshot against `.claude/skills/ui-review/snapshots/<name>.png`: `empty`, `scene`, `selected`, `shape-menu`, `main-menu`, `shortcuts`, `editing`, `inside`, `dark`, `multi-selected` and `bound-arrow`. It needs the default 1280x800 instance.

1. Run `snapshots` after every UI change. Each prints `ok` or how many pixels changed, and the command exits 1 on any change.
2. For each changed one, Read `actual.png` and `diff.png` (changed pixels in red over a faded copy) from `/tmp/infinidraw-ui-$UI_SESSION/snapshots/<name>/`.
3. If the change is unintended, fix the code. If it is intended, show the user `actual.png` and only run `snapshots <name> --update` once they approve.
4. When a new feature adds a UI state, add an entry to `SNAPSHOTS` and run `snapshots <name>` to save its baseline. A missing baseline is saved, not compared.

## Workflow

1. `start`, then `reset` with `scene.json`. It has a labelled rectangle with nested children, a coloured dotted rectangle, arrows and multi-line coloured text, all within 1280x800.
2. Get into the state your change affects, then `shot` and Read the PNG. Things worth seeing:
   - Empty canvas (`reset '{}'`): the hint text.
   - A selected shape: `click 380,320` selects `api`, showing its handles and the sidebar's pressed state.
   - Menus: `rightclick` on a shape or empty canvas, `click 'text=…'`/`click '[aria-label=Menu]'` for the main menu, `key ?` for shortcuts.
   - Text editing: `dblclick` a shape or empty canvas, `type`, then `key Escape`.
   - Inside a rectangle: `wheel 380,320 0,-300 Ctrl` repeatedly until the breadcrumb appears.
   - Dark mode: `reset` with `"infinidraw:theme": "dark"` added to the JSON.
3. Review against the Styling section of `AGENTS.md`: minimal, shape-first, no clutter.
4. Check `grep -E 'CONSOLE.*(Error|Warning)|Uncaught' /tmp/infinidraw-ui-$UI_SESSION/app.log`. Renderer console output is logged there.
5. Renderer edits make Vite reload the page. Shapes, view and theme persist through `localStorage`, but undo history and selection don't. Changes to `main.ts` or `preload.ts` need `stop` then `start`.
6. Always `stop` when done, including after failures.

## Notes

- Coordinates are viewport pixels at the `start` size, 0,0 top left. At 100% zoom with no pan, world and screen coordinates are the same, so shapes from `scene.json` sit where their `x`/`y` say.
- `text=` matches the innermost visible element containing that text. Canvas content has no DOM, so target shapes by coordinates.
- Prefer `eval` over screenshots for facts, e.g. `JSON.parse(localStorage['infinidraw:shapes'])`, `document.querySelector('[aria-label="Reset zoom"]').textContent`, `document.querySelector('nav')?.textContent` (breadcrumb). Use screenshots for layout and visuals.
- Exercise the interaction, not just the end state: draw, select, move, resize, undo (`key Ctrl+z`) where the change touches them.
- `wheel` dispatches a DOM event at the point, because CDP wheel input is hit-tested against the real 1x1 headless window.
- The app renders the shared working tree, so another agent's unfinished edits can show up. If `git status` lists changes that aren't yours, wait until they're done before reviewing.
- If `start` fails, read `app.log` in the session dir, then `stop` before retrying.
