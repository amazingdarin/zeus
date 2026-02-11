import { useEffect, useState } from "react";
import { Modal, Tabs, type TabsProps } from "antd";
import {
  RobotOutlined,
  SettingOutlined,
  CloseOutlined,
  BgColorsOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";

import AIProviderPanel from "./AIProviderPanel";
import AppearancePanel from "./AppearancePanel";
import PluginMarketPanel from "./PluginMarketPanel";
import SkillsPanel from "./SkillsPanel";
import WebSearchPanel from "./WebSearchPanel";

/**
 * Settings menu items
 */
const SETTINGS_MENU_ITEMS: Array<{ key: string; label: string; icon: React.ReactNode }> = [
  {
    key: "ai-providers",
    label: "AI 提供商",
    icon: <RobotOutlined />,
  },
  {
    key: "web-search",
    label: "网络搜索",
    icon: <GlobalOutlined />,
  },
  {
    key: "skills",
    label: "AI 技能",
    icon: <ThunderboltOutlined />,
  },
  {
    key: "plugin-market",
    label: "插件市场",
    icon: <AppstoreOutlined />,
  },
  {
    key: "appearance",
    label: "外观",
    icon: <BgColorsOutlined />,
  },
];

const SETTINGS_MODAL_BODY_HEIGHT = "min(680px, calc(100vh - 64px))";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Settings modal with left-right layout
 */
function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeKey, setActiveKey] = useState("ai-providers");
  const [tabPosition, setTabPosition] = useState<TabsProps["tabPosition"]>(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      return "top";
    }
    return "left";
  });

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    const handleResize = () => {
      setTabPosition(window.innerWidth <= 768 ? "top" : "left");
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!isOpen) return null;

  const items: TabsProps["items"] = SETTINGS_MENU_ITEMS.map((item) => {
    let content: React.ReactNode;
    if (item.key === "ai-providers") {
      content = <AIProviderPanel />;
    } else if (item.key === "web-search") {
      content = <WebSearchPanel />;
    } else if (item.key === "skills") {
      content = <SkillsPanel />;
    } else if (item.key === "plugin-market") {
      content = <PluginMarketPanel />;
    } else if (item.key === "appearance") {
      content = <AppearancePanel />;
    } else {
      content = (
        <div className="settings-empty">
          <SettingOutlined style={{ fontSize: 48, opacity: 0.3 }} />
          <p>选择一个设置类别</p>
        </div>
      );
    }

    return {
      key: item.key,
      label: (
        <span className="settings-tab-label">
          {item.icon}
          <span>{item.label}</span>
        </span>
      ),
      children: <div className="settings-tab-pane">{content}</div>,
    };
  });

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      className="settings-modal"
      title="设置"
      centered
      destroyOnHidden
      footer={null}
      width={1100}
      style={{ maxWidth: "calc(100vw - 32px)" }}
      styles={{
        body: {
          padding: 0,
          height: SETTINGS_MODAL_BODY_HEIGHT,
          maxHeight: SETTINGS_MODAL_BODY_HEIGHT,
          overflow: "hidden",
        },
      }}
      closeIcon={<CloseOutlined />}
    >
      <Tabs
        className="settings-tabs"
        activeKey={activeKey}
        onChange={setActiveKey}
        items={items}
        tabPosition={tabPosition}
      />
    </Modal>
  );
}

export default SettingsModal;
