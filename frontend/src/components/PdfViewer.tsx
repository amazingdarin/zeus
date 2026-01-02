import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PdfViewerProps = {
  url: string;
  onError?: (message: string) => void;
};

function PdfViewer({ url, onError }: PdfViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleLoadSuccess = () => {
    setLoading(false);
  };

  const handleLoadError = (err: Error) => {
    const message = err?.message || "Failed to load PDF";
    setError(message);
    setLoading(false);
    if (onError) {
      onError(message);
    }
  };

  return (
    <div className="pdf-viewer">
      {loading ? <div className="doc-viewer-state">Loading PDF...</div> : null}
      {error ? <div className="doc-viewer-error">{error}</div> : null}
      {!error ? (
        <Document
          file={url}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          loading={null}
          error={null}
        >
          <Page pageNumber={1} renderAnnotationLayer={false} renderTextLayer={false} />
        </Document>
      ) : null}
    </div>
  );
}

export default PdfViewer;
