<script setup lang="ts">
import { describeIssues, type VariableIssue } from '../lib/vars'

defineProps<{ issues: VariableIssue[] }>()

/** Emitted when the reader accepts the suggestion for one bare reference. */
const emit = defineEmits<{ fix: [name: string] }>()

/**
 * Built here rather than in the template: a braced name closes an
 * interpolation early, since the compiler sees the `}}` before the expression
 * does.
 */
const label = (issue: VariableIssue) => {
  if (issue.kind === 'bare') return `\${${issue.name}}`
  if (issue.kind === 'empty') return `$${issue.name} empty`
  return `$${issue.name}`
}

const suggestion = (issue: VariableIssue) =>
  `$${issue.name} is literal text. Click to write \${${issue.name}} instead, which references the variable.`
</script>

<template>
  <span v-if="issues.length" class="issues" :title="describeIssues(issues)">
    <template v-for="issue in issues" :key="`${issue.kind}:${issue.name}`">
      <button
        v-if="issue.kind === 'bare'"
        class="fix"
        :title="suggestion(issue)"
        :aria-label="suggestion(issue)"
        @click="emit('fix', issue.name)"
      >
        <span class="material-icons sm" aria-hidden="true">auto_fix_high</span>
        {{ label(issue) }}
      </button>
      <span v-else>{{ label(issue) }}</span>
    </template>
  </span>
</template>

<style scoped>
.issues {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/*
 * The chip floats over the right-hand end of a field, so it has to stay out of
 * the way of typing. The container is transparent to the pointer and only the
 * button takes clicks back.
 */
.fix {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--amber);
  background: transparent;
  border-color: var(--amber-border);
  pointer-events: auto;
}

.fix:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--amber);
}

.fix .material-icons {
  vertical-align: 0;
  font-size: 13px;
}
</style>
