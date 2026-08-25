import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { applyComposedUrl, composedUrl } from '../lib/query'
import type { RequestModel } from '../types'

/**
 * The URL field shows the composed template (path + enabled query). While it
 * is focused the string is a local draft, so typing a trailing `?` is not
 * eaten by a round-trip through compose.
 */
export function useComposedUrlField(request: MaybeRefOrGetter<RequestModel>) {
  const focused = ref(false)
  const draft = ref('')

  const display = computed(() => (focused.value ? draft.value : composedUrl(toValue(request))))

  function focus() {
    draft.value = composedUrl(toValue(request))
    focused.value = true
  }

  function input(value: string) {
    draft.value = value
  }

  function commit() {
    if (!focused.value) return
    applyComposedUrl(toValue(request), draft.value)
    draft.value = composedUrl(toValue(request))
  }

  function apply(value: string) {
    applyComposedUrl(toValue(request), value)
    if (focused.value) draft.value = composedUrl(toValue(request))
  }

  function blur() {
    commit()
    focused.value = false
  }

  watch(
    () => toValue(request).id,
    () => {
      focused.value = false
    },
  )

  return { display, focused, focus, input, blur, commit, apply }
}
