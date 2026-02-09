/**
 * IntentSelectDialog
 *
 * Modal dialog for selecting an intent when the backend detects ambiguity.
 */

import { Modal, Button, Tag, Typography, Space } from "antd";
import type { IntentOption, PendingIntentInfo } from "../api/chat";

const { Text } = Typography;

export interface IntentSelectDialogProps {
  visible: boolean;
  pendingIntent: PendingIntentInfo | null;
  onSelect: (option: IntentOption) => void;
  loading?: boolean;
}

function typeLabel(type: IntentOption["type"]): { label: string; color: string } {
  switch (type) {
    case "command":
      return { label: "命令", color: "geekblue" };
    case "skill":
      return { label: "操作", color: "gold" };
    case "deep_search":
      return { label: "深度", color: "purple" };
    case "chat":
    default:
      return { label: "对话", color: "green" };
  }
}

function formatConfidence(value: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `${pct}%`;
}

export default function IntentSelectDialog({
  visible,
  pendingIntent,
  onSelect,
  loading = false,
}: IntentSelectDialogProps) {
  if (!pendingIntent) return null;

  return (
    <Modal
      title="需要你确认意图"
      open={visible}
      footer={null}
      centered
      width={520}
      maskClosable={false}
      closable={false}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Text>{pendingIntent.message || "你想要执行哪个操作？"}</Text>

        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          {pendingIntent.options.map((opt, idx) => {
            const t = typeLabel(opt.type);
            return (
              <Button
                key={`${opt.type}-${opt.skillHint || ""}-${idx}`}
                type={idx === 0 ? "primary" : "default"}
                block
                onClick={() => onSelect(opt)}
                disabled={loading}
              >
                <Space style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                  <span>{opt.label || opt.type}</span>
                  <Space size={8}>
                    <Tag color={t.color}>{t.label}</Tag>
                    <Text type="secondary">{formatConfidence(opt.confidence)}</Text>
                  </Space>
                </Space>
              </Button>
            );
          })}
        </Space>

        <Text type="secondary">
          不确定的话，选择“直接对话”即可。
        </Text>
      </Space>
    </Modal>
  );
}

