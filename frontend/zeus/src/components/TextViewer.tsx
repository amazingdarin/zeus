interface TextViewerProps {
  text: string;
}

function TextViewer({ text }: TextViewerProps) {
  return (
    <div className="text-viewer">
      <pre>{text}</pre>
    </div>
  );
}

export default TextViewer;
