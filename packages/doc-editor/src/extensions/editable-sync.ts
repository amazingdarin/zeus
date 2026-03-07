type EditableStateTarget = {
  isEditable: boolean
  isDestroyed?: boolean
  setEditable: (editable: boolean, emitUpdate?: boolean) => void
}

export function syncEditorEditableState(
  editor: EditableStateTarget | null,
  nextEditable: boolean
): void {
  if (!editor || editor.isDestroyed) {
    return
  }
  if (editor.isEditable === nextEditable) {
    return
  }
  editor.setEditable(nextEditable)
}
