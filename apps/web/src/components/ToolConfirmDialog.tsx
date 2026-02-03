/**
 * ToolConfirmDialog
 *
 * Modal dialog for confirming or rejecting a pending tool execution.
 * Displays tool information, risk level, and warning message.
 */

import { Modal, Button, Tag, Descriptions, Typography, Space } from "antd";
import {
  ExclamationCircleOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import type { PendingToolCall } from "../api/chat";

const { Text, Paragraph } = Typography;

export interface ToolConfirmDialogProps {
  visible: boolean;
  pendingTool: PendingToolCall | null;
  onConfirm: () => void;
  onReject: () => void;
  loading?: boolean;
}

/**
 * Get risk level tag color and icon
 */
function getRiskLevelInfo(riskLevel: PendingToolCall["riskLevel"]) {
  switch (riskLevel) {
    case "high":
      return {
        color: "red",
        icon: <ExclamationCircleOutlined />,
        label: "高风险",
      };
    case "medium":
      return {
        color: "orange",
        icon: <WarningOutlined />,
        label: "中风险",
      };
    case "low":
    default:
      return {
        color: "green",
        icon: <CheckCircleOutlined />,
        label: "低风险",
      };
  }
}

/**
 * Format skill name for display
 */
function formatSkillName(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format arguments for display
 */
function formatArgs(args: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return <Text type="secondary">无参数</Text>;
  }

  return (
    <Descriptions size="small" column={1} bordered>
      {entries.map(([key, value]) => (
        <Descriptions.Item key={key} label={key}>
          <Text code>
            {typeof value === "string"
              ? value.length > 100
                ? value.slice(0, 100) + "..."
                : value
              : JSON.stringify(value)}
          </Text>
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function ToolConfirmDialog({
  visible,
  pendingTool,
  onConfirm,
  onReject,
  loading = false,
}: ToolConfirmDialogProps) {
  if (!pendingTool) {
    return null;
  }

  const riskInfo = getRiskLevelInfo(pendingTool.riskLevel);

  return (
    <Modal
      title={
        <Space>
          {riskInfo.icon}
          <span>确认执行操作</span>
        </Space>
      }
      open={visible}
      onCancel={onReject}
      footer={[
        <Button key="cancel" onClick={onReject} disabled={loading}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          danger={pendingTool.riskLevel === "high"}
          onClick={onConfirm}
          loading={loading}
        >
          确认执行
        </Button>,
      ]}
      width={520}
      centered
      maskClosable={false}
    >
      <div style={{ padding: "12px 0" }}>
        {/* Skill Info */}
        <div style={{ marginBottom: 16 }}>
          <Space>
            <Text strong>{formatSkillName(pendingTool.skillName)}</Text>
            <Tag color={riskInfo.color} icon={riskInfo.icon}>
              {riskInfo.label}
            </Tag>
          </Space>
          <Paragraph
            type="secondary"
            style={{ marginTop: 8, marginBottom: 0 }}
          >
            {pendingTool.skillDescription}
          </Paragraph>
        </div>

        {/* Warning Message */}
        {pendingTool.warningMessage && (
          <div
            style={{
              background:
                pendingTool.riskLevel === "high"
                  ? "#fff2f0"
                  : pendingTool.riskLevel === "medium"
                    ? "#fffbe6"
                    : "#f6ffed",
              border: `1px solid ${
                pendingTool.riskLevel === "high"
                  ? "#ffccc7"
                  : pendingTool.riskLevel === "medium"
                    ? "#ffe58f"
                    : "#b7eb8f"
              }`,
              borderRadius: 6,
              padding: "12px 16px",
              marginBottom: 16,
            }}
          >
            <Space align="start">
              <WarningOutlined
                style={{
                  color:
                    pendingTool.riskLevel === "high"
                      ? "#ff4d4f"
                      : pendingTool.riskLevel === "medium"
                        ? "#faad14"
                        : "#52c41a",
                }}
              />
              <Text>{pendingTool.warningMessage}</Text>
            </Space>
          </div>
        )}

        {/* Arguments */}
        <div>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            操作参数
          </Text>
          {formatArgs(pendingTool.args)}
        </div>
      </div>
    </Modal>
  );
}

export default ToolConfirmDialog;
