function KnowledgeBaseContent() {
  return (
    <div className="content-panel">
      <div>
        <div className="panel-title">知识库首页</div>
        <p>
          这里会展示整理后的模块快照、文档批次与审核队列。
        </p>
      </div>
      <button className="btn primary" type="button">
        开始审核
      </button>
    </div>
  );
}

export default KnowledgeBaseContent;
