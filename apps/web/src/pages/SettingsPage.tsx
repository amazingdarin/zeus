import { useState } from "react";
import { RobotOutlined, SettingOutlined } from "@ant-design/icons";

import SettingsMenu, { type SettingsMenuItem } from "../components/SettingsMenu";
import AIProviderPanel from "../components/AIProviderPanel";

/**
 * Settings menu items
 */
const SETTINGS_MENU_ITEMS: SettingsMenuItem[] = [
  {
    key: "ai-providers",
    label: "AI Providers",
    icon: <RobotOutlined />,
  },
  // Future settings sections can be added here
  // {
  //   key: "general",
  //   label: "General",
  //   icon: <SettingOutlined />,
  // },
];

/**
 * Settings page with left-right layout
 */
function SettingsPage() {
  const [activeKey, setActiveKey] = useState("ai-providers");

  /**
   * Render the content panel based on active menu key
   */
  const renderContent = () => {
    switch (activeKey) {
      case "ai-providers":
        return <AIProviderPanel />;
      default:
        return (
          <div className="settings-empty">
            <SettingOutlined style={{ fontSize: 48, opacity: 0.3 }} />
            <p>Select a settings category</p>
          </div>
        );
    }
  };

  return (
    <div className="settings-layout">
      <SettingsMenu
        items={SETTINGS_MENU_ITEMS}
        activeKey={activeKey}
        onSelect={setActiveKey}
      />
      <div className="settings-content">
        {renderContent()}
      </div>
    </div>
  );
}

export default SettingsPage;
