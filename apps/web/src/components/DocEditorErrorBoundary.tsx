import React from "react";

type DocEditorErrorBoundaryProps = {
  children: React.ReactNode;
};

type DocEditorErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

class DocEditorErrorBoundary extends React.Component<
  DocEditorErrorBoundaryProps,
  DocEditorErrorBoundaryState
> {
  constructor(props: DocEditorErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: "",
    };
  }

  static getDerivedStateFromError(error: unknown): DocEditorErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : "编辑器渲染失败",
    };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo): void {
    console.error("[DocEditorErrorBoundary] editor crashed:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      errorMessage: "",
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 16,
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>编辑器加载失败</div>
          <div style={{ marginBottom: 12, color: "var(--muted)" }}>
            {this.state.errorMessage || "发生未知错误"}
          </div>
          <button className="btn ghost" type="button" onClick={this.handleRetry}>
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default DocEditorErrorBoundary;
