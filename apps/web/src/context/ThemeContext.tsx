import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { App as AntdApp, ConfigProvider, theme as antdTheme, type ThemeConfig } from "antd";

export type ThemeMode = "light" | "dark" | "system";
type EffectiveTheme = "light" | "dark";

const THEME_STORAGE_KEY = "zeus-theme";

const isBrowser = () => typeof window !== "undefined";

function getSystemTheme(): EffectiveTheme {
  if (isBrowser() && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function resolveTheme(mode: ThemeMode, systemTheme: EffectiveTheme): EffectiveTheme {
  return mode === "system" ? systemTheme : mode;
}

function applyDocumentTheme(theme: EffectiveTheme) {
  if (!isBrowser()) {
    return;
  }
  document.documentElement.setAttribute("data-theme", theme);
}

function buildAntdThemeConfig(effectiveTheme: EffectiveTheme): ThemeConfig {
  const isDark = effectiveTheme === "dark";

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: isDark ? "#58a6ff" : "#3f4854",
      colorInfo: isDark ? "#58a6ff" : "#3f4854",
      borderRadius: 10,
      borderRadiusLG: 14,
      fontFamily: '"Space Grotesk", "Manrope", sans-serif',
    },
    components: {
      Button: {
        controlHeight: 36,
      },
      Input: {
        controlHeight: 36,
      },
      Select: {
        controlHeight: 36,
      },
      Card: {
        borderRadiusLG: 14,
      },
      Modal: {
        borderRadiusLG: 14,
      },
    },
  };
}

export function getStoredTheme(): ThemeMode {
  if (isBrowser()) {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  }
  return "light";
}

export function initializeTheme() {
  const mode = getStoredTheme();
  const effectiveTheme = resolveTheme(mode, getSystemTheme());
  applyDocumentTheme(effectiveTheme);
}

type ThemeContextValue = {
  themeMode: ThemeMode;
  effectiveTheme: EffectiveTheme;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() => getSystemTheme());

  const effectiveTheme = useMemo(() => resolveTheme(themeMode, systemTheme), [themeMode, systemTheme]);
  const antdThemeConfig = useMemo(() => buildAntdThemeConfig(effectiveTheme), [effectiveTheme]);

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    applyDocumentTheme(effectiveTheme);
  }, [themeMode, effectiveTheme]);

  useEffect(() => {
    if (!isBrowser()) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const value = useMemo(
    () => ({
      themeMode,
      effectiveTheme,
      setThemeMode,
    }),
    [themeMode, effectiveTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={antdThemeConfig}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeProvider");
  }
  return context;
}
