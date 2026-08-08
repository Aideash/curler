<script setup lang="ts">
import { computed } from 'vue'
import { curlHelpPage, type CurlHelpOption, type CurlHelpPage } from '../../lib/curlHelpData'
import { curlOptionTier, curlOptionTierTitle } from '../../lib/curlOptionSupport'

const props = defineProps<{ pageKey: string }>()

const page = computed((): CurlHelpPage => curlHelpPage(props.pageKey))

function optionClass(option: CurlHelpOption): string {
  return `tier-${curlOptionTier(option)}`
}

function optionTitle(option: CurlHelpOption): string {
  return curlOptionTierTitle(option)
}
</script>

<template>
  <div>
    <p class="cmd-line">Usage: curl [options...] &lt;url&gt;</p>

    <template v-if="page.kind === 'main'">
      <table class="help-options">
        <tbody>
          <tr
            v-for="(option, index) in page.options"
            :key="index"
            :class="optionClass(option)"
            :title="optionTitle(option)"
          >
            <td>{{ option.short }}</td>
            <td>{{ option.long }}</td>
            <td>{{ option.description }}</td>
          </tr>
        </tbody>
      </table>
      <br />
      <p v-for="(line, index) in page.footer" :key="index" class="cmd-line">{{ line }}</p>
    </template>

    <template v-else-if="page.kind === 'categories'">
      <table class="help-options help-categories">
        <tbody>
          <tr v-for="category in page.categories" :key="category.name">
            <td>{{ category.name }}</td>
            <td>{{ category.description }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else>
      <p class="cmd-line">{{ page.title }}</p>
      <table class="help-options">
        <tbody>
          <tr
            v-for="(option, index) in page.options"
            :key="index"
            :class="optionClass(option)"
            :title="optionTitle(option)"
          >
            <td>{{ option.short }}</td>
            <td>{{ option.long }}</td>
            <td>{{ option.description }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.help-categories td:nth-child(1) {
  padding-right: 2ch;
}

tr.tier-none {
  opacity: 0.42;
}

tr.tier-send td:nth-child(1)::before {
  content: '● ';
  color: var(--accent);
  font-size: 0.75em;
  vertical-align: middle;
  margin-left: -1em;
}

tr.tier-ignored {
  opacity: 0.55;
}

tr.tier-ignored td:nth-child(3)::after {
  content: ' dropped';
  color: var(--amber);
  font-size: 0.92em;
}
</style>
