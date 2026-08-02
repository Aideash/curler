<script setup lang="ts">
import { onMounted } from 'vue'
import BuildView from './components/BuildView.vue'
import CompareView from './components/CompareView.vue'
import GraphQLBuilderView from './components/GraphQLBuilderView.vue'
import { useRoute } from './composables/useRoute'
import { initStore } from './lib/store'

const { route } = useRoute()

onMounted(initStore)
</script>

<template>
  <BuildView v-if="route === 'build'" />
  <CompareView v-else-if="route === 'compare'" />
  <GraphQLBuilderView v-else />
</template>
