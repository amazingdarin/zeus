import { useEffect, useRef } from "react";

import { createApp, h } from "vue";
import type { App as VueApp, Component as VueComponent } from "vue";
import VueOfficeDocx from "@vue-office/docx";
import VueOfficeExcel from "@vue-office/excel";
import VueOfficePptx from "@vue-office/pptx";
import "@vue-office/docx/lib/index.css";
import "@vue-office/excel/lib/index.css";

type OfficeFileType = "docx" | "xlsx" | "xls" | "pptx";

type OfficeViewerProps = {
  src: string;
  fileType: OfficeFileType;
  onError?: (message: string) => void;
};

const componentMap: Record<OfficeFileType, VueComponent> = {
  docx: VueOfficeDocx,
  xlsx: VueOfficeExcel,
  xls: VueOfficeExcel,
  pptx: VueOfficePptx,
};

function OfficeViewer({ src, fileType, onError }: OfficeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<VueApp | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

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
            const message = err instanceof Error ? err.message : "failed to render document";
            onError?.(message);
          },
        });
      },
    });

    app.mount(container);
    appRef.current = app;

    return () => {
      app.unmount();
      appRef.current = null;
      container.innerHTML = "";
    };
  }, [fileType, onError, src]);

  return <div className="office-viewer" ref={containerRef} />;
}

export default OfficeViewer;
