<script setup lang="ts">
import { computed } from 'vue'
import { SCOPE_LABELS, type Diagnostics, type HopDiagnostics } from '../types'
import type { BuildTrace } from '../lib/vars'

const props = defineProps<{
  diagnostics: Diagnostics | null
  trace: BuildTrace | null
}>()

const hops = computed(() => props.diagnostics?.hops ?? [])

function ms(value: number | null): string {
  if (value === null) return '—'
  return value < 1 ? `${Math.round(value * 1000)} µs` : `${value.toFixed(1)} ms`
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

/** The stages that actually happened, for the timing bar. */
function stages(hop: HopDiagnostics) {
  return [
    { label: 'DNS', value: hop.timings.dnsMs, tone: 'dns' },
    { label: 'Connect', value: hop.timings.connectMs, tone: 'connect' },
    { label: 'TLS', value: hop.timings.tlsMs, tone: 'tls' },
    { label: 'Waiting', value: hop.timings.waitingMs, tone: 'waiting' },
    { label: 'Download', value: hop.timings.downloadMs, tone: 'download' },
  ].filter((stage) => stage.value !== null && stage.value > 0) as {
    label: string
    value: number
    tone: string
  }[]
}

function share(hop: HopDiagnostics, value: number): string {
  const total = stages(hop).reduce((sum, stage) => sum + stage.value, 0)
  return total > 0 ? `${(value / total) * 100}%` : '0%'
}

function statusTone(status: number): string {
  if (status >= 500) return 'red'
  if (status >= 400) return 'amber'
  if (status >= 300) return 'purple'
  return 'green'
}
</script>

<template>
  <div class="diag">
    <!-- How the request was built ------------------------------------- -->
    <section v-if="trace" class="block">
      <h3>Request build</h3>

      <p v-if="!trace.variables.length" class="faint small">No variables were referenced.</p>

      <div v-for="entry in trace.variables" :key="entry.name" class="var-row">
        <span class="mono var-name">${{ entry.name }}</span>
        <span v-if="entry.scope" class="scope-chip">{{ SCOPE_LABELS[entry.scope] }}</span>
        <span v-else class="scope-chip unresolved">unresolved</span>
        <span class="mono var-value" :class="{ blank: !entry.value }">
          {{ entry.value || '(empty)' }}
        </span>
        <span class="faint small var-used">{{ entry.usedIn.join(', ') }}</span>
      </div>

      <p v-if="trace.droppedHeaders.length" class="notice">
        <span class="material-icons sm">filter_alt</span>
        Headers left out for missing a name or a value:
        <span class="mono">{{ trace.droppedHeaders.join(', ') }}</span>
      </p>
      <p v-if="trace.droppedFields.length" class="notice">
        <span class="material-icons sm">filter_alt</span>
        Form fields left out for missing a name or a value:
        <span class="mono">{{ trace.droppedFields.join(', ') }}</span>
      </p>
    </section>

    <p v-if="diagnostics?.truncated" class="notice warn">
      <span class="material-icons sm">content_cut</span>
      The response was cut off at the {{ diagnostics.maxResponseMb }} MB cap. Raise it in the
      Options tab to read the whole thing.
    </p>

    <!-- One block per hop ---------------------------------------------- -->
    <section v-for="hop in hops" :key="hop.index" class="block">
      <h3>
        <span v-if="hops.length > 1" class="hop-index">Hop {{ hop.index + 1 }}</span>
        <span class="mono">{{ hop.method }} {{ hop.url }}</span>
      </h3>

      <div class="facts">
        <span class="chip" :class="statusTone(hop.status)">
          HTTP/{{ hop.httpVersion }} {{ hop.status }} {{ hop.statusText }}
        </span>
        <span v-if="hop.remoteAddress" class="fact mono">
          {{ hop.remoteAddress }}:{{ hop.remotePort }}
        </span>
        <span v-if="hop.reusedConnection" class="fact">reused connection</span>
        <span v-if="hop.bodySkipped" class="fact">body not downloaded</span>
        <span v-else class="fact">
          {{ bytes(hop.wireBytes) }} on the wire
          <template v-if="hop.contentEncoding">
            · {{ bytes(hop.decodedBytes) }} after {{ hop.contentEncoding }}
          </template>
        </span>
      </div>

      <!-- Timings -->
      <div v-if="stages(hop).length" class="timing">
        <div class="bar">
          <span
            v-for="stage in stages(hop)"
            :key="stage.label"
            class="segment"
            :class="stage.tone"
            :style="{ width: share(hop, stage.value) }"
            :title="`${stage.label} ${ms(stage.value)}`"
            aria-hidden="true"
          />
        </div>
        <div class="legend">
          <span v-for="stage in stages(hop)" :key="stage.label" class="legend-item">
            <span class="swatch" :class="stage.tone" />
            {{ stage.label }}
            <span class="mono faint">{{ ms(stage.value) }}</span>
          </span>
          <span class="legend-item total">
            Total <span class="mono">{{ ms(hop.timings.totalMs) }}</span>
          </span>
        </div>
      </div>

      <!-- TLS -->
      <details v-if="hop.tls" class="sub" :open="!hop.tls.authorized">
        <summary>
          TLS
          <span class="faint">
            {{ hop.tls.protocol }} · {{ hop.tls.cipher }}
            <template v-if="!hop.tls.authorized"> · not verified</template>
          </span>
        </summary>
        <div class="kv">
          <span>Subject</span><span class="mono">{{ hop.tls.subject ?? '—' }}</span>
        </div>
        <div class="kv">
          <span>Issuer</span><span class="mono">{{ hop.tls.issuer ?? '—' }}</span>
        </div>
        <div class="kv">
          <span>Valid</span
          ><span class="mono">{{ hop.tls.validFrom }} → {{ hop.tls.validTo }}</span>
        </div>
        <div v-if="hop.tls.altNames" class="kv">
          <span>Alt names</span><span class="mono">{{ hop.tls.altNames }}</span>
        </div>
        <div v-if="hop.tls.authorizationError" class="kv">
          <span>Error</span><span class="mono err">{{ hop.tls.authorizationError }}</span>
        </div>
      </details>

      <!-- The exchange, in curl's own > and < shape -->
      <details class="sub">
        <summary>
          Headers sent and received
          <span class="faint">
            {{ hop.requestHeaders.length }} sent · {{ hop.responseHeaders.length }} received
          </span>
        </summary>
        <pre
          class="wire mono"
        ><span class="sent">&gt; {{ hop.method }} {{ hop.requestTarget }} HTTP/1.1</span>
<span v-for="([name, value], i) in hop.requestHeaders" :key="'q' + i" class="sent">&gt; {{ name }}: {{ value }}</span>
<span v-if="hop.requestBodyBytes" class="sent">&gt; <em>[{{ bytes(hop.requestBodyBytes) }} of body]</em></span>
<span class="recv">&lt; HTTP/{{ hop.httpVersion }} {{ hop.status }} {{ hop.statusText }}</span>
<span v-for="([name, value], i) in hop.responseHeaders" :key="'s' + i" class="recv">&lt; {{ name }}: {{ value }}</span></pre>
      </details>
    </section>
  </div>
</template>

<style scoped>
.diag {
  padding: 12px 16px 20px;
}

.block {
  margin-bottom: 18px;
}

h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
}

h3 .mono {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hop-index {
  flex: none;
}

.small {
  font-size: 12px;
}

/* Variables ------------------------------------------------------------- */

.var-row {
  display: grid;
  grid-template-columns: minmax(90px, auto) auto minmax(80px, 1fr) auto;
  gap: 10px;
  align-items: baseline;
  padding: 3px 0;
  font-size: 12px;
}

.var-name {
  color: var(--accent);
}

.scope-chip {
  justify-self: start;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 9px;
  background: var(--bg-hover);
  color: var(--text-dim);
}

.scope-chip.unresolved {
  color: var(--red);
  border: 1px solid var(--red-border);
}

.var-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.var-value.blank {
  color: var(--amber);
}

.var-used {
  justify-self: end;
  text-align: right;
}

/* Facts ----------------------------------------------------------------- */

.facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.chip {
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-input);
  border: 1px solid var(--border-strong);
}

.chip.green {
  color: var(--green);
  border-color: var(--green-border);
}
.chip.amber {
  color: var(--amber);
  border-color: var(--amber-border);
}
.chip.red {
  color: var(--red);
  border-color: var(--red-border);
}
.chip.purple {
  color: var(--purple);
  border-color: var(--purple-border);
}

.fact {
  font-size: 12px;
  color: var(--text-dim);
}

/* Timings --------------------------------------------------------------- */

.timing {
  margin-bottom: 12px;
}

.bar {
  display: flex;
  height: 7px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-input);
}

.segment {
  height: 100%;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--text-dim);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-item.total {
  margin-left: auto;
  color: var(--text);
}

.swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.dns {
  background: var(--purple);
}
.connect {
  background: var(--accent);
}
.tls {
  background: var(--green);
}
.waiting {
  background: var(--amber);
}
.download {
  background: var(--text-faint);
}

/* Sub-sections ---------------------------------------------------------- */

.sub {
  border-top: 1px solid var(--border);
  padding: 8px 0;
  font-size: 12px;
}

.sub summary {
  cursor: pointer;
  user-select: none;
}

.sub summary .faint {
  font-weight: 400;
}

.kv {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 12px;
  padding: 3px 0 3px 16px;
}

.kv > span:first-child {
  color: var(--text-faint);
}

.kv .mono {
  word-break: break-all;
}

.err {
  color: var(--red);
}

.wire {
  margin: 8px 0 0;
  padding: 10px 12px;
  background: var(--bg-input);
  border-radius: var(--radius);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
}

.wire span {
  display: block;
}

.sent {
  color: var(--syntax-key);
}

.recv {
  color: var(--syntax-string);
}

.notice {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  margin: 12px 0 0;
  padding: 8px 12px;
  border: 1px solid var(--amber-border);
  border-radius: var(--radius);
  color: var(--amber);
  font-size: 12px;
  line-height: 1.5;
}

.notice .material-icons {
  vertical-align: -3px;
}
</style>
