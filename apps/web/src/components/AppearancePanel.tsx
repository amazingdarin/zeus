import { useMemo } from "react";
import { Card, Radio, Space } from "antd";
import { SunOutlined, MoonOutlined, DesktopOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { useThemeMode, type ThemeMode } from "../context/ThemeContext";

function AppearancePanel() {
  const { t } = useTranslation("settings");
  const { themeMode, setThemeMode } = useThemeMode();

  const themeOptions = useMemo(
    () => [
      {
        value: "light" as const,
        label: t("settings.appearance.theme.light.label"),
        icon: <SunOutlined />,
        description: t("settings.appearance.theme.light.description"),
      },
      {
        value: "dark" as const,
        label: t("settings.appearance.theme.dark.label"),
        icon: <MoonOutlined />,
        description: t("settings.appearance.theme.dark.description"),
      },
      {
        value: "system" as const,
        label: t("settings.appearance.theme.system.label"),
        icon: <DesktopOutlined />,
        description: t("settings.appearance.theme.system.description"),
      },
    ],
    [t],
  );

  return (
    <>
      <div className="settings-content-header">
        <h2 className="settings-content-title">{t("settings.appearance.title")}</h2>
      </div>

      <Card className="appearance-section-card" title={t("settings.appearance.theme.cardTitle")}>
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
        <Card className="appearance-section-card" title={t("settings.appearance.preview.cardTitle")}>
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
              <span className="preview-label">{t("settings.appearance.preview.light")}</span>
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
              <span className="preview-label">{t("settings.appearance.preview.dark")}</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export default AppearancePanel;
