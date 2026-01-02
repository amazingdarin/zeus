import { useEffect, useMemo, useRef, useState } from "react";

import PdfViewer from "./PdfViewer";
import UnsupportedViewer from "./UnsupportedViewer";
import { useStorageObjectDownload } from "../hooks/useStorageObjectDownload";

interface DocumentViewerProps {
  projectKey: string;
  storageObjectId: string;
}

function DocumentViewer({ projectKey, storageObjectId }: DocumentViewerProps) {
  const { loading, error, mimeType, downloadUrl } = useStorageObjectDownload(
    projectKey,
    storageObjectId,
  );
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const normalizedType = useMemo(() => {
    return (mimeType ?? "").split(";")[0].trim().toLowerCase();
  }, [mimeType]);

  useEffect(() => {
    setContentError(null);
    setContentUrl(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (!downloadUrl || normalizedType !== "application/pdf") {
      setContentLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadContent = async () => {
      setContentLoading(true);
      try {
        const response = await fetch(downloadUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("failed to load document content");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setContentUrl(objectUrl);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setContentError((err as Error).message || "failed to load document");
      } finally {
        if (!controller.signal.aborted) {
          setContentLoading(false);
        }
      }
    };

    loadContent();
    return () => {
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [downloadUrl, normalizedType]);

  if (loading || contentLoading) {
    return <div className="doc-viewer-state">Loading document...</div>;
  }

  if (error) {
    return <div className="doc-viewer-error">{error}</div>;
  }

  if (contentError) {
    return <div className="doc-viewer-error">{contentError}</div>;
  }

  if (!downloadUrl) {
    return <div className="doc-viewer-state">No document available</div>;
  }

  if (normalizedType === "application/pdf") {
    if (!contentUrl) {
      return <div className="doc-viewer-state">Preparing PDF...</div>;
    }
    return <PdfViewer url={contentUrl} />;
  }

  return <UnsupportedViewer />;
}

export default DocumentViewer;
