import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Editor, JSONContent } from "@tiptap/react";
import {
  DocEditor,
  EduQuestionSetNode,
  createDefaultEduQuestionSetAttrs,
  type EduBlankQuestionItem,
  type EduChoiceQuestionItem,
  type EduQuestionSetAttrs,
} from "@zeus/doc-editor";
import { Input, message } from "antd";

import {
  createDocument,
  fetchDocument,
  fetchUrlHtml,
  filterDocuments,
  type FilterDocumentItem,
} from "../api/documents";
import { useProjectContext } from "../context/ProjectContext";
import { usePluginRuntime } from "../context/PluginRuntimeContext";
import { exportContentJson } from "../utils/exportContentJson";
import {
  analyzeBlankPrompt,
  extractEduQuestionSetsFromDocument,
  flattenExamQuestions,
  gradeAttempt,
  type ExamAttemptState,
  type ExamGradeSummary,
  type FlattenedExamQuestion,
} from "./edu/exam-utils";

const buildDefaultContent = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "题组练习" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "在这里编写题干、选项与答案。" }],
    },
    {
      type: "edu_question_set",
      attrs: createDefaultEduQuestionSetAttrs("choice"),
    },
  ],
});

type WorkspaceMode = "library" | "create";
type DetailMode = "paper" | "attempt";

function EduPluginPage() {
  const navigate = useNavigate();
  const { currentProject } = useProjectContext();
  const { editorContributions } = usePluginRuntime();
  const editorRef = useRef<Editor | null>(null);

  const projectRef = currentProject?.projectRef ?? "";

  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("library");
  const [detailMode, setDetailMode] = useState<DetailMode>("paper");

  const [title, setTitle] = useState("题组练习");
  const [content, setContent] = useState<JSONContent>(() => buildDefaultContent());
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [documents, setDocuments] = useState<FilterDocumentItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");

  const [questionSets, setQuestionSets] = useState<Array<{ blockId: string; index: number; attrs: EduQuestionSetAttrs }>>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [attemptState, setAttemptState] = useState<ExamAttemptState>({});
  const [gradeSummary, setGradeSummary] = useState<ExamGradeSummary | null>(null);

  const mergedContributions = useMemo(() => {
    const extraExtensions = [...(editorContributions.extraExtensions || [])];
    const hasEduExtension = extraExtensions.some((ext) => {
      if (!ext || typeof ext !== "object") return false;
      const name = "name" in ext ? String((ext as { name?: unknown }).name || "").trim() : "";
      return name === "edu_question_set";
    });
    if (!hasEduExtension) {
      extraExtensions.push(EduQuestionSetNode);
    }
    const blockIdNodeTypes = editorContributions.blockIdNodeTypes?.includes("edu_question_set")
      ? editorContributions.blockIdNodeTypes
      : [...(editorContributions.blockIdNodeTypes || []), "edu_question_set"];
    return {
      ...editorContributions,
      extraExtensions,
      blockIdNodeTypes,
    };
  }, [editorContributions]);

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.id === selectedDocId) || null,
    [documents, selectedDocId],
  );

  const flattenedQuestions = useMemo(
    () => flattenExamQuestions(questionSets),
    [questionSets],
  );

  const questionMapBySet = useMemo(() => {
    const result = new Map<string, FlattenedExamQuestion[]>();
    for (const item of flattenedQuestions) {
      const current = result.get(item.setBlockId) || [];
      current.push(item);
      result.set(item.setBlockId, current);
    }
    return result;
  }, [flattenedQuestions]);

  const loadDocuments = useCallback(
    async (queryValue: string) => {
      if (!projectRef) {
        setDocuments([]);
        setSelectedDocId("");
        return;
      }

      setDocumentsLoading(true);
      setDocumentsError("");
      try {
        const rows = await filterDocuments(projectRef, {
          containsBlockType: "edu_question_set",
          limit: 200,
          ...(queryValue.trim() ? { q: queryValue.trim() } : {}),
        });
        setDocuments(rows);
        setSelectedDocId((current) => {
          if (current && rows.some((row) => row.id === current)) {
            return current;
          }
          return rows[0]?.id || "";
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "加载题库文档失败";
        setDocumentsError(msg);
        setDocuments([]);
        setSelectedDocId("");
      } finally {
        setDocumentsLoading(false);
      }
    },
    [projectRef],
  );

  useEffect(() => {
    setSearchQuery("");
    setQuestionSets([]);
    setDetailError("");
    setDetailLoading(false);
    setAttemptState({});
    setGradeSummary(null);
    setDetailMode("paper");

    if (!projectRef) {
      setDocuments([]);
      setSelectedDocId("");
      return;
    }

    void loadDocuments("");
  }, [projectRef, loadDocuments]);

  useEffect(() => {
    setAttemptState({});
    setGradeSummary(null);
    setDetailMode("paper");
  }, [selectedDocId]);

  useEffect(() => {
    if (!projectRef || !selectedDocId) {
      setQuestionSets([]);
      setDetailError("");
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const detail = await fetchDocument(projectRef, selectedDocId);
        if (cancelled) {
          return;
        }
        const parsedSets = extractEduQuestionSetsFromDocument(detail);
        if (parsedSets.length === 0) {
          setQuestionSets([]);
          setDetailError("文档中未解析到可用题组，请检查文档结构");
          return;
        }
        setQuestionSets(parsedSets);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const msg = err instanceof Error ? err.message : "加载文档详情失败";
        setQuestionSets([]);
        setDetailError(msg);
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [projectRef, selectedDocId]);

  const handleInsertQuestionSet = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || typeof editor.commands.insertEduQuestionSet !== "function") {
      message.warning("题组组件未加载，请稍后重试");
      return;
    }
    editor.chain().focus().insertEduQuestionSet({ template: "choice" }).run();
  }, []);

  const handleResetCreateContent = useCallback(() => {
    setContent(buildDefaultContent());
  }, []);

  const handleSave = useCallback(async () => {
    if (!projectRef) {
      message.error("请先选择项目");
      return;
    }
    setSaving(true);
    try {
      const normalizedTitle = title.trim() || "题组练习";
      const payload = exportContentJson(content);
      const created = await createDocument(
        projectRef,
        {
          title: normalizedTitle,
          parent_id: "root",
          extra: {
            status: "draft",
            tags: [],
            doc_type: "edu",
          },
        },
        {
          type: "tiptap",
          content: payload,
        },
      );
      const docId = String(created?.meta?.id ?? created?.id ?? "").trim();
      message.success("已保存题组");
      if (docId) {
        navigate(`/documents/${encodeURIComponent(docId)}`, {
          state: { refreshToken: Date.now() },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败";
      message.error(msg);
    } finally {
      setSaving(false);
    }
  }, [content, navigate, projectRef, title]);

  const handleSearch = useCallback(() => {
    void loadDocuments(searchQuery);
  }, [loadDocuments, searchQuery]);

  const handleChoiceChange = useCallback((question: FlattenedExamQuestion, optionId: string, checked: boolean) => {
    if (question.question.type !== "choice") {
      return;
    }

    const choice = question.question as EduChoiceQuestionItem;
    const multiple = choice.choice.selectionMode === "multiple";

    setAttemptState((previous) => {
      const current = previous[question.questionKey];
      const currentSelected = current && current.type === "choice"
        ? current.selectedOptionIds
        : [];

      let nextSelected: string[];
      if (!multiple) {
        nextSelected = checked ? [optionId] : [];
      } else if (checked) {
        nextSelected = Array.from(new Set([...currentSelected, optionId]));
      } else {
        nextSelected = currentSelected.filter((id) => id !== optionId);
      }

      return {
        ...previous,
        [question.questionKey]: {
          type: "choice",
          selectedOptionIds: nextSelected,
        },
      };
    });
  }, []);

  const handleBlankChange = useCallback((questionKey: string, slotId: string, value: string) => {
    setAttemptState((previous) => {
      const current = previous[questionKey];
      const currentSlots = current && current.type === "blank" ? current.slotValues : {};
      return {
        ...previous,
        [questionKey]: {
          type: "blank",
          slotValues: {
            ...currentSlots,
            [slotId]: value,
          },
        },
      };
    });
  }, []);

  const handleEssayChange = useCallback((questionKey: string, value: string) => {
    setAttemptState((previous) => ({
      ...previous,
      [questionKey]: {
        type: "essay",
        text: value,
      },
    }));
  }, []);

  const handleSubmitAttempt = useCallback(() => {
    if (flattenedQuestions.length === 0) {
      message.warning("当前没有可作答题目");
      return;
    }
    const summary = gradeAttempt(flattenedQuestions, attemptState);
    setGradeSummary(summary);
    message.success("已完成自动评分");
  }, [attemptState, flattenedQuestions]);

  const handleResetAttempt = useCallback(() => {
    setAttemptState({});
    setGradeSummary(null);
  }, []);

  const renderPaperQuestion = (question: FlattenedExamQuestion) => {
    if (question.question.type === "choice") {
      const choice = question.question as EduChoiceQuestionItem;
      return (
        <li key={question.questionKey} className="edu-question-card">
          <div className="edu-question-title">
            <span>{question.displayIndex}. 选择题</span>
            <span className="edu-question-points">{question.points} 分</span>
          </div>
          <div className="edu-question-prompt">{choice.prompt || "（未填写题干）"}</div>
          <ul className="edu-choice-list">
            {choice.choice.options.map((option, index) => (
              <li key={`${question.questionKey}-${option.id}`} className="edu-choice-item">
                <span className="edu-choice-index">{String.fromCharCode(65 + index)}.</span>
                <span>{option.text || `选项 ${index + 1}`}</span>
              </li>
            ))}
          </ul>
        </li>
      );
    }

    if (question.question.type === "blank") {
      const blank = question.question as EduBlankQuestionItem;
      const prompt = analyzeBlankPrompt(blank);
      return (
        <li key={question.questionKey} className="edu-question-card">
          <div className="edu-question-title">
            <span>{question.displayIndex}. 填空题</span>
            <span className="edu-question-points">{question.points} 分</span>
          </div>
          <div className="edu-question-prompt edu-blank-prompt">
            {prompt.parts.map((part, index) =>
              part.kind === "text"
                ? (
                  <span key={`${question.questionKey}-text-${index}`}>{part.text}</span>
                )
                : (
                  <span
                    key={`${question.questionKey}-blank-${index}`}
                    className={`edu-blank-token${part.hasSlot ? "" : " is-missing"}`}
                  >
                    ________
                  </span>
                ),
            )}
          </div>
          {prompt.unresolvedTokenIds.length > 0 ? (
            <div className="edu-question-hint warning">
              未配置空位：{prompt.unresolvedTokenIds.join("、")}
            </div>
          ) : null}
          {prompt.orphanSlots.length > 0 ? (
            <div className="edu-question-hint">存在未引用空位：{prompt.orphanSlots.map((slot) => slot.id).join("、")}</div>
          ) : null}
        </li>
      );
    }

    if (question.question.type === "essay") {
      return (
        <li key={question.questionKey} className="edu-question-card">
          <div className="edu-question-title">
            <span>{question.displayIndex}. 问答题</span>
            <span className="edu-question-points">{question.points} 分</span>
          </div>
          <div className="edu-question-prompt">{question.question.prompt || "（未填写题干）"}</div>
          <div className="edu-question-hint">请在做题模式中作答。</div>
        </li>
      );
    }

    return (
      <li key={question.questionKey} className="edu-question-card">
        <div className="edu-question-title">
          <span>{question.displayIndex}. 未知题型</span>
          <span className="edu-question-points">{question.points} 分</span>
        </div>
        <div className="edu-question-prompt">{question.question.prompt || "（暂不支持展示）"}</div>
      </li>
    );
  };

  const renderAttemptQuestion = (question: FlattenedExamQuestion) => {
    if (question.question.type === "choice") {
      const choice = question.question as EduChoiceQuestionItem;
      const selected = attemptState[question.questionKey];
      const selectedIds = selected && selected.type === "choice"
        ? selected.selectedOptionIds
        : [];
      const multiple = choice.choice.selectionMode === "multiple";

      return (
        <li key={question.questionKey} className="edu-question-card attempt">
          <div className="edu-question-title">
            <span>{question.displayIndex}. 选择题</span>
            <span className="edu-question-points">{question.points} 分</span>
          </div>
          <div className="edu-question-prompt">{choice.prompt || "（未填写题干）"}</div>
          <div className="edu-attempt-choice-group">
            {choice.choice.options.map((option, index) => {
              const checked = selectedIds.includes(option.id);
              return (
                <label key={`${question.questionKey}-${option.id}`} className="edu-attempt-choice-item">
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name={question.questionKey}
                    checked={checked}
                    onChange={(event) => handleChoiceChange(question, option.id, event.target.checked)}
                  />
                  <span className="edu-choice-index">{String.fromCharCode(65 + index)}.</span>
                  <span>{option.text || `选项 ${index + 1}`}</span>
                </label>
              );
            })}
          </div>
        </li>
      );
    }

    if (question.question.type === "blank") {
      const blank = question.question as EduBlankQuestionItem;
      const prompt = analyzeBlankPrompt(blank);
      const current = attemptState[question.questionKey];
      const slotValues = current && current.type === "blank" ? current.slotValues : {};

      return (
        <li key={question.questionKey} className="edu-question-card attempt">
          <div className="edu-question-title">
            <span>{question.displayIndex}. 填空题</span>
            <span className="edu-question-points">{question.points} 分</span>
          </div>
          <div className="edu-question-prompt edu-blank-prompt">
            {prompt.parts.map((part, index) => {
              if (part.kind === "text") {
                return <span key={`${question.questionKey}-text-${index}`}>{part.text}</span>;
              }

              if (!part.hasSlot || !part.slot) {
                return (
                  <input
                    key={`${question.questionKey}-missing-${index}`}
                    className="edu-blank-input missing"
                    value=""
                    placeholder="空位配置缺失"
                    disabled
                  />
                );
              }
              const slot = part.slot;

              return (
                <input
                  key={`${question.questionKey}-${slot.id}-${index}`}
                  className="edu-blank-input"
                  value={slotValues[slot.id] || ""}
                  placeholder="填写答案"
                  onChange={(event) => handleBlankChange(question.questionKey, slot.id, event.target.value)}
                />
              );
            })}
          </div>

          {prompt.orphanSlots.length > 0 ? (
            <div className="edu-orphan-slot-wrap">
              <div className="edu-question-hint">附加空位（题干未引用）</div>
              <div className="edu-orphan-slot-list">
                {prompt.orphanSlots.map((slot) => (
                  <label key={`${question.questionKey}-${slot.id}`} className="edu-orphan-slot-item">
                    <span>{slot.id}</span>
                    <input
                      className="edu-blank-input"
                      value={slotValues[slot.id] || ""}
                      placeholder="填写答案"
                      onChange={(event) => handleBlankChange(question.questionKey, slot.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </li>
      );
    }

    if (question.question.type === "essay") {
      const current = attemptState[question.questionKey];
      const text = current && current.type === "essay" ? current.text : "";
      return (
        <li key={question.questionKey} className="edu-question-card attempt">
          <div className="edu-question-title">
            <span>{question.displayIndex}. 问答题</span>
            <span className="edu-question-points">{question.points} 分</span>
          </div>
          <div className="edu-question-prompt">{question.question.prompt || "（未填写题干）"}</div>
          <textarea
            className="edu-essay-input"
            rows={5}
            value={text}
            onChange={(event) => handleEssayChange(question.questionKey, event.target.value)}
            placeholder="输入你的作答"
          />
        </li>
      );
    }

    return (
      <li key={question.questionKey} className="edu-question-card attempt">
        <div className="edu-question-title">
          <span>{question.displayIndex}. 未知题型</span>
          <span className="edu-question-points">{question.points} 分</span>
        </div>
        <div className="edu-question-prompt">暂不支持该题型作答。</div>
      </li>
    );
  };

  const renderLibraryDetail = () => {
    if (!projectRef) {
      return <div className="edu-empty-state">请先选择项目后查看题库文档。</div>;
    }

    if (detailLoading) {
      return <div className="edu-empty-state">正在加载试卷内容...</div>;
    }

    if (!selectedDocId) {
      return <div className="edu-empty-state">请选择左侧文档查看试卷。</div>;
    }

    if (detailError) {
      return <div className="edu-empty-state error">{detailError}</div>;
    }

    if (questionSets.length === 0) {
      return <div className="edu-empty-state">当前文档没有可展示题组。</div>;
    }

    return (
      <div className="edu-detail-content">
        <div className="edu-detail-header">
          <div>
            <div className="edu-detail-title">{selectedDocument?.title || "题库文档"}</div>
            <div className="edu-detail-subtitle">共 {questionSets.length} 个题组，{flattenedQuestions.length} 道题</div>
          </div>
          <div className="edu-page-actions">
            <button
              className="btn ghost"
              type="button"
              onClick={() => navigate(`/documents/${encodeURIComponent(selectedDocId)}`)}
            >
              打开原文档
            </button>
          </div>
        </div>

        <div className="edu-mode-switch">
          <button
            className={`edu-mode-btn${detailMode === "paper" ? " active" : ""}`}
            type="button"
            onClick={() => setDetailMode("paper")}
          >
            试卷视图
          </button>
          <button
            className={`edu-mode-btn${detailMode === "attempt" ? " active" : ""}`}
            type="button"
            onClick={() => setDetailMode("attempt")}
          >
            做题模式
          </button>
        </div>

        {detailMode === "paper" ? (
          <div className="edu-paper-view">
            {questionSets.map((questionSet) => {
              const questions = questionMapBySet.get(questionSet.blockId) || [];
              return (
                <section key={questionSet.blockId} className="edu-paper-set-card">
                  <div className="edu-paper-set-head">题组 {questionSet.index + 1}</div>
                  {questionSet.attrs.stem ? (
                    <div className="edu-paper-stem">{questionSet.attrs.stem}</div>
                  ) : (
                    <div className="edu-paper-stem placeholder">该题组未填写题干</div>
                  )}
                  <ul className="edu-question-list">
                    {questions.map((question) => renderPaperQuestion(question))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="edu-attempt-view">
            <div className="edu-attempt-actions">
              <button className="btn ghost" type="button" onClick={handleResetAttempt}>
                重置作答
              </button>
              <button className="btn primary" type="button" onClick={handleSubmitAttempt}>
                提交并自动评分
              </button>
            </div>
            <ul className="edu-question-list">
              {flattenedQuestions.map((question) => renderAttemptQuestion(question))}
            </ul>
          </div>
        )}

        {gradeSummary ? (
          <section className="edu-grade-panel">
            <div className="edu-grade-title">评分结果</div>
            <div className="edu-grade-grid">
              <div className="edu-grade-item">
                <span>自动评分得分</span>
                <strong>{gradeSummary.autoScore}</strong>
              </div>
              <div className="edu-grade-item">
                <span>自动评分总分</span>
                <strong>{gradeSummary.autoTotal}</strong>
              </div>
              <div className="edu-grade-item">
                <span>待人工判分题数</span>
                <strong>{gradeSummary.pendingManualCount}</strong>
              </div>
              <div className="edu-grade-item">
                <span>待人工判分分值</span>
                <strong>{gradeSummary.pendingManualPoints}</strong>
              </div>
            </div>
            <ul className="edu-grade-list">
              {gradeSummary.questionResults.map((result) => (
                <li key={result.questionKey} className={`edu-grade-result${result.pendingManual ? " pending" : result.correct ? " correct" : " wrong"}`}>
                  <span>第 {result.displayIndex} 题</span>
                  <span>{result.reason}</span>
                  <span>{result.pendingManual ? "待评" : `${result.earnedPoints}/${result.points}`}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  };

  return (
    <div className="content-inner edu-page">
      <div className="edu-page-header">
        <div>
          <h1 className="edu-page-title">Edu 题库</h1>
          <div className="edu-page-subtitle">识别题目文档，预览试卷并进入做题模式；也可创建新的题组文档。</div>
        </div>
      </div>

      <div className="edu-workspace-switch">
        <button
          className={`edu-workspace-btn${workspaceMode === "library" ? " active" : ""}`}
          type="button"
          onClick={() => setWorkspaceMode("library")}
        >
          题库文档
        </button>
        <button
          className={`edu-workspace-btn${workspaceMode === "create" ? " active" : ""}`}
          type="button"
          onClick={() => setWorkspaceMode("create")}
        >
          创建题组
        </button>
      </div>

      {workspaceMode === "create" ? (
        <>
          <div className="edu-page-actions">
            <button className="btn ghost" type="button" onClick={handleInsertQuestionSet}>
              插入题组
            </button>
            <button className="btn ghost" type="button" onClick={handleResetCreateContent}>
              重置
            </button>
            <button className={`btn primary${saving ? " loading" : ""}`} type="button" onClick={handleSave}>
              保存为文档
            </button>
          </div>
          <div className="edu-page-meta">
            <span className="edu-page-label">标题</span>
            <Input
              className="edu-page-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="题组标题"
            />
          </div>
          <div className="edu-page-editor">
            <DocEditor
              content={content}
              onChange={setContent}
              mode="edit"
              pluginContributions={mergedContributions}
              linkPreviewFetchHtml={async (url: string) => {
                if (!projectRef) {
                  throw new Error("Missing project key");
                }
                const data = await fetchUrlHtml(projectRef, url);
                return data.html;
              }}
              onEditorReady={(editor) => {
                editorRef.current = editor;
              }}
            />
          </div>
        </>
      ) : (
        <div className="edu-library-layout">
          <aside className="edu-doc-list-panel">
            <div className="edu-doc-list-toolbar">
              <Input
                value={searchQuery}
                placeholder="搜索题库文档"
                onChange={(event) => setSearchQuery(event.target.value)}
                onPressEnter={handleSearch}
              />
              <button className="btn ghost" type="button" onClick={handleSearch}>
                搜索
              </button>
            </div>
            <div className="edu-doc-list-meta">
              {documentsLoading ? "正在加载..." : `共 ${documents.length} 个文档`}
            </div>
            {documentsError ? <div className="edu-doc-list-error">{documentsError}</div> : null}
            <div className="edu-doc-list-body">
              {documents.length === 0 ? (
                <div className="edu-empty-state">
                  暂无题库文档，点击“创建题组”新增。
                </div>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.id}
                    className={`edu-doc-item${doc.id === selectedDocId ? " active" : ""}`}
                    type="button"
                    onClick={() => setSelectedDocId(doc.id)}
                  >
                    <span className="edu-doc-item-title">{doc.title}</span>
                    <span className="edu-doc-item-time">{doc.updated_at || doc.created_at || ""}</span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="edu-doc-detail-panel">{renderLibraryDetail()}</section>
        </div>
      )}
    </div>
  );
}

export default EduPluginPage;
