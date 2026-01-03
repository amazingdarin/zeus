import { useEffect, useRef } from "react";

import { renderAsync } from "docx-preview";

interface DocxViewerProps {
  data: ArrayBuffer;
  onError?: (message: string) => void;
}

function DocxViewer({ data, onError }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.innerHTML = "";
    let cancelled = false;

    renderAsync(data, container, undefined, {
      className: "docx-content",
    }).catch((err) => {
      if (cancelled) {
        return;
      }
      const message = err instanceof Error ? err.message : "failed to render document";
      onError?.(message);
    });

    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [data, onError]);

  return <div className="docx-viewer" ref={containerRef} />;
}

export default DocxViewer;
