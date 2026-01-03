import { useEffect, useMemo, useState } from "react";

import OfficeViewer from "./OfficeViewer";
import TextViewer from "./TextViewer";
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
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isBinary, setIsBinary] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const normalizedType = useMemo(() => {
    return (mimeType ?? "").split(";")[0].trim().toLowerCase();
  }, [mimeType]);
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
      case "application/pdf":
        return "pdf";
      default:
        return null;
    }
  }, [normalizedType]);

  useEffect(() => {
    setContentError(null);
    setTextContent(null);
    setIsBinary(false);

    if (!downloadUrl) {
      setContentLoading(false);
      return;
    }
    if (officeType) {
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
        const buffer = await response.arrayBuffer();
        if (controller.signal.aborted) {
          return;
        }
        const text = extractTextContent(buffer);
        if (text == null) {
          setIsBinary(true);
        } else {
          setTextContent(text);
        }
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
    };
  }, [downloadUrl, officeType]);

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

  if (officeType) {
    return (
      <OfficeViewer
        src={downloadUrl}
        fileType={officeType}
        onError={setContentError}
      />
    );
  }

  if (textContent != null) {
    return <TextViewer text={textContent} />;
  }

  if (isBinary) {
    return <UnsupportedViewer message="Unsupported document type" />;
  }

  return <UnsupportedViewer />;
}

export default DocumentViewer;

const MAX_TEXT_SAMPLE = 8192;
const MAX_REPLACEMENT_RATIO = 0.1;
const MAX_CONTROL_RATIO = 0.2;

const extractTextContent = (buffer: ArrayBuffer): string | null => {
  const bytes = new Uint8Array(buffer);
  const sample = bytes.subarray(0, MAX_TEXT_SAMPLE);

  let zeroCount = 0;
  for (const byte of sample) {
    if (byte === 0) {
      zeroCount += 1;
    }
  }
  if (zeroCount > 0) {
    return null;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const sampleText = decoder.decode(sample);
  if (!sampleText) {
    return null;
  }

  let replacementCount = 0;
  let controlCount = 0;
  for (const char of sampleText) {
    const code = char.charCodeAt(0);
    if (char === "\uFFFD") {
      replacementCount += 1;
      continue;
    }
    const isAllowedControl =
      code === 9 || code === 10 || code === 13;
    if (code < 32 && !isAllowedControl) {
      controlCount += 1;
    }
  }

  const length = sampleText.length || 1;
  if (replacementCount / length > MAX_REPLACEMENT_RATIO) {
    return null;
  }
  if (controlCount / length > MAX_CONTROL_RATIO) {
    return null;
  }

  return decoder.decode(buffer);
};
