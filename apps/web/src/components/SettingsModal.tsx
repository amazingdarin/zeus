import { useState, useEffect } from "react";
import { RobotOutlined, SettingOutlined, CloseOutlined, BgColorsOutlined, ThunderboltOutlined, GlobalOutlined } from "@ant-design/icons";

import SettingsMenu, { type SettingsMenuItem } from "./SettingsMenu";
import AIProviderPanel from "./AIProviderPanel";
import AppearancePanel from "./AppearancePanel";
import SkillsPanel from "./SkillsPanel";
import WebSearchPanel from "./WebSearchPanel";

/**
 * Settings menu items
 */
const SETTINGS_MENU_ITEMS: SettingsMenuItem[] = [
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
    key: "appearance",
    label: "外观",
    icon: <BgColorsOutlined />,
  },
];

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Settings modal with left-right layout
 */
function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeKey, setActiveKey] = useState("ai-providers");

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

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  /**
   * Render the content panel based on active menu key
   */
  const renderContent = () => {
    switch (activeKey) {
      case "ai-providers":
        return <AIProviderPanel />;
      case "web-search":
        return <WebSearchPanel />;
      case "skills":
        return <SkillsPanel />;
      case "appearance":
        return <AppearancePanel />;
      default:
        return (
          <div className="settings-empty">
            <SettingOutlined style={{ fontSize: 48, opacity: 0.3 }} />
            <p>选择一个设置类别</p>
          </div>
        );
    }
  };

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">设置</h2>
          <button className="settings-modal-close" onClick={onClose} title="关闭">
            <CloseOutlined />
          </button>
        </div>
        <div className="settings-modal-body">
          <SettingsMenu
            items={SETTINGS_MENU_ITEMS}
            activeKey={activeKey}
            onSelect={setActiveKey}
          />
          <div className="settings-modal-content">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
