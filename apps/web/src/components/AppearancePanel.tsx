import { useMemo } from "react";
import { Card, Radio, Space } from "antd";
import { SunOutlined, MoonOutlined, DesktopOutlined } from "@ant-design/icons";
import { useThemeMode, type ThemeMode } from "../context/ThemeContext";

/**
 * Appearance settings panel
 */
function AppearancePanel() {
  const { themeMode, setThemeMode } = useThemeMode();

  const themeOptions = useMemo(
    () => [
    {
      value: "light" as const,
      label: "日间模式",
      icon: <SunOutlined />,
      description: "明亮的界面，适合白天使用",
    },
    {
      value: "dark" as const,
      label: "夜间模式",
      icon: <MoonOutlined />,
      description: "深色界面，保护眼睛",
    },
    {
      value: "system" as const,
      label: "跟随系统",
      icon: <DesktopOutlined />,
      description: "自动跟随操作系统的主题设置",
    },
    ],
    [],
  );

  return (
    <>
      <div className="settings-content-header">
        <h2 className="settings-content-title">外观</h2>
      </div>

      <Card className="appearance-section-card" title="主题">
        <Radio.Group
          value={themeMode}
          onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
          className="theme-radio-group"
        >
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {themeOptions.map((option) => (
              <Radio key={option.value} value={option.value} className="theme-radio-item">
                <div className="theme-option">
                  <div className="theme-option-icon">{option.icon}</div>
                  <div className="theme-option-content">
                    <div className="theme-option-label">{option.label}</div>
                    <div className="theme-option-desc">{option.description}</div>
                  </div>
                </div>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Card>

      <div className="theme-preview">
        <Card className="appearance-section-card" title="预览">
          <div className="theme-preview-container">
            <div className="theme-preview-card light">
              <div className="preview-header">
                <div className="preview-dot"></div>
                <div className="preview-dot"></div>
                <div className="preview-dot"></div>
              </div>
              <div className="preview-content">
                <div className="preview-line short"></div>
                <div className="preview-line"></div>
                <div className="preview-line medium"></div>
              </div>
              <span className="preview-label">日间</span>
            </div>
            <div className="theme-preview-card dark">
              <div className="preview-header">
                <div className="preview-dot"></div>
                <div className="preview-dot"></div>
                <div className="preview-dot"></div>
              </div>
              <div className="preview-content">
                <div className="preview-line short"></div>
                <div className="preview-line"></div>
                <div className="preview-line medium"></div>
              </div>
              <span className="preview-label">夜间</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export default AppearancePanel;
