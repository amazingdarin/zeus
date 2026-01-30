import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "./use-tiptap-editor"

export type DocEditorHookState = {
  editor: Editor | null
  editorState?: Editor["state"]
  canCommand?: Editor["can"]
}

export function useDocEditor(): DocEditorHookState {
  return useTiptapEditor()
}
