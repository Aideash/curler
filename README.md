# curler

A local HTTP client for composing, sending and saving curl-style requests.

The browser only draws the interface. Every request is performed by a small Node
server running on your machine, so nothing you send is subject to CORS,
preflight checks, the browser cookie jar or automatic redirect handling. What
you get back is what curl would have shown you.

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

`npm run dev` starts two processes: the API server on port 5174 and the Vite dev
server on 5173, which proxies `/api` through to it. Both ports are configurable,
see [Configuration](#configuration).

To run the built version instead:

```bash
npm run build
npm start          # serves the build and the API together on port 5174
```

## Configuration

Settings come from a `.env` at the project root. Every one is optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `API_PORT` | `5174` | Port the API server binds, and the port Vite proxies `/api` to |
| `UI_PORT` | `5173` | Port the Vite dev server binds |
| `CURLER_HOME` | `~/.curler` | Directory holding the workspace and its backups |
| `CURLER_MAX_UPLOAD_MB` | `32` | Max size per file part and total multipart payload |
| `CURLER_UPLOAD_ALLOW` | unset | Optional comma-separated directory roots; `@path` files must resolve under one (after `realpath`) |
| `CURLER_UPLOAD_DENY` | unset | Optional comma-separated directory roots; deny wins over allow |
| `CURLER_DEBUG` | unset | `1` logs every request to the terminal |

```bash
API_PORT=5174
UI_PORT=5173
```

Both ports resolve through `config.mjs`, which the API server and `vite.config.ts`
share. The Vite proxy target and the port the server actually binds have to
agree, and keeping them in two files is how you end up proxying into nothing.

`PORT` is still accepted as an older spelling of `API_PORT`.

### Running a second, isolated copy

`CURLER_HOME` gives you a completely separate set of collections, environments
and backups. It is worth using whenever something other than you is going to
write to a workspace — a test, a demo, or an agent working on this repo:

```bash
CURLER_HOME=~/.curler-agent API_PORT=5274 UI_PORT=5273 npm run dev
```

A leading `~` is expanded, since no shell has seen the file.

## What it does

**Compose requests.** Method, URL, headers and body, with the body editor backed
by CodeMirror. In JSON mode you get syntax highlighting, bracket matching and
inline error markers on malformed JSON, plus a Format button.

**GraphQL** is a separate body mode: a plain-text query editor and a variables
table for the JSON `variables` object. On send curler posts the usual
`{"query":"...","variables":{...}}` payload with `Content-Type:
application/json`. A `$id` in the query is GraphQL syntax and is sent literally;
`${VAR}` in the variables table is curler syntax and is substituted before the
value is parsed as JSON. Pasting a browser curl that carries a GraphQL body
splits it into this form automatically.

**Quick-add headers.** The Headers tab has a menu of common single headers and
of combinations that come up constantly — "JSON API" adds both `Content-Type`
and `Accept`, "Bearer token" adds an `Authorization` header wired to a variable.

**Import and export curl.** Paste a curl command and it is parsed into a real
request you can edit: methods, headers, `-d` payloads, `-u` basic auth, `-L`,
`-k`, `-m`, clustered short flags like `-sSL`, attached values like `-XPOST`,
and backslash line continuations.

Shell variables survive the trip, and the import follows the shell's own rules
about which ones are real. A pasted `-H "x-api-key: $API_KEY"` becomes the
curler reference `${API_KEY}`, because a shell would have expanded it. A `$id`
inside single quotes or `$'...'` stays literal text, because a shell would not
have — which is what lets a GraphQL body keep the variables its query declares.

Bodies copied from a browser arrive in bash's `$'...'` form whenever they
contain a `!`, a quote or a control character, with every backslash doubled to
survive it. Those escapes are decoded on the way in, so a GraphQL query's `\n`
lands as the JSON escape it started out as rather than a stray `\\n`.

"Copy as curl" goes the other way, and offers two forms.

**Ready to run** substitutes your variables and single-quotes the result, so the
command works anywhere and nothing gets re-expanded by accident. It does put
real credentials on your clipboard.

**Shareable** keeps the references and double-quotes them, so the command reads
as `-H "x-api-key: $API_KEY"` and picks the value up from the environment of
whoever runs it. Braces are only kept where the shell would otherwise read the
following character as part of the name, as in `"${BASE_URL}v1"`. A `$` that is
*not* a reference is escaped instead, so a GraphQL `$id` in the payload arrives
as itself rather than as whatever the reader happens to have in `id`.

`:id` path parameters are expanded in *both* forms, since a shell has no idea
what they mean and would otherwise request the wrong path.

**Variables.** Reference a variable as `${NAME}` anywhere in a request — in the
URL, in header values, and inside the body. The braces are required. A bare
`$NAME` is literal text and is sent exactly as written.

That is stricter than a shell, on purpose. A GraphQL query declares its own
variables as `$id` and means them literally, and there is no shell in the path
to tell curler which reading you had in mind. Requiring the braces means a
pasted query keeps working, and a request that never referenced a variable can
never be blocked for one it does not have.

Because the habit is easy to carry over, a bare name typed into the URL or a
header value is flagged in amber with a one-click fix that adds the braces. The
body is left unflagged, since that is where a literal `$` is usually deliberate.
Requests saved before this rule are converted when the workspace loads — again,
everywhere except the body.

In a URL you can also write `:name`, the way you would in a route: `${BASE_URL}/things/:id`. This form is confined to the URL, because a JSON
body is full of colons that mean something else entirely. It is ignored where a
colon is structural, so `https://`, `localhost:8080` and `admin:hunter2@host`
are all left alone.

Variables live in one of four scopes, listed narrowest first:

| Scope | Visible to | Good for |
| --- | --- | --- |
| Request | one request | an `:id` you flip between a few candidates |
| Collection | every request in that collection | an API key for one service |
| Environment | everything, and swapped as a set from the sidebar | anything that differs between dev and prod |
| Global | everything, always | your own defaults |

A name defined in more than one scope resolves to the **narrowest** definition,
so a request can override a shared value without disturbing it. The Vars dialog
flags rows that are overridden this way, since editing them would otherwise
appear to do nothing.

Toggling a row off makes the next scope out visible again, which is what makes
the `:id` case pleasant: keep three candidate ids on the request and switch
between them with the checkboxes.

**Built-in variables.** `${USER}` and a handful of others are read from the
environment of the server process, so they work without being defined. Only a
short allowlist is exposed — `USER`, `LOGNAME`, `HOSTNAME`, `HOME`, `LANG`,
`SHELL` — rather than the whole environment, which would put your cloud
credentials one typo away from being posted to a third party. Defining a
variable of the same name in any scope overrides the built-in.

If you are used to writing `"updatedBy": "'${USER}'"` in a shell, drop the
single quotes here. Those exist to close and reopen curl's quoted argument so
the *shell* can expand the variable; curler has no shell in the path, so the
quotes would end up as literal characters in the value.

A row — header, form field or variable — counts only once it has *both* a name
and a value, and its checkbox stays disabled until then. New variable rows come
pre-named `API_KEY`, since that is the common case; the name is selected when
you click into it, so typing replaces it the way a placeholder would, while a
second click lets you edit it in place.

**Secret variables.** In the Vars dialog, the lock toggle beside a row stores its
value in your OS keychain rather than in `workspace.json`. The name, scope and
enabled flag still save with the workspace; only the value stays behind on this
machine. Secret values are masked in the editor and show as `(secret)` in
Diagnostics rather than in plain text. Turning the lock off moves the value back
into the workspace file, after a confirmation. Deleting a secret row removes the
keychain entry too, and asks first — there is no undo.

Anything that would quietly break the request is caught before it leaves the
machine. A request that references a variable which is undefined, or defined but
empty, is **not sent at all** — you get an explanation naming the variables
instead of a puzzling 401 from the far end.

**Diagnostics.** Every response has a Diagnostics tab, filled in on every send
whether you asked for it or not — the moment you want this detail is always the
request that already happened.

It opens with how the request was *built*: each variable that was referenced,
the scope that answered for it, the value it resolved to and where in the
request it was used — except secrets, which appear as `(secret)`. Rows dropped
for having a name but no value, or the other way round, are listed too. Between them these answer the question that
otherwise costs twenty minutes: why the request that went out is not the one
you thought you wrote.

Below that is one block per hop, so a redirect chain shows each leg separately
rather than averaging them into a single misleading number:

- status, HTTP version, peer address and port, and whether the connection was
  reused from the pool
- a timing bar broken into DNS, connect, TLS, waiting and download, since
  "800 ms" means something very different when 780 of it was DNS
- the certificate for HTTPS hops — protocol, cipher, subject, issuer, validity
  window and alt names — expanded automatically when it failed verification
- every header sent and received, in curl's `>` and `<` shape, including the
  ones curler adds for you

**Response size cap.** Options carries a cap, 10 MB by default, on how much of a
response body will be read. Past it curler stops pulling bytes off the socket
rather than buffering a download nobody asked for. A capped response says so in
Diagnostics and on the tab itself.

**Terminal-only flags.** Also under Options, and the reason is that a good half
of curl's flags describe a terminal: there is no progress meter here to silence
and no stdout to redirect. Rather than ignore them, curler lets you set them and
appends them to **both** Copy as curl forms, changing nothing about what gets
sent from the app. A preview line shows exactly what will be appended.

Flags that contradict each other cannot both be picked: switch on `--silent` and
`--progress-bar` greys out, explaining why. Flags that are merely useless alone
— `--show-error` without `--silent` — stay available and say so. Importing a
curl command captures these flags too, so a pasted `-sS --retry 3` comes back
out the way it went in.

**Saved requests.** Requests live in collections in the sidebar. Selecting one
loads it; edits to a saved request persist automatically. The sidebar collapses
to an icon rail when you want the room.

**Compare responses.** The **Compare** button in the title bar opens a second
view, at `#/compare`, for putting two responses next to each other: a lower
environment against production, v1 of an endpoint against v2, or two unrelated
sources that ought to agree.

It opens with the request you were editing, saved or not, in both lanes. Change
one lane's environment and send, and you are comparing the same request across
two environments — which is the case it was built for. Two lanes to four.

Each lane carries its method and URL inline, and an **Edit** button for
everything else: the lane's environment, headers, body and options, in the full
request editor. The environment sits at the top of that dialog with the URL it
resolves to shown beside it, so you can see where the lane will actually go
before sending it. Which environment a lane is on stays visible on the lane
itself, and clicking it opens the same editor. The `⋮` menu loads a saved request
into the lane, duplicates it, or removes it.

Every lane sends **on its own**. A lane's Send button touches nothing but that
lane, so re-running one side leaves the other side's response where it is; **Send
all** is a convenience over the same thing and never lets one lane's failure
disturb another. A lane you edit after sending is marked **stale** rather than
having its response cleared, because losing a response you were still reading is
a poor reward for fixing a typo.

Lanes are *copies*. Editing one never writes back to the saved request it came
from, and nothing about a comparison is persisted — closing it costs you nothing
but the responses. Each lane still resolves variables through its own scopes, so
a collection-scoped API key keeps working on a lane loaded from that collection.

**Diff.** Off by default, because two genuinely different payloads are easier to
read side by side than as a diff. Switched on it aligns the two bodies into one
scrolling grid, tinting added, removed and modified lines, with **Changes only**
to collapse the matching parts and **Copy diff** for a unified-style patch to
paste into a ticket. Past three lanes an `A vs B` selector picks the pair.

**Normalise JSON** sorts object keys at every depth before comparing, and it is
on by default: two servers that agree completely can still order their fields
differently, and without this the diff reports every line as changed and tells
you nothing. Array order is left alone, since reordering an array does change
meaning. Text that is not JSON is compared as it arrived.

The **Headers** and **Meta** tabs compare status, timing, size, redirects, final
URL and every response header across all lanes at once, with rows that differ
highlighted and a **Differences only** filter. Header names are matched
case-insensitively, and a header only one side sent is shown as *absent* rather
than as a difference in value. Timing is reported but never flagged: two hosts
always take different amounts of time, and marking that every time would train
you to ignore the marker where it counts.

Very large or wholly dissimilar bodies are not aligned — the diff says so and
suggests reading them side by side instead, rather than hanging while it tries.

**Themes.** The gear in the top right switches between seven themes — Dark,
Light, Cute, Minimalist, BTerminal, Aquatic and Forest — or follows your OS
light/dark setting, which is the default and updates live when the OS flips.

Themes are plain token maps in `src/themes/definitions.ts`. Applying one writes
every token as a CSS custom property on `<html>`, so nothing in the interface
carries a hard-coded colour, the JSON editor included. Adding a theme means
adding one entry to that file; the picker lists it automatically.

The typeface is a token too, so a theme can change it: Cute is set in `cursive`
and BTerminal in `monospace`, both left as the bare generic families for the
browser to fill in from whatever is installed. It lands on `<html>` and reaches
the page by inheritance, which means anything naming its own font is unaffected —
the JSON editor and every monospace run stay monospace under Cute.

Your choice is kept in `localStorage` rather than the workspace file, since it
belongs to the browser you are looking at rather than to your requests.

## Where your data lives

Everything is stored in a single readable file:

```
~/.curler/workspace.json
```

(or wherever `CURLER_HOME` points, see [Configuration](#configuration))

It holds collections, environments and variables at every scope, is written
atomically, and is plain JSON — so you can hand-edit it, diff it, or keep it in
a dotfiles repo. Workspaces written before scopes existed are upgraded in place
on load.

Bear in mind that variable values are stored in clear text. Treat it the way you
would treat a `.env` file.

### Backups

Snapshots are kept alongside the workspace in `backups/`, newest 40 retained.

One is taken on the first change of a session, then at most every five minutes —
saves are debounced but still frequent, and snapshotting every one would burn
through the history in minutes. That interval is ignored in the case that
matters: any save holding **fewer requests than the file it replaces** is
snapshotted immediately, and the filename is tagged `-shrunk`. Recovery is a
file copy.

### Saving is refused when loading failed

If the workspace cannot be read — most likely the API server being restarted
under you — curler shows a **Not saving** badge and writes nothing at all until
a load succeeds.

This matters more than it sounds. A failed read is indistinguishable from an
empty workspace, so seeding defaults and letting autosave write them back turns
a two-second outage into permanent data loss. The app stays usable while
disconnected; it just will not persist. Reload once the server is back.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd`/`Ctrl` + `Enter` | Send the current request, or every lane when comparing |
| `Cmd`/`Ctrl` + `S` | Save an unsaved request |
| `Esc` | Close the open dialog |

Inside a lane's editor, `Cmd`/`Ctrl` + `Enter` sends that lane alone, since it is
the request on screen.

## Layout

```
config.mjs       Ports and workspace location, shared by the server and Vite
server/          Node API server: performs requests, reads and writes the workspace
  client.mjs     The request engine, built on node:https for full control
  storage.mjs    Atomic reads and writes of ~/.curler/workspace.json, plus backups
  index.mjs      HTTP routes, and static serving of the build
src/
  lib/curl.ts    curl parser and serialiser
  lib/vars.ts    Scope merging, ${VAR} and :id resolution, request build trace
  lib/store.ts   Reactive workspace state with debounced persistence
  lib/send.ts    One send, start to finish, shared by the builder and every lane
  lib/response.ts  Status colours, sizes, content type and JSON formatting
  lib/diff.ts    JSON normalisation, line alignment, header and meta comparison
  lib/compare.ts Comparison lanes: copies, per-lane environments, per-lane sends
  lib/terminalFlags.ts  The terminal-only flag catalogue and its conflict rules
  composables/useRoute.ts  Hash routing between the builder and the comparison
  themes/        Theme token maps, and the code that applies and persists them
  components/    Vue 3 single-file components
scripts/
  dev.mjs        Runs the API and Vite dev servers together
  harness.mjs    Shared check runner: quiet on success, loud on failure
  check-config.mjs  Port parsing, bad values, and CURLER_HOME resolution
  check-curl.mjs Parser cases and import/export round-trip checks
  check-vars.mjs Variable resolution, warnings, build trace, per-lane scopes
  check-terminal-flags.mjs  Flag catalogue, conflicts, and curl round-trip
  check-diff.mjs JSON normalisation, alignment, budgets, header and meta rows
  check-compare.mjs  Lanes over loopback: copies, independence, staleness
  check-engine.mjs  The real engine over loopback: diagnostics, TLS, size cap
  check-storage.mjs Backup rotation and the never-overwrite-what-you-cannot-read rule
  check-theme.mjs Every theme is complete, and every colour is legible on it
```

The builder and the comparison are two views over the same workspace, switched on
the URL hash. Two views is not enough to justify a router, and the hash keeps the
back button and a reloaded tab working without any history bookkeeping.

## Checks and logging

`npm run check` runs all nine check scripts. They print one summary line each
when everything passes, and only the failing assertions when it does not:

```
config: 27 checks passed
curl round-trip: 8 checks passed
variables: 65 checks passed
terminal flags: 44 checks passed
diff: 51 checks passed
compare: 50 checks passed
engine: 44 checks passed
storage: 17 checks passed
themes: 126 checks passed
```

`npm run check:verbose` prints every assertion, which is what you want when a
check itself is behaving oddly. `CURLER_VERBOSE=1` does the same for a single
script.

Three of them are worth calling out. The theme check computes WCAG contrast
ratios for every token against the surface it is drawn on, so a new theme cannot
ship a colour that disappears into its own background. The engine check runs real
requests over loopback — including an HTTPS server under a certificate minted at
run time — because truncation, timings and TLS reporting are exactly the things
that look right in isolation and fail against a socket.

The compare check does the same for lanes, sending two of them at a loopback
server that serves a `v1` and a `v2` of one endpoint. It asserts the properties
that are easy to break and hard to notice: that a lane holds a copy and cannot
write back to a saved request, that two lanes resolve two different environments,
that one lane failing leaves another's response intact, and that normalising the
key order reduces that `v1`/`v2` pair to the single field that actually differs.

`npm run dev` is likewise quiet, filtering the restart chatter that `node
--watch` emits on every save. `npm run dev:debug` renders the same diagnostics
the tab shows into the terminal, in curl's `>` and `<` trace shape. It is the
same object either way, so the two cannot drift.

Menus and dialogs render through `PopMenu` and `ModalShell`, both of which
teleport to `<body>`. Anchoring them in place would let the scrolling panes they
sit inside clip them, which z-index cannot fix.

The request engine is written against `node:https` rather than `fetch` because
it needs things `fetch` will not give you: per-request certificate verification
control, explicit redirect handling, and accurate timings.

## Notes

`.npmrc` points at the corporate Artifactory mirror, matching the other projects
on this machine.

Multipart bodies (`curl -F`) use the **Multipart** body tab. File parts use `@path` or curl's
`<path` syntax; `--form-string` (`str`) keeps `@` literal. The attach button copies a picked
file into `CURLER_HOME/upload-staging/` and fills in the absolute `@/path` — only the path is
saved in your workspace. Modifiers `;type=` and `;filename=` round-trip (tune button on each part);
`;headers=` is ignored
with a warning. Relative paths resolve from the server cwd (shown in the editor). Invalid paths
warn in red but do not block send or Copy-as-curl.

Optional `CURLER_UPLOAD_ALLOW` / `CURLER_UPLOAD_DENY` restrict which paths the server will read
(staging files are always allowed). `CURLER_MAX_UPLOAD_MB` caps each file part and the total
multipart payload — separate from the per-request response cap in Options.
