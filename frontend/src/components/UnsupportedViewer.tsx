type UnsupportedViewerProps = {
  message?: string;
};

function UnsupportedViewer({ message = "Unsupported document type" }: UnsupportedViewerProps) {
  return <div className="doc-viewer-state">{message}</div>;
}

export default UnsupportedViewer;
