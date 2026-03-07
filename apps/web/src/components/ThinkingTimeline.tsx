import {
  BulbOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Collapse } from "antd";

import type { ThinkingStep } from "../hooks/useChatLogic";

type ThinkingTimelineProps = {
  steps: ThinkingStep[];
  loading?: boolean;
};

const formatStepTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const kindLabelMap: Record<ThinkingStep["kind"], string> = {
  thinking: "思考",
  search_start: "检索开始",
  search_result: "检索结果",
};

const getKindIcon = (kind: ThinkingStep["kind"]) => {
  if (kind === "search_start") return <SearchOutlined />;
  if (kind === "search_result") return <CheckCircleOutlined />;
  return <BulbOutlined />;
};

function ThinkingTimeline({ steps, loading = false }: ThinkingTimelineProps) {
  if (steps.length === 0) return null;

  return (
    <div className="thinking-timeline-wrapper">
      <Collapse
        className="thinking-timeline"
        ghost
        size="small"
        items={[
          {
            key: "thinking-timeline",
            label: (
              <div className="thinking-timeline-header">
                <span className="thinking-timeline-title">
                  思考过程（{steps.length} 步）
                </span>
                {loading ? (
                  <span className="thinking-timeline-status">
                    <LoadingOutlined spin /> 更新中
                  </span>
                ) : (
                  <span className="thinking-timeline-status">已完成</span>
                )}
              </div>
            ),
            children: (
              <div className="thinking-timeline-steps">
                {steps.map((step, index) => (
                  <div key={step.id} className="thinking-step-row">
                    <div className="thinking-step-marker" aria-hidden="true">
                      <span className={`thinking-step-dot thinking-step-dot-${step.kind}`} />
                    </div>
                    <div className="thinking-step-body">
                      <div className="thinking-step-main">
                        <span className="thinking-step-kind-icon">{getKindIcon(step.kind)}</span>
                        <span className="thinking-step-kind">{kindLabelMap[step.kind]}</span>
                        <span className="thinking-step-content">{step.content}</span>
                      </div>

                      <div className="thinking-step-meta">
                        {step.phase ? (
                          <span className="thinking-step-chip">阶段：{step.phase}</span>
                        ) : null}
                        {step.searchQuery ? (
                          <span className="thinking-step-chip">查询：{step.searchQuery}</span>
                        ) : null}
                        {typeof step.resultCount === "number" ? (
                          <span className="thinking-step-chip">结果：{step.resultCount}</span>
                        ) : null}
                        <span className="thinking-step-time">{formatStepTime(step.timestamp)}</span>
                      </div>

                      {step.subQueries && step.subQueries.length > 0 ? (
                        <div className="thinking-step-subqueries">
                          子查询：{step.subQueries.join(" · ")}
                        </div>
                      ) : null}
                    </div>
                    {index === steps.length - 1 ? null : (
                      <span className="thinking-step-divider" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default ThinkingTimeline;
