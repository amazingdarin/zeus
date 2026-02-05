import React, { useState, useEffect } from "react";
import {
  Modal,
  Select,
  Button,
  Progress,
  Space,
  Typography,
  message,
  Card,
  Row,
  Col,
  Spin,
  Alert,
  Input,
} from "antd";
import {
  FileOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import {
  exportToPPT,
  pollTaskStatus,
  downloadPPTX,
  getAllTemplates,
  getPPTServiceStatus,
  type PresetTemplate,
  type CustomTemplate,
  type PPTTaskStatus,
  type PPTStyleOptions,
} from "../api/ppt";

const { Text, Title } = Typography;
const { TextArea } = Input;

interface ExportPPTModalProps {
  open: boolean;
  onClose: () => void;
  projectKey: string;
  docId: string;
  docTitle?: string;
}

type ExportState = "idle" | "loading" | "exporting" | "completed" | "failed";

export const ExportPPTModal: React.FC<ExportPPTModalProps> = ({
  open,
  onClose,
  projectKey,
  docId,
  docTitle,
}) => {
  const [state, setState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serviceAvailable, setServiceAvailable] = useState<boolean | null>(null);

  // Template selection
  const [presetTemplates, setPresetTemplates] = useState<PresetTemplate[]>([]);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [styleDescription, setStyleDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "4:3">("16:9");

  // Check service availability and load templates
  useEffect(() => {
    if (open) {
      loadInitialData();
    }
  }, [open, projectKey]);

  const loadInitialData = async () => {
    setState("loading");
    try {
      const [serviceStatus, templates] = await Promise.all([
        getPPTServiceStatus(),
        getAllTemplates(projectKey),
      ]);

      setServiceAvailable(serviceStatus.available);
      setPresetTemplates(templates.presets);
      setCustomTemplates(templates.custom);

      // Select first preset by default
      if (templates.presets.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(templates.presets[0].id);
      }

      setState("idle");
    } catch (err) {
      console.error("Failed to load PPT data:", err);
      setServiceAvailable(false);
      setState("idle");
    }
  };

  const handleExport = async () => {
    if (!serviceAvailable) {
      message.error("PPT 生成服务不可用");
      return;
    }

    setState("exporting");
    setProgress(0);
    setError(null);

    try {
      // Build style options
      const style: PPTStyleOptions = {};
      if (selectedTemplateId) {
        style.templateId = selectedTemplateId;
      }
      if (styleDescription.trim()) {
        style.description = styleDescription.trim();
      }

      // Start export
      const result = await exportToPPT(projectKey, docId, {
        style,
        options: { aspectRatio },
      });

      setTaskId(result.task_id);

      // Poll for completion
      const finalStatus = await pollTaskStatus(
        projectKey,
        result.task_id,
        (status: PPTTaskStatus) => {
          if (status.progress) {
            setProgress(status.progress);
          } else if (status.current_slide && status.total_slides) {
            setProgress(Math.round((status.current_slide / status.total_slides) * 100));
          }
        }
      );

      if (finalStatus.status === "completed") {
        setState("completed");
        setProgress(100);
        message.success("PPT 生成完成！");
      } else {
        setState("failed");
        setError(finalStatus.error || "生成失败");
      }
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "导出失败");
      message.error("PPT 导出失败");
    }
  };

  const handleDownload = async () => {
    if (!taskId) return;

    try {
      const filename = docTitle
        ? `${docTitle.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}.pptx`
        : `presentation-${taskId}.pptx`;
      await downloadPPTX(projectKey, taskId, filename);
      message.success("下载成功！");
    } catch (err) {
      message.error("下载失败");
    }
  };

  const handleClose = () => {
    // Reset state when closing
    setState("idle");
    setProgress(0);
    setTaskId(null);
    setError(null);
    onClose();
  };

  const renderTemplateOptions = () => {
    const options = [
      ...presetTemplates.map((t) => ({
        value: t.id,
        label: (
          <Space>
            <FileOutlined />
            <span>{t.name}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t.description}
            </Text>
          </Space>
        ),
      })),
      ...customTemplates.map((t) => ({
        value: t.id,
        label: (
          <Space>
            <FileOutlined style={{ color: "#1890ff" }} />
            <span>{t.name}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              自定义
            </Text>
          </Space>
        ),
      })),
    ];

    return options;
  };

  const renderContent = () => {
    if (state === "loading") {
      return (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">加载中...</Text>
          </div>
        </div>
      );
    }

    if (serviceAvailable === false) {
      return (
        <Alert
          type="warning"
          message="PPT 生成服务不可用"
          description="请联系管理员配置 Banana Slides 服务。"
          showIcon
        />
      );
    }

    if (state === "exporting") {
      return (
        <div style={{ textAlign: "center", padding: 40 }}>
          <LoadingOutlined style={{ fontSize: 48, color: "#1890ff" }} />
          <div style={{ marginTop: 24 }}>
            <Title level={4}>正在生成 PPT...</Title>
            <Progress percent={progress} status="active" />
            <Text type="secondary">
              请稍候，AI 正在为您生成精美的演示文稿
            </Text>
          </div>
        </div>
      );
    }

    if (state === "completed") {
      return (
        <div style={{ textAlign: "center", padding: 40 }}>
          <CheckCircleOutlined style={{ fontSize: 64, color: "#52c41a" }} />
          <div style={{ marginTop: 24 }}>
            <Title level={4}>PPT 生成完成！</Title>
            <Text type="secondary">点击下方按钮下载您的演示文稿</Text>
          </div>
          <div style={{ marginTop: 24 }}>
            <Button
              type="primary"
              size="large"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
            >
              下载 PPTX
            </Button>
          </div>
        </div>
      );
    }

    if (state === "failed") {
      return (
        <div style={{ textAlign: "center", padding: 40 }}>
          <CloseCircleOutlined style={{ fontSize: 64, color: "#ff4d4f" }} />
          <div style={{ marginTop: 24 }}>
            <Title level={4}>生成失败</Title>
            <Text type="danger">{error || "未知错误"}</Text>
          </div>
          <div style={{ marginTop: 24 }}>
            <Button onClick={() => setState("idle")}>重试</Button>
          </div>
        </div>
      );
    }

    // Idle state - show configuration
    return (
      <div>
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card size="small" title="选择风格模板">
              <Select
                style={{ width: "100%" }}
                placeholder="选择一个模板"
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                options={renderTemplateOptions()}
              />
            </Card>
          </Col>

          <Col span={24}>
            <Card size="small" title="风格描述（可选）">
              <TextArea
                placeholder="例如：科技感、简约风格、深色主题..."
                value={styleDescription}
                onChange={(e) => setStyleDescription(e.target.value)}
                rows={3}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                描述您期望的视觉风格，AI 将尽量匹配
              </Text>
            </Card>
          </Col>

          <Col span={24}>
            <Card size="small" title="幻灯片比例">
              <Select
                style={{ width: "100%" }}
                value={aspectRatio}
                onChange={setAspectRatio}
                options={[
                  { value: "16:9", label: "16:9 (宽屏)" },
                  { value: "4:3", label: "4:3 (标准)" },
                ]}
              />
            </Card>
          </Col>
        </Row>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
            文档将按分割线（---）分页，每个分隔的部分将成为一张幻灯片
          </Text>
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={
        <Space>
          <FileOutlined />
          <span>导出为 PPT</span>
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={600}
      footer={
        state === "idle" || state === "loading" ? (
          <Space>
            <Button onClick={handleClose}>取消</Button>
            <Button
              type="primary"
              onClick={handleExport}
              loading={state === "loading"}
              disabled={!serviceAvailable || state === "loading"}
            >
              开始生成
            </Button>
          </Space>
        ) : state === "completed" ? (
          <Button onClick={handleClose}>关闭</Button>
        ) : null
      }
    >
      {renderContent()}
    </Modal>
  );
};

export default ExportPPTModal;
