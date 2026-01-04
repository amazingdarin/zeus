import type { JSONContent } from "@tiptap/react"
import { ensureBlockIds } from "@/components/tiptap-extension/BlockIdExtension"

export type ContentMeta = {
  zeus: true
  format: "tiptap"
  schema_version: 1
  editor: "tiptap"
  created_at: string
  updated_at: string
}

export type ExportedContentJson = {
  meta: ContentMeta
  content: JSONContent
}

export type ContentMetaInput = Partial<ContentMeta> | null | undefined

const resolveTimestamp = (value: unknown) => {
  if (typeof value !== "string") {
    return ""
  }
  return value.trim()
}

export const exportContentJson = (
  editorJson: JSONContent,
  existingMeta?: ContentMetaInput
): ExportedContentJson => {
  const safeContent = ensureBlockIds(editorJson)
  const createdAt =
    resolveTimestamp(existingMeta?.created_at) || new Date().toISOString()
  const updatedAt = new Date().toISOString()

  return {
    meta: {
      zeus: true,
      format: "tiptap",
      schema_version: 1,
      editor: "tiptap",
      created_at: createdAt,
      updated_at: updatedAt,
    },
    content: safeContent,
  }
}
