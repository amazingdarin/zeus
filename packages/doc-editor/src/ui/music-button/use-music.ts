import { useCallback, useMemo } from "react"
import type { Editor } from "@tiptap/react"
import { MusicIcon } from "../../icons/music-icon"

export const MUSIC_INLINE_SHORTCUT_KEY = "Mod-Shift-u"
export const MUSIC_BLOCK_SHORTCUT_KEY = "Mod-Shift-U"

export interface UseMusicConfig {
  /**
   * The Tiptap editor instance.
   */
  editor?: Editor | null
  /**
   * Whether to hide the component when the extension is not available.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback when a music node is inserted.
   */
  onInserted?: () => void
}

export function useMusic({
  editor,
  hideWhenUnavailable = false,
  onInserted,
}: UseMusicConfig) {
  const hasExtension = useMemo(() => {
    if (!editor) return false
    return editor.extensionManager.extensions.some((ext) => ext.name === "music")
  }, [editor])

  const isVisible = useMemo(() => {
    if (!hasExtension && hideWhenUnavailable) return false
    return true
  }, [hasExtension, hideWhenUnavailable])

  const canInsert = useMemo(() => {
    if (!editor || !editor.isEditable || !hasExtension) return false
    return true
  }, [editor, hasExtension])

  const handleInsertInline = useCallback(() => {
    if (!editor || !hasExtension) return
    editor.chain().focus().insertMusic({ abc: "", display: false }).run()
    onInserted?.()
  }, [editor, hasExtension, onInserted])

  const handleInsertBlock = useCallback(() => {
    if (!editor || !hasExtension) return
    editor.chain().focus().insertMusic({ abc: "", display: true }).run()
    onInserted?.()
  }, [editor, hasExtension, onInserted])

  return {
    isVisible,
    canInsert,
    handleInsertInline,
    handleInsertBlock,
    label: "Music",
    inlineShortcutKeys: MUSIC_INLINE_SHORTCUT_KEY,
    blockShortcutKeys: MUSIC_BLOCK_SHORTCUT_KEY,
    Icon: MusicIcon,
  }
}
