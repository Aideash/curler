import { onBeforeUnmount, onMounted, ref } from 'vue'

export type RouteName = 'build' | 'compare'

const ROUTES: Record<string, RouteName> = {
  '#/compare': 'compare',
}

function readRoute(): RouteName {
  return ROUTES[window.location.hash] ?? 'build'
}

const current = ref<RouteName>(readRoute())

function sync() {
  current.value = readRoute()
}

export function navigate(route: RouteName) {
  const hash = route === 'build' ? '#/' : '#/compare'
  if (window.location.hash === hash) return
  window.location.hash = hash
}

/**
 * Two views is not enough to justify a router. The hash carries the whole
 * route, which keeps the back button and a reloaded tab working without any
 * history bookkeeping of our own.
 */
export function useRoute() {
  onMounted(() => window.addEventListener('hashchange', sync))
  onBeforeUnmount(() => window.removeEventListener('hashchange', sync))
  return { route: current, navigate }
}
