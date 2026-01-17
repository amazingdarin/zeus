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
        <div className="panel-title">Raw Documents</div>
      </div>
      <div className="doc-table">
        <div className="doc-row doc-row-head">
          <span>Document Name</span>
          <span>Original Path</span>
          <span>Type</span>
          <span>Candidate Module</span>
          <span>Confidence</span>
          <span>Action</span>
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
                View
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RawDocumentListPage;
