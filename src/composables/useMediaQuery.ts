import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useMediaQuery(query: string): Ref<boolean> {
  const media = matchMedia(query)
  const matches = ref(media.matches)

  function onChange() {
    matches.value = media.matches
  }

  onMounted(() => media.addEventListener('change', onChange))
  onBeforeUnmount(() => media.removeEventListener('change', onChange))

  return matches
}
