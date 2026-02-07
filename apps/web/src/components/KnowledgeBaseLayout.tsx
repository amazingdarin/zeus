import {
  useState,
  useCallback,
  useRef,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { MenuUnfoldOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";

// ─── Constants ───────────────────────────────────────────
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const COLLAPSED_WIDTH = 36;
const STORAGE_KEY = "zeus-sidebar-width";

// ─── Context ─────────────────────────────────────────────
export const ToggleTreeContext = createContext<{
  treeCollapsed: boolean;
  toggleTree: () => void;
}>({
  treeCollapsed: false,
  toggleTree: () => {},
});

export function useToggleTree() {
  return useContext(ToggleTreeContext);
}

// ─── Layout ──────────────────────────────────────────────
type KnowledgeBaseLayoutProps = {
  sideNav: ReactNode;
  children: ReactNode;
};

function KnowledgeBaseLayout({ sideNav, children }: KnowledgeBaseLayoutProps) {
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? Number(saved) : NaN;
    return Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH
      ? parsed
      : DEFAULT_WIDTH;
  });

  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const layoutRef = useRef<HTMLDivElement>(null);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleTree = useCallback(() => {
    setIsAnimating(true);
    setTreeCollapsed((prev) => !prev);
    if (animationTimer.current) {
      clearTimeout(animationTimer.current);
    }
    animationTimer.current = setTimeout(() => setIsAnimating(false), 320);
  }, []);

  // ── Resize handlers ──
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - startX.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarWidth]);

  const activeWidth = treeCollapsed ? COLLAPSED_WIDTH : sidebarWidth;
  const showCollapsed = treeCollapsed && !isAnimating;

  return (
    <ToggleTreeContext.Provider value={{ treeCollapsed, toggleTree }}>
      <div className="content-inner">
        <div
          ref={layoutRef}
          className={`kb-layout${treeCollapsed ? " kb-layout--collapsed" : ""}${isAnimating ? " kb-layout--animating" : ""}`}
        >
          {/* Sidebar area */}
          <div
            className={`kb-sidebar-wrapper${treeCollapsed ? " kb-sidebar-wrapper--collapsed" : ""}${isAnimating ? " kb-sidebar-wrapper--animating" : ""}`}
            style={{ width: activeWidth }}
          >
            {showCollapsed ? (
              /* Collapsed: only show expand button */
              <div className="kb-sidebar-collapsed">
                <Tooltip title="显示文档树" placement="right">
                  <button
                    className="kb-sidebar-toolbar-btn"
                    type="button"
                    onClick={toggleTree}
                  >
                    <MenuUnfoldOutlined />
                  </button>
                </Tooltip>
              </div>
            ) : (
              sideNav
            )}
          </div>

          {/* Resize handle */}
          {!treeCollapsed && !isAnimating && (
            <div
              className="kb-resize-handle"
              style={{ left: sidebarWidth - 3 }}
              onMouseDown={handleMouseDown}
            />
          )}

          {/* Main content */}
          <section className="kb-main">
            {children}
          </section>
        </div>
      </div>
    </ToggleTreeContext.Provider>
  );
}

export default KnowledgeBaseLayout;
