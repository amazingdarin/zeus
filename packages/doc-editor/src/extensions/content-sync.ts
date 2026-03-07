export type IncomingContentSyncInput = {
  incomingSerialized: string
  lastSerialized: string | null
  editorSerialized: string
  editorHasFocus: boolean
}

/**
 * Decide whether external content should overwrite current editor content.
 * Skip stale overwrite while user is actively typing in the focused editor.
 */
export function shouldApplyIncomingContentSync(input: IncomingContentSyncInput): boolean {
  const {
    incomingSerialized,
    lastSerialized,
    editorSerialized,
    editorHasFocus,
  } = input
  if (incomingSerialized === lastSerialized) {
    return false
  }
  if (incomingSerialized === editorSerialized) {
    return false
  }
  if (editorHasFocus && lastSerialized === editorSerialized) {
    return false
  }
  return true
}
