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

/** Section path from `#/help/overview` or `#/help/--help/auth`-style hashes, if any. */
export function helpSectionFromHash(): string | null {
  const match = window.location.hash.match(/^#\/help\/([^?#]+)/)
  return match?.[1] ?? null
}

/** DOM id to scroll to for a help hash (nested `--help/<topic>` stays on `#--help`). */
export function helpScrollTargetFromHash(): string | null {
  const section = helpSectionFromHash()
  if (!section) return null
  return section.split('/')[0] ?? section
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
