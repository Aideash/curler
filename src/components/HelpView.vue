<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import ThemePicker from './ThemePicker.vue'
import TerminalHelp from './help_terminal/TerminalHelp.vue'
import TitleBar from './TitleBar.vue'
import TitleBarButton from './TitleBarButton.vue'
import { helpScrollTargetFromHash, navigate } from '../composables/useRoute'

const toc = [
  { id: 'overview', label: 'Overview' },
  { id: '--help', label: 'Help' },
  { id: 'requests', label: 'Building requests' },
  { id: 'variables', label: 'Variables' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'curl', label: 'Import & export curl' },
  { id: 'compare', label: 'Compare' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'collections', label: 'Collections & saving' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'data', label: 'Where your data lives' },
] as const

function scrollToSection(id: string | null) {
  if (!id) return
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function onHashChange() {
  scrollToSection(helpScrollTargetFromHash())
}

// function copyToClipboard(text: string) {
//   navigator.clipboard.writeText(text)
// }

onMounted(() => {
  scrollToSection(helpScrollTargetFromHash())
  window.addEventListener('hashchange', onHashChange)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange))
</script>

<template>
  <div class="help">
    <TitleBar>
      <TitleBarButton
        back
        icon="arrow_back"
        label="Builder"
        title="Back to the request builder"
        @click="navigate('build')"
      />
      <span class="heading">Help</span>
      <span class="faint hint">How to use curler</span>

      <div class="spacer" />

      <ThemePicker />
    </TitleBar>

    <div class="content">
      <nav class="toc" aria-label="On this page">
        <img src="/public/android-chrome-512x512.png" alt="curler" class="logo" />
        <h3 class="site-name mono">curler</h3>
        <p class="toc-label faint">On this page</p>
        <ul>
          <li v-for="item in toc" :key="item.id">
            <a :href="`#/help/${item.id}`">{{ item.label }}</a>
          </li>
        </ul>
      </nav>

      <article class="prose">
        <section id="overview">
          <h2>Overview</h2>
          <p>
            Curler is a local HTTP client for composing, sending, and saving curl-style requests.
            The browser draws the interface; a small Node server on your machine performs every
            request. Nothing you send is subject to CORS, preflight checks, the browser cookie jar,
            or automatic redirect handling — what you get back is what curl would have shown you.
          </p>
        </section>

        <section id="--help">
          <TerminalHelp />
          <!-- <div class="faux-terminal mono">
            <p class="cmd-line"><span style="color: var(--syntax-comment)">$</span> curl --help</p>
            <p class="cmd-line">Usage: curl [options...] &lt;url&gt;</p>
            <table class="help-options">
              <tbody>
                <tr>
                  <td>-d,</td>
                  <td>--data &lt;data&gt;</td>
                  <td>HTTP POST data</td>
                </tr>
                <tr>
                  <td>-f,</td>
                  <td>--fail</td>
                  <td>Fail fast with no output on HTTP errors</td>
                </tr>
                <tr>
                  <td>-h,</td>
                  <td>--help &lt;category&gt;</td>
                  <td>Get help for commands</td>
                </tr>
                <tr>
                  <td>-i,</td>
                  <td>--include</td>
                  <td>Include response headers in output</td>
                </tr>
                <tr>
                  <td>-o,</td>
                  <td>--output &lt;file&gt;</td>
                  <td>Write to file instead of stdout</td>
                </tr>
                <tr>
                  <td>-O,</td>
                  <td>--remote-name</td>
                  <td>Write output to file named as remote file</td>
                </tr>
                <tr>
                  <td>-s,</td>
                  <td>--silent</td>
                  <td>Silent mode</td>
                </tr>
                <tr>
                  <td>-T,</td>
                  <td>--upload-file &lt;file&gt;</td>
                  <td>Transfer local FILE to destination</td>
                </tr>
                <tr>
                  <td>-u,</td>
                  <td>--user &lt;user:password&gt;</td>
                  <td>Server user and password</td>
                </tr>
                <tr>
                  <td>-A,</td>
                  <td>--user-agent &lt;name&gt;</td>
                  <td>Send User-Agent &lt;name&gt; to server</td>
                </tr>
                <tr>
                  <td>-v,</td>
                  <td>--verbose</td>
                  <td>Make the operation more talkative</td>
                </tr>
                <tr>
                  <td>-V,</td>
                  <td>--version</td>
                  <td>Show version number and quit</td>
                </tr>
              </tbody>
            </table>
            <br />
            <p class="cmd-line">
              This is not the full help, this menu is stripped into categories.
            </p>
            <p class="cmd-line">Use "--help category" to get an overview of all categories.</p>
            <p class="cmd-line">For all options use the manual or "--help all".</p>
            <button
              class="ghost copy-button"
              title="Copy as curl"
              @click="copyToClipboard('curl --help')"
            >
              <span class="material-icons sm">content_copy</span>
            </button>
          </div> -->
        </section>

        <section id="requests">
          <h2>Building requests</h2>
          <p>
            Set the method and URL at the top, then use the tabs below to configure headers, body,
            variables, and options.
          </p>
          <ul>
            <li>
              <strong>Headers</strong> — add rows manually, or use the quick-add menu for common
              presets like “JSON API” or “Bearer token”.
            </li>
            <li>
              <strong>Body</strong> — choose none, JSON, plain text, form-urlencoded, or GraphQL.
              JSON mode includes syntax highlighting, bracket matching, inline error markers, and a
              Format button.
            </li>
            <li>
              <strong>Options</strong> — follow redirects, skip TLS verification, set a timeout, cap
              response size (1 MB by default), and configure terminal-only curl flags for copy
              commands.
            </li>
          </ul>
          <p>
            Press <kbd>Send</kbd> or use <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd>. The
            response appears below with tabs for the body, headers, and diagnostics.
          </p>
        </section>

        <section id="variables">
          <h2>Variables</h2>
          <p>
            Reference a variable as <code class="mono">${NAME}</code> anywhere in a request — URL,
            headers, and body. The braces are required; a bare <code class="mono">$NAME</code> is
            literal text.
          </p>
          <p>
            In URLs you can also write <code class="mono">:name</code> for path parameters, e.g.
            <code class="mono">${BASE_URL}/things/:id</code>. Colons in structural places like
            <code class="mono">https://</code> or <code class="mono">localhost:8080</code> are left
            alone.
          </p>

          <h3>Scopes</h3>
          <p>
            Variables live in one of four scopes. A name defined in more than one resolves to the
            <em>narrowest</em> definition.
          </p>
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Visible to</th>
                <th>Good for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Request</td>
                <td>One request</td>
                <td>An <code class="mono">:id</code> you flip between candidates</td>
              </tr>
              <tr>
                <td>Collection</td>
                <td>Every request in that collection</td>
                <td>An API key for one service</td>
              </tr>
              <tr>
                <td>Environment</td>
                <td>Everything; swapped as a set from the sidebar</td>
                <td>Values that differ between dev and prod</td>
              </tr>
              <tr>
                <td>Global</td>
                <td>Everything, always</td>
                <td>Your own defaults</td>
              </tr>
            </tbody>
          </table>

          <h3>Tips</h3>
          <ul>
            <li>
              Toggle a row off to let the next scope out show through — useful for switching between
              candidate IDs on one request.
            </li>
            <li>
              Built-in variables like <code class="mono">${USER}</code> and
              <code class="mono">${HOME}</code> are read from the server environment. Defining the
              same name in any scope overrides them.
            </li>
            <li>
              Use the lock toggle on a row to store its value in your OS keychain instead of the
              workspace file. Secret values are masked in the editor and shown as
              <code class="mono">(secret)</code> in diagnostics.
            </li>
            <li>
              A request that references an undefined or empty variable is <strong>not sent</strong>
              — you get an explanation naming the problem instead of a puzzling 401.
            </li>
          </ul>
        </section>

        <section id="graphql">
          <h2>GraphQL</h2>
          <p>
            Choose GraphQL as the body mode for a plain-text query editor and a variables table for
            the JSON <code class="mono">variables</code> object. On send, curler posts the usual
            <code class="mono">{"query":"...","variables":{...}}</code> payload.
          </p>
          <ul>
            <li>
              <code class="mono">$id</code> in the query is GraphQL syntax and is sent literally.
            </li>
            <li>
              <code class="mono">${VAR}</code> in the variables table is curler syntax and is
              substituted before the value is parsed as JSON.
            </li>
            <li>
              Pasting a browser curl with a GraphQL body splits it into query + variables
              automatically.
            </li>
          </ul>
          <p>
            Click <strong>GraphQL</strong> in the title bar (when body mode is GraphQL) to open the
            <strong>GraphQL builder</strong>. Fetch the schema from your endpoint, explore types in
            the sidebar, click fields to insert them into the query, and validate against the schema
            before applying changes back to your request.
          </p>
        </section>

        <section id="curl">
          <h2>Import &amp; export curl</h2>
          <p>
            <strong>Import curl</strong> — paste a curl command and it is parsed into an editable
            request: methods, headers, bodies, basic auth, redirects, TLS skip, timeouts, and
            backslash line continuations. Shell variables become curler references where a shell
            would expand them.
          </p>
          <p><strong>Copy as curl</strong> offers two forms:</p>
          <ul>
            <li>
              <strong>Ready to run</strong> — substitutes variables and single-quotes the result.
              Works anywhere; puts real credentials on your clipboard.
            </li>
            <li>
              <strong>Shareable</strong> — keeps references like
              <code class="mono">-H "x-api-key: $API_KEY"</code> so whoever runs it picks up values
              from their environment.
            </li>
          </ul>
          <p>
            <code class="mono">:id</code> path parameters are expanded in both forms, since a shell
            has no idea what they mean.
          </p>
        </section>

        <section id="compare">
          <h2>Compare</h2>
          <p>
            Click <strong>Compare</strong> in the title bar to put two to four responses side by
            side — dev against prod, v1 against v2, or any pair that ought to agree. It opens with
            the request you were editing in every lane.
          </p>
          <ul>
            <li>
              Each lane sends <strong>on its own</strong>. Re-running one side leaves the other’s
              response intact. A lane edited after sending is marked <em>stale</em> rather than
              clearing its response.
            </li>
            <li>
              Lanes are <strong>copies</strong>. Editing one never writes back to a saved request,
              and nothing about a comparison is persisted.
            </li>
            <li>
              Use <strong>Diff</strong> to align two bodies with added/removed/changed highlighting.
              <strong>Normalise JSON</strong> (on by default) sorts object keys before comparing so
              field order does not create noise.
            </li>
            <li>
              The <strong>Headers</strong> and <strong>Meta</strong> tabs compare status, timing,
              size, redirects, and response headers across all lanes, with a “Differences only”
              filter.
            </li>
          </ul>
        </section>

        <section id="diagnostics">
          <h2>Diagnostics</h2>
          <p>
            Every response includes a Diagnostics tab, filled in on every send whether you asked for
            it or not.
          </p>
          <ul>
            <li>
              <strong>Build trace</strong> — each variable referenced, the scope that answered, the
              resolved value, and where it was used (secrets show as
              <code class="mono">(secret)</code>).
            </li>
            <li>
              <strong>Per-hop details</strong> — status, timing breakdown (DNS, connect, TLS,
              waiting, download), TLS certificate info, and every header sent and received in curl’s
              <code class="mono">&gt;</code> / <code class="mono">&lt;</code> shape.
            </li>
          </ul>
        </section>

        <section id="collections">
          <h2>Collections &amp; saving</h2>
          <p>
            Saved requests live in collections in the sidebar. Select one to load it; edits to a
            saved request persist automatically. Unsaved requests can be saved with the
            <strong>Save</strong> button or <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd>.
          </p>
          <p>
            Switch environments from the sidebar to swap a whole set of variables at once. The
            sidebar collapses to an icon rail when you need more room.
          </p>
          <p>
            If the workspace cannot be read (for example, the API server was restarted), a
            <strong>Not saving</strong> badge appears and nothing is written until a load succeeds.
            Reload once the server is back.
          </p>
        </section>

        <section id="shortcuts">
          <h2>Keyboard shortcuts</h2>
          <table>
            <thead>
              <tr>
                <th>Shortcut</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd></td>
                <td>Send the current request, or every lane when comparing</td>
              </tr>
              <tr>
                <td><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd></td>
                <td>Save an unsaved request</td>
              </tr>
              <tr>
                <td><kbd>Esc</kbd></td>
                <td>Close the open dialog</td>
              </tr>
              <tr>
                <td><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></td>
                <td>Clear focus and jump back to the skip links</td>
              </tr>
            </tbody>
          </table>
          <p class="faint">
            Inside a lane’s editor in Compare, <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd>
            sends that lane alone. On the builder, tabbing in lands on skip links first — use them
            to jump straight to the request or response panel.
          </p>
        </section>

        <section id="data">
          <h2>Where your data lives</h2>
          <p>
            Everything is stored in a single readable file at
            <code class="mono">~/.curler/workspace.json</code> (or wherever
            <code class="mono">CURLER_HOME</code> points). It holds collections, environments, and
            variables at every scope. Variable values are stored in clear text unless marked as
            secrets — treat the file like a <code class="mono">.env</code>.
          </p>
          <p>
            Backups are kept in <code class="mono">backups/</code> alongside the workspace, with the
            newest 40 retained. Your theme is cached in the browser for the first paint, then kept
            in workspace <code class="mono">settings</code> alongside your collections.
          </p>
        </section>
      </article>
    </div>
  </div>
</template>

<style scoped>
.help {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: minmax(140px, 200px) minmax(0, 1240px);
  gap: 32px;
  padding: 24px 32px 48px;
  align-content: start;
}

.toc {
  position: sticky;
  top: 0;
  align-self: start;
}

.toc-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 8px;
}

.toc ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toc a {
  display: block;
  font-size: 12.5px;
  color: var(--text-dim);
  text-decoration: none;
  padding: 3px 0;
  border-left: 2px solid transparent;
  padding-left: 10px;
  margin-left: -10px;
}

.toc a:hover {
  color: var(--text);
  border-left-color: var(--accent-dim);
}

.logo {
  width: 100%;
  padding: 0px 40px 20px 0px;
}

.site-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.02em;
}

.prose {
  min-width: 0;
}

.prose section {
  margin-bottom: 36px;
  scroll-margin-top: 16px;
}

.prose section:last-child {
  margin-bottom: 0;
}

.prose h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.prose h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 8px;
}

.prose p {
  margin: 0 0 12px;
  line-height: 1.55;
  color: var(--text);
}

.prose ul {
  margin: 0 0 12px;
  padding-left: 1.4em;
  line-height: 1.55;
}

.prose li {
  margin-bottom: 6px;
}

.prose li:last-child {
  margin-bottom: 0;
}

.prose code.mono {
  font-size: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}

.prose kbd {
  font-family: var(--mono);
  font-size: 11.5px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 1px 6px;
  box-shadow: 0 1px 0 var(--border);
}

h2 {
  color: var(--accent);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 0 0 12px;
}

th,
td {
  text-align: left;
  padding: 8px 12px;
  border: 1px solid var(--border);
  vertical-align: top;
}

th {
  background: var(--bg-raised);
  font-weight: 600;
  font-size: 12px;
}

td code.mono {
  font-size: 11.5px;
}

/* .faux-terminal {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin: 0 auto;
  padding: 12px;
  font-size: 12px;
  line-height: 1.4;
  max-width: 850px;
  position: relative;
}

.faux-terminal p {
  margin: 0;
}

.faux-terminal .cmd-line + .help-options,
.faux-terminal .help-options + .cmd-line {
  margin-top: 0.35em;
}

.help-options {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
  padding-left: 1ch;
}

.help-options td {
  padding: 0;
  border: none;
  vertical-align: top;
  text-align: left;
}

.help-options td:nth-child(1) {
  width: 1%;
  white-space: nowrap;
  padding-right: 1ch;
}

.help-options td:nth-child(2) {
  width: 1%;
  white-space: nowrap;
  padding-right: 2ch;
}

.cmd-line {
  display: block;
}

.copy-button {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 0;
  margin: 0;
  width: 24px;
  height: 24px;
}

.copy-button:hover {
  background: var(--bg-input);
} */

@media screen and (max-width: 700px) {
  .content {
    grid-template-columns: 1fr;
    padding: 20px 16px 40px;
  }

  .toc {
    position: static;
  }

  .logo {
    display: block;
    height: auto;
    width: 100%;
    max-width: 222px;
    padding: 0 0 20px 0;
    margin: 0 auto;
  }
}
</style>
