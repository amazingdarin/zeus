/**
 * DeepSearchProgress - Visual progress indicator for deep search
 *
 * Shows the current phase and progress of deep search:
 * - Question decomposition
 * - Knowledge base search
 * - Web search (if enabled)
 * - Answer synthesis
 */

import { useState } from "react";
import {
  SearchOutlined,
  GlobalOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  DownOutlined,
  RightOutlined,
  BulbOutlined,
} from "@ant-design/icons";

export type DeepSearchPhase =
  | "decompose"
  | "search_kb"
  | "evaluate"
  | "search_web"
  | "synthesize";

export type DeepSearchStep = {
  phase: DeepSearchPhase;
  content: string;
  timestamp: number;
  subQueries?: string[];
  searchQuery?: string;
  resultCount?: number;
  completed?: boolean;
};

interface DeepSearchProgressProps {
  steps: DeepSearchStep[];
  isComplete?: boolean;
  className?: string;
}

const phaseLabels: Record<DeepSearchPhase, string> = {
  decompose: "问题分解",
  search_kb: "知识库搜索",
  evaluate: "结果评估",
  search_web: "网络搜索",
  synthesize: "答案整合",
};

const phaseIcons: Record<DeepSearchPhase, React.ReactNode> = {
  decompose: <BulbOutlined />,
  search_kb: <SearchOutlined />,
  evaluate: <SyncOutlined />,
  search_web: <GlobalOutlined />,
  synthesize: <CheckCircleOutlined />,
};

export default function DeepSearchProgress({
  steps,
  isComplete = false,
  className = "",
}: DeepSearchProgressProps) {
  const [expanded, setExpanded] = useState(true);

  if (steps.length === 0) {
    return null;
  }

  // Group steps by phase
  const phaseGroups = steps.reduce(
    (acc, step) => {
      const existing = acc.find((g) => g.phase === step.phase);
      if (existing) {
        existing.steps.push(step);
      } else {
        acc.push({ phase: step.phase, steps: [step] });
      }
      return acc;
    },
    [] as Array<{ phase: DeepSearchPhase; steps: DeepSearchStep[] }>,
  );

  // Get current phase
  const currentPhase = steps[steps.length - 1]?.phase;

  return (
    <div className={`deep-search-progress ${className}`}>
      <button
        type="button"
        className="deep-search-progress-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="deep-search-progress-icon">
          {isComplete ? (
            <CheckCircleOutlined style={{ color: "#52c41a" }} />
          ) : (
            <SyncOutlined spin style={{ color: "#1890ff" }} />
          )}
        </span>
        <span className="deep-search-progress-title">
          深度搜索 {isComplete ? "完成" : "进行中..."}
        </span>
        <span className="deep-search-progress-toggle">
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </span>
      </button>

      {expanded && (
        <div className="deep-search-progress-body">
          {phaseGroups.map((group) => {
            const isCurrentPhase = group.phase === currentPhase && !isComplete;
            const isCompletedPhase =
              isComplete ||
              phaseGroups.findIndex((g) => g.phase === group.phase) <
                phaseGroups.findIndex((g) => g.phase === currentPhase);

            return (
              <div
                key={group.phase}
                className={`deep-search-phase ${isCurrentPhase ? "current" : ""} ${isCompletedPhase ? "completed" : ""}`}
              >
                <div className="deep-search-phase-header">
                  <span className="deep-search-phase-icon">
                    {phaseIcons[group.phase]}
                  </span>
                  <span className="deep-search-phase-label">
                    {phaseLabels[group.phase]}
                  </span>
                  {isCurrentPhase && (
                    <SyncOutlined spin className="deep-search-phase-spinner" />
                  )}
                  {isCompletedPhase && (
                    <CheckCircleOutlined className="deep-search-phase-check" />
                  )}
                </div>

                <div className="deep-search-phase-content">
                  {group.steps.map((step, index) => (
                    <div key={index} className="deep-search-step">
                      {step.content && (
                        <div className="deep-search-step-text">{step.content}</div>
                      )}
                      {step.subQueries && step.subQueries.length > 0 && (
                        <ul className="deep-search-subqueries">
                          {step.subQueries.map((q, i) => (
                            <li key={i}>{q}</li>
                          ))}
                        </ul>
                      )}
                      {step.resultCount !== undefined && (
                        <div className="deep-search-result-count">
                          找到 {step.resultCount} 条结果
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
