import { useEffect, useState } from "react";
import { Card, Radio, Space } from "antd";
import { SunOutlined, MoonOutlined, DesktopOutlined } from "@ant-design/icons";

export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "zeus-theme";

/**
 * Get the current system theme preference
 */
function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/**
 * Apply theme to the document
 */
function applyTheme(mode: ThemeMode) {
  const effectiveTheme = mode === "system" ? getSystemTheme() : mode;
  document.documentElement.setAttribute("data-theme", effectiveTheme);
}

/**
 * Get stored theme preference
 */
export function getStoredTheme(): ThemeMode {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  }
  return "light";
}

/**
 * Initialize theme on app load
 */
export function initializeTheme() {
  const theme = getStoredTheme();
  applyTheme(theme);
  
  // Listen for system theme changes
  if (typeof window !== "undefined" && window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", () => {
      const currentTheme = getStoredTheme();
      if (currentTheme === "system") {
        applyTheme("system");
      }
    });
  }
}

/**
 * Appearance settings panel
 */
function AppearancePanel() {
  const [theme, setTheme] = useState<ThemeMode>(getStoredTheme);

  // Apply theme when it changes
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const themeOptions = [
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
  ];

  return (
    <>
      <div className="settings-content-header">
        <h2 className="settings-content-title">外观</h2>
      </div>

      <Card className="appearance-section-card" title="主题">
        <Radio.Group
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
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
