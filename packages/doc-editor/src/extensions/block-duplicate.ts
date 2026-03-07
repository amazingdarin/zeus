import type { JSONContent } from "@tiptap/react"

function stripIdsInNode(node: JSONContent): JSONContent {
  if (node.attrs && typeof node.attrs === "object") {
    const attrs = node.attrs as Record<string, unknown>
    if ("id" in attrs) {
      const { id: _removedId, ...rest } = attrs
      node.attrs = Object.keys(rest).length > 0 ? rest : undefined
    }
  }

  if (Array.isArray(node.content)) {
    node.content = node.content.map((child) => stripIdsInNode(child))
  }

  return node
}

function getNodeId(node: JSONContent | undefined): string {
  if (!node || !node.attrs || typeof node.attrs !== "object") {
    return ""
  }
  const attrs = node.attrs as Record<string, unknown>
  return typeof attrs.id === "string" ? attrs.id.trim() : ""
}

export function cloneBlockNodeForDuplicate(node: JSONContent): JSONContent {
  const cloned = JSON.parse(JSON.stringify(node)) as JSONContent
  return stripIdsInNode(cloned)
}

export function duplicateTopLevelBlockJson(
  doc: JSONContent,
  sourceBlockId: string,
): { content: JSONContent[]; changed: boolean } {
  const topLevelContent = Array.isArray(doc.content) ? doc.content : []
  if (!sourceBlockId.trim() || topLevelContent.length === 0) {
    return {
      content: topLevelContent,
      changed: false,
    }
  }

  const sourceIndex = topLevelContent.findIndex(
    (node) => getNodeId(node) === sourceBlockId,
  )
  if (sourceIndex < 0) {
    return {
      content: topLevelContent,
      changed: false,
    }
  }

  const sourceNode = topLevelContent[sourceIndex]
  const duplicated = cloneBlockNodeForDuplicate(sourceNode)
  return {
    content: [
      ...topLevelContent.slice(0, sourceIndex + 1),
      duplicated,
      ...topLevelContent.slice(sourceIndex + 1),
    ],
    changed: true,
  }
}

