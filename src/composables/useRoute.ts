import { onBeforeUnmount, onMounted, ref } from 'vue'

export type RouteName = 'build' | 'compare' | 'graphql' | 'help'

const ROUTES: Record<string, RouteName> = {
  '#/compare': 'compare',
  '#/graphql': 'graphql',
}

function readRoute(): RouteName {
  const hash = window.location.hash
  if (hash === '#/help' || hash.startsWith('#/help/')) return 'help'
  return ROUTES[hash] ?? 'build'
}

/** Section id from `#/help/overview`-style hashes, if any. */
export function helpSectionFromHash(): string | null {
  const match = window.location.hash.match(/^#\/help\/([^/?#]+)/)
  return match?.[1] ?? null
}

const current = ref<RouteName>(readRoute())

function sync() {
  current.value = readRoute()
}

export function navigate(route: RouteName, helpSection?: string) {
  const hash =
    route === 'build'
      ? '#/'
      : route === 'compare'
        ? '#/compare'
        : route === 'graphql'
          ? '#/graphql'
          : helpSection
            ? `#/help/${helpSection}`
            : '#/help'
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
