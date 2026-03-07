const placeholderRows = [
  {
    name: "auth_login_flow.md",
    path: "/legacy/auth/",
    type: "Markdown",
    module: "AUTH",
    confidence: "0.86",
  },
  {
    name: "order_api_spec.pdf",
    path: "/handoff/order/",
    type: "PDF",
    module: "ORDER",
    confidence: "0.72",
  },
  {
    name: "payment_gateway_notes.docx",
    path: "/imports/payment/",
    type: "Word",
    module: "PAYMENT",
    confidence: "0.64",
  },
];

function RawDocumentListPage() {
  return (
    <div className="doc-list">
      <div className="doc-list-header">
        <div className="panel-title">原始文档</div>
      </div>
      <div className="doc-table">
        <div className="doc-row doc-row-head">
          <span>文档名</span>
          <span>原始路径</span>
          <span>类型</span>
          <span>候选模块</span>
          <span>置信度</span>
          <span>操作</span>
        </div>
        {placeholderRows.map((row) => (
          <div key={row.name} className="doc-row">
            <span className="doc-name">{row.name}</span>
            <span>{row.path}</span>
            <span>{row.type}</span>
            <span>{row.module}</span>
            <span>{row.confidence}</span>
            <span>
              <button className="btn ghost" type="button">
                查看
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RawDocumentListPage;
