<script setup lang="ts">
import { onMounted } from 'vue'
import BuildView from './components/BuildView.vue'
import CompareView from './components/CompareView.vue'
import GraphQLBuilderView from './components/GraphQLBuilderView.vue'
import HelpView from './components/HelpView.vue'
import { useResetFocusShortcut } from './composables/useSkipFocus'
import { useRoute } from './composables/useRoute'
import { initStore } from './lib/store'

const { route } = useRoute()

useResetFocusShortcut()
onMounted(initStore)
</script>

<!-- <template>
  <BuildView v-if="route === 'build'" />
  <CompareView v-else-if="route === 'compare'" />
  <GraphQLBuilderView v-else-if="route === 'graphql'" />
  <HelpView v-else />
</template> -->

<template>
  <div class="app-container">
    <transition name="fade-in-out">
      <BuildView v-if="route === 'build'" />
      <CompareView v-else-if="route === 'compare'" />
      <GraphQLBuilderView v-else-if="route === 'graphql'" />
      <HelpView v-else-if="route === 'help'" />
    </transition>
  </div>
</template>

<style scoped>
.app-container {
  background-color: var(--bg);
  height: 100vh;
  width: 100vw;
}

.fade-in-out-enter-active,
.fade-in-out-leave-active {
  transition-property: opacity;
  transition-duration: 100ms;
}

.fade-in-out-enter-from,
.fade-in-out-leave-to {
  opacity: 0;
}
</style>
