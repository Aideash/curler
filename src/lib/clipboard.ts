/**
 * Copies text, falling back to a hidden textarea when the async Clipboard API
 * is unavailable or refused. Throws with a readable reason so a failure is
 * reported rather than swallowed.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Falls through to the legacy path, which some browsers still allow
      // when the async API is blocked.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  const selection = document.getSelection()
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  try {
    textarea.select()
    const copied = document.execCommand('copy')
    if (!copied) throw new Error('The browser refused the copy request.')
  } finally {
    document.body.removeChild(textarea)
    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
  }
}
