import { useEffect, useMemo, useRef, useState } from "react";

import OfficeViewer from "./OfficeViewer";
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
  const isPdf = normalizedType === "application/pdf";
  const officeType = useMemo(() => {
    switch (normalizedType) {
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return "docx";
      case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return "xlsx";
      case "application/vnd.ms-excel":
        return "xlsx";
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return "pptx";
      default:
        return null;
    }
  }, [normalizedType]);

  useEffect(() => {
    setContentError(null);
    setContentUrl(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (!downloadUrl || !isPdf) {
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
  }, [downloadUrl, isPdf]);

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

  if (isPdf) {
    if (!contentUrl) {
      return <div className="doc-viewer-state">Preparing PDF...</div>;
    }
    return <PdfViewer url={contentUrl} />;
  }

  if (officeType) {
    return (
      <OfficeViewer
        src={downloadUrl}
        fileType={officeType}
        onError={setContentError}
      />
    );
  }

  return <UnsupportedViewer />;
}

export default DocumentViewer;
