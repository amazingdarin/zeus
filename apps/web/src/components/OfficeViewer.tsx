import { useEffect, useRef } from "react";
import type { App as VueApp, Component as VueComponent } from "vue";

import { createApp, h } from "vue";
import VueOfficeDocx from "@vue-office/docx";
import VueOfficeExcel from "@vue-office/excel";
import VueOfficePdf from "@vue-office/pdf";
import VueOfficePptx from "@vue-office/pptx";
import "@vue-office/docx/lib/index.css";
import "@vue-office/excel/lib/index.css";

type OfficeFileType = "docx" | "xlsx" | "pptx" | "pdf";

type OfficeViewerProps = {
  src: string;
  fileType: OfficeFileType;
  onError?: (message: string) => void;
};

const componentMap: Record<OfficeFileType, VueComponent> = {
  docx: VueOfficeDocx,
  xlsx: VueOfficeExcel,
  pptx: VueOfficePptx,
  pdf: VueOfficePdf,
};

function OfficeViewer({ src, fileType, onError }: OfficeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<VueApp | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const mutationObserverRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const applyDocxScale = () => {
      if (fileType !== "docx") {
        return;
      }
      const wrapper = container.querySelector(".docx-wrapper") as HTMLElement | null;
      if (!wrapper) {
        return;
      }
      const sections = Array.from(wrapper.querySelectorAll("section.docx"));
      let contentWidth = wrapper.scrollWidth;
      let contentHeight = wrapper.scrollHeight;
      if (sections.length > 0) {
        let maxWidth = 0;
        let totalHeight = 0;
        sections.forEach((section) => {
          const width = section.scrollWidth || section.clientWidth;
          const height = section.scrollHeight || section.clientHeight;
          if (width > maxWidth) {
            maxWidth = width;
          }
          totalHeight += height;
        });
        if (maxWidth > 0) {
          contentWidth = maxWidth;
        }
        if (totalHeight > 0) {
          contentHeight = totalHeight;
        }
      }

      const containerWidth = container.clientWidth;
      if (!containerWidth || !contentWidth) {
        return;
      }

      const scale = contentWidth > containerWidth ? containerWidth / contentWidth : 1;
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = "top left";
      wrapper.style.width = `${contentWidth * scale}px`;
      wrapper.style.height = `${contentHeight * scale}px`;
    };

    if (appRef.current) {
      appRef.current.unmount();
      appRef.current = null;
    }

    const ViewerComponent = componentMap[fileType];
    const app = createApp({
      render() {
        return h(ViewerComponent, {
          src,
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : "文档渲染失败";
            onError?.(message);
          },
          onRendered: applyDocxScale,
        });
      },
    });

    app.mount(container);
    appRef.current = app;

    if (fileType === "docx") {
      const resizeObserver = new ResizeObserver(() => {
        applyDocxScale();
      });
      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;

      const mutationObserver = new MutationObserver(() => {
        applyDocxScale();
      });
      mutationObserver.observe(container, { subtree: true, childList: true });
      mutationObserverRef.current = mutationObserver;
    }

    requestAnimationFrame(() => {
      applyDocxScale();
    });

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      mutationObserverRef.current?.disconnect();
      mutationObserverRef.current = null;
      app.unmount();
      appRef.current = null;
      container.innerHTML = "";
    };
  }, [fileType, onError, src]);

  return <div className="office-viewer" ref={containerRef} />;
}

export default OfficeViewer;
