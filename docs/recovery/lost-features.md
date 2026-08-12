# Recovering Comment Mode and Browser Detection

Two features were lost with the pre-clone working copy on 2026-08-12: comment
mode and the browser-detection work. Neither was ever pushed, so git has
nothing. What follows is reverse-engineered from the last build that contained
them (`/Applications/Max Studio.app`, built 16:20 that day), whose binary still
holds every Tauri command name, error string and log field.

Raw extraction: `lost-features-strings.txt` in this folder. Rebuild it with

```
strings -n 4 "/Applications/Max Studio.app/Contents/MacOS/ship-studio"
```

as long as that build is still installed. **Do not reinstall or update the app
before these features are rebuilt** — it is the only surviving copy.

This is a specification to rebuild against, not a description of code anyone
has read. The Rust command surface and the persisted shape are certain (they
are literal strings in the binary). Everything about the React components is
inference from commit subjects.

## Comment mode

Pin notes to elements in the preview, then send them to the agent in bulk.

### Tauri commands (certain)

| Command | Arguments seen |
| --- | --- |
| `list_preview_comments` | project path |
| `add_preview_comment` | `comment` |
| `update_preview_comment` | |
| `delete_preview_comment` | |
| `mark_preview_comments_sent` | `ids` |
| `clear_sent_preview_comments` | |
| `reanchor_preview_comment` | |

Persisted to **`comments.json`** under the project's `.shipstudio/`. Field
names visible in the binary: `dom_path`, `added_at`.

### Error strings (certain, reuse verbatim)

- `A comment needs some text`
- `That comment no longer exists.`
- `That note has already gone to the agent, so it can't be moved. Delete it and leave a new one.`
- `Failed to serialize preview comments:`
- `" is not readable as comment data (`

That third message is the whole rule for `reanchor_preview_comment`: a note may
be moved to a different element only while it hasn't been sent yet.

### Menu / shortcut (certain)

`toggle_comments` — "Comment on Elements" — `CmdOrCtrl+Shift+M`.

### Preview bridge (certain, from injected-script comments)

- `/* Comment mode only needs to know WHAT was clicked. selectEl() drives the …`
- `/* Comment pins. The host sends {id,domPath} pairs and we report where those …`

So: the iframe reports the clicked element, and the host sends back
`{id, domPath}` pairs for which the script reports current positions, which is
how pins stay glued to elements while the page scrolls or re-lays out.

### Files that existed (from the lost diffstat, with line counts)

```
src/lib/comments.ts                    348    src/lib/comments.test.ts          186
src/hooks/usePreviewComments.ts        460    …test.ts                          278
src/components/preview/CommentsPanel.tsx   290    …test.tsx                     201
src/components/preview/CommentComposer.tsx 252    …dom.test.tsx 140  …test.ts    91
src/components/preview/CommentPins.tsx      57
src/styles/features/comments.css           441
src-tauri/src/commands/comments.rs         455
```

Touched: `Preview.tsx` (+93), `src-tauri/src/proxy/select_script.html` (+29),
`App.tsx`, `useAppCommands.tsx`, `useTerminalManagement.ts`, `lib/edit.ts`.

### Behaviour, from the commit subjects

In the order they were built:

1. Pin notes to preview elements, send them in bulk.
2. Identify elements so lookalikes are told apart — and say so when they can't be.
3. Send comments to the agent with one click.
4. Don't mark notes sent when nothing received them.
5. Enter sends only behind Cmd-click, not on every send.
6. Keep the note popover inside the preview.
7. Clear sent notes; let the list be ordered.
8. Editable notes, a draggable composer, a shortcut that reaches the preview.
9. Group the note list into sections when sorting by page.
10. An empty state for the empty panel.
11. Move a note to a different element.

Point 2 matters: element identity is the hard part, and the previous
implementation explicitly admitted defeat when two elements were
indistinguishable rather than guessing. `mark_preview_comments_sent` taking
`ids` (plural) is point 4 — only what the terminal actually accepted is marked.

## Browser detection

Branch name: `fix/browser-detection-all-installed`, so the bug was that only
some installed browsers were found.

### Tauri commands (certain)

- `open_url_in_browser`
- `check_browser_availability`

Log fields: `browser_id`, and an event `browser discovery completed`.

### How it detected (certain, from the tooling it shells out to)

- `plutil -o - <app>/Contents/Info.plist` reads `CFBundleIdentifier` — discovery
  is by app bundle, not by executable name on `PATH`. That is very likely the
  fix: enumerate `/Applications`, read each bundle's identifier.
- `sips -Z --out … png` converts each app's `.icns` to PNG, so the dropdown
  showed real browser icons.
- Rejects non-web URLs: `Only http and https URLs can be opened in a browser (got "…`
- Names present: `Google Chrome`, `Firefox`, `Safari`.

### Files that existed

```
src-tauri/src/commands/ide/browsers.rs      531 (new)
src-tauri/src/commands/ide/mod.rs           135 (moved out of here)
src/components/preview/BrowserDropdown.tsx   33 (changed)
src/components/preview/BrowserDropdown.test.tsx  89 (new)
src/lib/browser.ts                            9
src/styles/features/browser-dropdown.css      9
```

`BrowserDropdown.tsx` already exists upstream; the fork changed 33 lines and
added its test.

## Rebuild order

1. `src-tauri/src/commands/comments.rs` against the command list and
   `comments.json` above, plus `lib/comments.ts` as its typed mirror. Both are
   testable without any UI and pin down the contract.
2. Element identity (the `domPath` scheme) with tests — the part most likely to
   be got wrong twice.
3. `usePreviewComments`, then the panel, composer and pins.
4. Browser detection, which is self-contained and can be done independently.
