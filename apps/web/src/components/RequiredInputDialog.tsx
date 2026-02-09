/**
 * RequiredInputDialog
 *
 * Modal dialog for collecting missing required input before a skill can run.
 * Currently supports doc scope selection.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button, Select, Typography, Space, Tag } from "antd";
import { suggestDocuments } from "../api/documents";
import type { PendingRequiredInputInfo } from "../api/chat";

const { Text, Paragraph } = Typography;

export type RequiredInputDialogProps = {
  visible: boolean;
  projectKey: string;
  pendingInput: PendingRequiredInputInfo | null;
  onSubmitDocId: (docId: string) => void;
  loading?: boolean;
};

type DocOption = {
  value: string;
  label: string;
  titlePath: string;
  hasChildren: boolean;
};

export default function RequiredInputDialog({
  visible,
  projectKey,
  pendingInput,
  onSubmitDocId,
  loading = false,
}: RequiredInputDialogProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<DocOption[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [fetching, setFetching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kind = pendingInput?.kind;

  const title = useMemo(() => {
    if (!pendingInput) return "需要补充信息";
    return `需要补充信息: ${pendingInput.skillName}`;
  }, [pendingInput]);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setOptions([]);
      setSelectedDocId("");
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !projectKey || kind !== "doc_scope") return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const results = await suggestDocuments(projectKey, query, 20);
        setOptions(
          results.map((r) => ({
            value: r.id,
            label: r.titlePath || r.title || r.id,
            titlePath: r.titlePath,
            hasChildren: r.hasChildren,
          })),
        );
      } catch {
        setOptions([]);
      } finally {
        setFetching(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [visible, projectKey, kind, query]);

  if (!pendingInput) return null;

  return (
    <Modal
      title={title}
      open={visible}
      centered
      width={560}
      maskClosable={false}
      closable={false}
      footer={[
        <Button
          key="cancel"
          onClick={() => onSubmitDocId("")}
          disabled={loading}
        >
          取消操作
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={() => onSubmitDocId(selectedDocId)}
          disabled={!selectedDocId || loading}
          loading={loading}
        >
          继续执行
        </Button>,
      ]}
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        <div>
          <Space size={8}>
            <Tag color="gold">需要文档</Tag>
            <Text strong>{pendingInput.skillName}</Text>
          </Space>
          <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {pendingInput.skillDescription}
          </Paragraph>
        </div>

        <Text>{pendingInput.message || "请选择文档后继续。"}</Text>

        {pendingInput.kind === "doc_scope" && (
          <Select
            showSearch
            value={selectedDocId || undefined}
            placeholder="搜索并选择文档"
            filterOption={false}
            onSearch={(v) => setQuery(v)}
            onChange={(v) => setSelectedDocId(String(v))}
            notFoundContent={fetching ? "加载中..." : "无匹配文档"}
            options={options}
            loading={fetching}
            style={{ width: "100%" }}
          />
        )}
      </Space>
    </Modal>
  );
}

