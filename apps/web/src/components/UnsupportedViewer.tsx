type UnsupportedViewerProps = {
  message?: string;
};

function UnsupportedViewer({ message = "暂不支持的文档类型" }: UnsupportedViewerProps) {
  return <div className="doc-viewer-state">{message}</div>;
}

export default UnsupportedViewer;
