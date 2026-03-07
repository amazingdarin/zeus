"use client"

import { useState, useCallback, useMemo, useRef } from "react"
import type {
  MindmapTreeNode,
  MindmapLayout,
} from "./mindmap-converter"
import {
  parseTreeData,
  stringifyTreeData,
  treeToEChartsOption,
} from "./mindmap-converter"
import { EChartsViewer } from "../../viewer/EChartsViewer"

const LAYOUT_OPTIONS: { layout: MindmapLayout; label: string; icon: string }[] =
  [
    { layout: "LR", label: "水平", icon: "⟶" },
    { layout: "TB", label: "垂直", icon: "⬇" },
    { layout: "radial", label: "辐射", icon: "◎" },
  ]

export interface MindmapOutlineEditorProps {
  data: string
  layout: MindmapLayout
  height: number
  onDataChange: (data: string) => void
  onLayoutChange: (layout: MindmapLayout) => void
  onHeightChange: (height: number) => void
  onSwitchToText: () => void
  onSave: () => void
  onCancel: () => void
}

/**
 * Flatten tree into a list of { node, depth, path } for rendering.
 * `path` is an array of child indices from root to this node.
 */
interface FlatNode {
  name: string
  depth: number
  path: number[]
  hasChildren: boolean
}

function flattenTree(
  node: MindmapTreeNode,
  depth: number = 0,
  path: number[] = []
): FlatNode[] {
  const result: FlatNode[] = [
    {
      name: node.name,
      depth,
      path: [...path],
      hasChildren: (node.children?.length ?? 0) > 0,
    },
  ]
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      result.push(...flattenTree(node.children[i], depth + 1, [...path, i]))
    }
  }
  return result
}

/**
 * Get a node from the tree by path
 */
function getNodeByPath(
  root: MindmapTreeNode,
  path: number[]
): MindmapTreeNode | null {
  let current = root
  for (const idx of path) {
    if (!current.children || idx >= current.children.length) return null
    current = current.children[idx]
  }
  return current
}

/**
 * Get the parent node and child index from a path
 */
function getParentAndIndex(
  root: MindmapTreeNode,
  path: number[]
): { parent: MindmapTreeNode; index: number } | null {
  if (path.length === 0) return null
  const parentPath = path.slice(0, -1)
  const parent = getNodeByPath(root, parentPath)
  if (!parent) return null
  return { parent, index: path[path.length - 1] }
}

/**
 * Deep clone tree
 */
function cloneTree(node: MindmapTreeNode): MindmapTreeNode {
  return JSON.parse(JSON.stringify(node))
}

/**
 * Outline-based mind map editor with tree visualization
 */
export function MindmapOutlineEditor({
  data,
  layout,
  height,
  onDataChange,
  onLayoutChange,
  onHeightChange,
  onSwitchToText,
  onSave,
  onCancel,
}: MindmapOutlineEditorProps) {
  const parsed = useMemo(() => parseTreeData(data), [data])
  const [localTree, setLocalTree] = useState<MindmapTreeNode>(
    parsed || { name: "中心主题", children: [] }
  )
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const updateTree = useCallback(
    (newTree: MindmapTreeNode) => {
      setLocalTree(newTree)
      onDataChange(stringifyTreeData(newTree))
    },
    [onDataChange]
  )

  // Flatten tree for rendering
  const flatNodes = useMemo(() => flattenTree(localTree), [localTree])

  // Generate preview option
  const previewOption = useMemo(
    () => treeToEChartsOption(localTree, layout),
    [localTree, layout]
  )

  // Update node name
  const handleNameChange = useCallback(
    (path: number[], value: string) => {
      const newTree = cloneTree(localTree)
      const node = getNodeByPath(newTree, path)
      if (node) {
        node.name = value
        updateTree(newTree)
      }
    },
    [localTree, updateTree]
  )

  // Add child node
  const handleAddChild = useCallback(
    (path: number[]) => {
      const newTree = cloneTree(localTree)
      const node = getNodeByPath(newTree, path)
      if (node) {
        if (!node.children) node.children = []
        node.children.push({ name: "新节点" })
        updateTree(newTree)
        // Focus the new node after render
        const newPath = [...path, node.children.length - 1].join("-")
        setTimeout(() => {
          const input = inputRefs.current.get(newPath)
          if (input) {
            input.focus()
            input.select()
          }
        }, 50)
      }
    },
    [localTree, updateTree]
  )

  // Add sibling node
  const handleAddSibling = useCallback(
    (path: number[]) => {
      if (path.length === 0) return // Can't add sibling to root
      const newTree = cloneTree(localTree)
      const parentInfo = getParentAndIndex(newTree, path)
      if (parentInfo) {
        const { parent, index } = parentInfo
        if (!parent.children) parent.children = []
        parent.children.splice(index + 1, 0, { name: "新节点" })
        updateTree(newTree)
        // Focus the new sibling
        const siblingPath = [...path.slice(0, -1), index + 1].join("-")
        setTimeout(() => {
          const input = inputRefs.current.get(siblingPath)
          if (input) {
            input.focus()
            input.select()
          }
        }, 50)
      }
    },
    [localTree, updateTree]
  )

  // Delete node
  const handleDelete = useCallback(
    (path: number[]) => {
      if (path.length === 0) return // Can't delete root
      const newTree = cloneTree(localTree)
      const parentInfo = getParentAndIndex(newTree, path)
      if (parentInfo) {
        const { parent, index } = parentInfo
        parent.children?.splice(index, 1)
        if (parent.children?.length === 0) {
          delete parent.children
        }
        updateTree(newTree)
      }
    },
    [localTree, updateTree]
  )

  // Handle keyboard shortcuts on tree items
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, path: number[]) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        if (e.metaKey || e.ctrlKey) {
          onSave()
        } else {
          // Add sibling on Enter
          handleAddSibling(path)
        }
      } else if (e.key === "Tab") {
        e.preventDefault()
        if (e.shiftKey) {
          // Outdent: move node up one level
          if (path.length <= 1) return
          const newTree = cloneTree(localTree)
          const parentInfo = getParentAndIndex(newTree, path)
          if (!parentInfo) return
          const { parent, index } = parentInfo
          const node = parent.children?.[index]
          if (!node) return

          // Remove from current parent
          parent.children?.splice(index, 1)
          if (parent.children?.length === 0) delete parent.children

          // Insert after parent in grandparent
          const grandParentPath = path.slice(0, -2)
          const parentIdx = path[path.length - 2]
          if (grandParentPath.length === 0) {
            // Parent is root's child
            if (!localTree.children) return
            const rootClone = getNodeByPath(newTree, [])
            if (rootClone) {
              if (!rootClone.children) rootClone.children = []
              rootClone.children.splice(parentIdx + 1, 0, node)
            }
          } else {
            const grandParent = getNodeByPath(newTree, grandParentPath)
            if (grandParent?.children) {
              grandParent.children.splice(parentIdx + 1, 0, node)
            }
          }
          updateTree(newTree)
        } else {
          // Indent: move node as last child of previous sibling
          if (path.length === 0) return
          const idx = path[path.length - 1]
          if (idx === 0) return // No previous sibling
          const newTree = cloneTree(localTree)
          const parentInfo = getParentAndIndex(newTree, path)
          if (!parentInfo) return
          const { parent, index } = parentInfo
          const node = parent.children?.[index]
          if (!node) return
          const prevSibling = parent.children?.[index - 1]
          if (!prevSibling) return

          // Remove from current position
          parent.children?.splice(index, 1)
          if (parent.children?.length === 0) delete parent.children

          // Add as child of previous sibling
          if (!prevSibling.children) prevSibling.children = []
          prevSibling.children.push(node)
          updateTree(newTree)
        }
      } else if (e.key === "Backspace" && (e.target as HTMLInputElement).value === "") {
        e.preventDefault()
        handleDelete(path)
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    },
    [localTree, updateTree, handleAddSibling, handleDelete, onSave, onCancel]
  )

  return (
    <div className="mindmap-outline-editor">
      {/* Layout Selector */}
      <div className="mindmap-layout-selector">
        <div className="mindmap-layout-label">布局方向</div>
        <div className="mindmap-layout-grid">
          {LAYOUT_OPTIONS.map(({ layout: l, label, icon }) => (
            <button
              key={l}
              type="button"
              className={`mindmap-layout-card ${layout === l ? "active" : ""}`}
              onClick={() => onLayoutChange(l)}
            >
              <span className="mindmap-layout-icon">{icon}</span>
              <span className="mindmap-layout-name">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content: Tree editor + Preview */}
      <div className="mindmap-editor-content">
        {/* Tree Editor */}
        <div className="mindmap-tree-section">
          <div className="mindmap-tree-header">
            <span>节点编辑</span>
          </div>
          <div className="mindmap-tree-list">
            {flatNodes.map((flatNode, idx) => {
              const pathKey = flatNode.path.join("-")
              return (
                <div
                  key={`${pathKey}-${idx}`}
                  className="mindmap-tree-item"
                >
                  <span
                    className="mindmap-tree-indent"
                    style={{ width: flatNode.depth * 20 }}
                  />
                  <span className="mindmap-tree-connector">
                    {flatNode.depth === 0
                      ? "●"
                      : flatNode.hasChildren
                        ? "▸"
                        : "·"}
                  </span>
                  <input
                    ref={(el) => {
                      if (el) {
                        inputRefs.current.set(pathKey, el)
                      } else {
                        inputRefs.current.delete(pathKey)
                      }
                    }}
                    type="text"
                    className="mindmap-tree-input"
                    value={flatNode.name}
                    onChange={(e) =>
                      handleNameChange(flatNode.path, e.target.value)
                    }
                    onKeyDown={(e) => handleKeyDown(e, flatNode.path)}
                    style={{
                      fontWeight: flatNode.depth === 0 ? 600 : 400,
                    }}
                  />
                  <div className="mindmap-tree-actions">
                    <button
                      type="button"
                      className="mindmap-tree-btn"
                      onClick={() => handleAddChild(flatNode.path)}
                      title="添加子节点"
                    >
                      +
                    </button>
                    {flatNode.depth > 0 && (
                      <>
                        <button
                          type="button"
                          className="mindmap-tree-btn"
                          onClick={() => handleAddSibling(flatNode.path)}
                          title="添加兄弟节点"
                        >
                          ↵
                        </button>
                        <button
                          type="button"
                          className="mindmap-tree-btn mindmap-tree-btn-danger"
                          onClick={() => handleDelete(flatNode.path)}
                          title="删除节点"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Preview */}
        <div className="mindmap-preview-section">
          <div className="mindmap-preview-header">预览</div>
          <div className="mindmap-preview-container">
            <EChartsViewer
              option={previewOption}
              height={Math.min(height, 300)}
            />
          </div>
        </div>
      </div>

      {/* Height Setting */}
      <div className="mindmap-height-setting">
        <label>
          脑图高度:
          <input
            type="range"
            min="200"
            max="800"
            step="50"
            value={height}
            onChange={(e) => onHeightChange(parseInt(e.target.value, 10))}
          />
          <span>{height}px</span>
        </label>
      </div>

      {/* Actions */}
      <div className="mindmap-editor-actions">
        <button
          type="button"
          className="mindmap-btn mindmap-btn-link"
          onClick={onSwitchToText}
        >
          切换到文本模式
        </button>
        <div className="mindmap-action-buttons">
          <button
            type="button"
            className="mindmap-btn mindmap-btn-cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="mindmap-btn mindmap-btn-save"
            onClick={onSave}
          >
            保存 (⌘↵)
          </button>
        </div>
      </div>
    </div>
  )
}

export default MindmapOutlineEditor
