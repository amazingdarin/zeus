import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import type { JSONContent } from "@tiptap/react";
import type { DataNode, TreeProps } from "antd/es/tree";
import { Empty, List, Modal, Spin, Tree, Typography } from "antd";

import { fetchDocument, fetchDocumentList } from "../api/documents";

const { Text } = Typography;

type BlockRefPickerProps = {
  open: boolean;
  projectKey: string;
  onCancel: () => void;
  onSelect: (docId: string, blockId: string) => void;
};

type TreeItem = {
  id?: string;
  slug?: string;
  title?: string;
  kind?: string;
};

type BlockChoice = {
  id: string;
  type: string;
  text: string;
};

function BlockRefPicker({ open, projectKey, onCancel, onSelect }: BlockRefPickerProps) {
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [blocks, setBlocks] = useState<BlockChoice[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const canFetch = Boolean(projectKey);

  const fetchDocuments = useCallback(
    async (parentId: string) => {
      const items = await fetchDocumentList(projectKey, parentId);
      return items as TreeItem[];
    },
    [projectKey],
  );

  const fetchDocumentDetail = useCallback(
    async (docId: string) => {
      const detail = await fetchDocument(projectKey, docId);
      return { data: detail };
    },
    [projectKey],
  );

  const mapTreeItems = useCallback((items: TreeItem[]): DataNode[] => {
    return items
      .filter((item) => item.id)
      .map((item) => ({
        key: String(item.id),
        title: item.title || item.slug || "Untitled",
        isLeaf: item.kind === "file",
      }));
  }, []);

  const loadRoot = useCallback(async () => {
    if (!canFetch) {
      return;
    }
    setLoadingTree(true);
    try {
      const items = await fetchDocuments("");
      setTreeData(mapTreeItems(items));
    } catch {
      setTreeData([]);
    } finally {
      setLoadingTree(false);
    }
  }, [canFetch, fetchDocuments, mapTreeItems]);

  useEffect(() => {
    if (!open) {
      setSelectedDocId("");
      setBlocks([]);
      setBlockError(null);
      return;
    }
    loadRoot();
  }, [loadRoot, open]);

  const updateTreeData = useCallback(
    (list: DataNode[], key: Key, children: DataNode[]): DataNode[] => {
      return list.map((node) => {
        if (node.key === key) {
          return { ...node, children };
        }
        if (node.children) {
          return { ...node, children: updateTreeData(node.children, key, children) };
        }
        return node;
      });
    },
    [],
  );

  const handleLoadData: TreeProps["loadData"] = async (node) => {
    if (!canFetch || node.children) {
      return;
    }
    const items = await fetchDocuments(String(node.key));
    setTreeData((origin) => updateTreeData(origin, node.key, mapTreeItems(items)));
  };

  const handleSelect: TreeProps["onSelect"] = (_, info) => {
    const docId = String(info.node.key);
    setSelectedDocId(docId);
  };

  useEffect(() => {
    if (!selectedDocId || !canFetch) {
      setBlocks([]);
      setBlockError(null);
      return;
    }
    let isActive = true;
    setLoadingBlocks(true);
    setBlockError(null);
    fetchDocumentDetail(selectedDocId)
      .then((payload) => {
        if (!isActive) {
          return;
        }
        const docContent = extractDocContent(payload?.data ?? payload);
        if (!docContent) {
          setBlocks([]);
          return;
        }
        setBlocks(extractBlocks(docContent));
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setBlockError("Failed to load blocks");
        setBlocks([]);
      })
      .finally(() => {
        if (isActive) {
          setLoadingBlocks(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, [canFetch, fetchDocumentDetail, selectedDocId]);

  const blockList = useMemo(() => {
    if (loadingBlocks) {
      return (
        <div className="block-ref-picker-state">
          <Spin size="small" />
          <span>Loading blocks...</span>
        </div>
      );
    }
    if (blockError) {
      return <div className="block-ref-picker-error">{blockError}</div>;
    }
    if (!selectedDocId) {
      return (
        <div className="block-ref-picker-state">
          <Text type="secondary">Select a document to list blocks.</Text>
        </div>
      );
    }
    if (blocks.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No blocks with IDs found."
        />
      );
    }
    return (
      <List
        size="small"
        dataSource={blocks}
        renderItem={(item) => (
          <List.Item
            className="block-ref-picker-item"
            onClick={() => onSelect(selectedDocId, item.id)}
          >
            <div className="block-ref-picker-item-title">
              {item.text || "Untitled block"}
            </div>
          </List.Item>
        )}
      />
    );
  }, [blockError, blocks, loadingBlocks, onSelect, selectedDocId]);

  return (
    <Modal
      title="Insert Block Reference"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={720}
    >
      <div className="block-ref-picker">
        <div className="block-ref-picker-tree">
          {loadingTree ? (
            <div className="block-ref-picker-state">
              <Spin size="small" />
              <span>Loading documents...</span>
            </div>
          ) : treeData.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No documents available."
            />
          ) : (
            <Tree
              treeData={treeData}
              loadData={handleLoadData}
              onSelect={handleSelect}
              selectedKeys={selectedDocId ? [selectedDocId] : []}
              blockNode
            />
          )}
        </div>
        <div className="block-ref-picker-blocks">{blockList}</div>
      </div>
    </Modal>
  );
}

export default BlockRefPicker;

type DocBody = {
  type?: string;
  content?: unknown;
};

const extractDocContent = (data?: { body?: DocBody; content?: unknown } | null) => {
  const body = data?.body ?? data?.content;
  if (!body || typeof body !== "object") {
    return null;
  }
  const bodyContent = (body as DocBody).content ?? body;
  return resolveDocContent(bodyContent);
};

const resolveDocContent = (value: unknown): JSONContent | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const maybeWrapped = value as { content?: unknown };
  if (maybeWrapped.content && typeof maybeWrapped.content === "object") {
    const nested = maybeWrapped.content as JSONContent;
    if (nested && typeof nested === "object" && "type" in nested) {
      return nested;
    }
  }
  if (value && typeof value === "object" && "type" in (value as JSONContent)) {
    return value as JSONContent;
  }
  return null;
};

const extractBlocks = (content: JSONContent): BlockChoice[] => {
  const results: BlockChoice[] = [];
  const visit = (node: JSONContent) => {
    if (!node || typeof node !== "object") {
      return;
    }
    const attrs =
      typeof (node as { attrs?: Record<string, unknown> }).attrs === "object"
        ? ((node as { attrs?: Record<string, unknown> }).attrs ?? {})
        : {};
    const rawId = typeof attrs.id === "string" ? attrs.id.trim() : "";
    if (rawId) {
      const text = collectText(node).trim();
      results.push({
        id: rawId,
        type: String(node.type ?? "block"),
        text: text.slice(0, 140) || "",
      });
      return;
    }
    const children = Array.isArray(node.content) ? node.content : [];
    children.forEach(visit);
  };
  visit(content);
  return results;
};

const collectText = (node: JSONContent): string => {
  if (!node || typeof node !== "object") {
    return "";
  }
  if (node.type === "text") {
    return String(node.text ?? "");
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  const children = Array.isArray(node.content) ? node.content : [];
  return children.map(collectText).join("");
};
