/**
 * RAG Evaluation System
 *
 * This module provides evaluation capabilities for RAG systems:
 * - LLM-as-Judge evaluation for context and answer quality
 * - Batch evaluation for test suites
 * - Metric calculation and aggregation
 */

import { llmGateway, configStore, type LLMProviderId } from "../llm/index.js";
import { ragTraceManager, type EvaluationData } from "../observability/index.js";
import type { TraceContext } from "../observability/trace-manager.js";
import type { IndexSearchResult } from "./types.js";

// ============================================================
// Types
// ============================================================

export interface RAGEvaluationInput {
  query: string;
  context: string[];
  answer: string;
  groundTruth?: string;
}

export interface RAGEvaluation extends EvaluationData {
  contextPrecision: number;
  contextRecall: number;
  faithfulness: number;
  answerRelevancy: number;
}

export interface TestCase {
  id: string;
  query: string;
  expectedDocIds?: string[];
  groundTruth?: string;
  tags?: string[];
}

export interface EvaluationResult {
  testCaseId: string;
  query: string;
  evaluation: RAGEvaluation;
  retrievedDocIds: string[];
  answer: string;
  durationMs: number;
}

export interface EvaluationSuiteResult {
  averageScores: RAGEvaluation;
  results: EvaluationResult[];
  totalTestCases: number;
  passedTestCases: number;
  passThreshold: number;
}

// ============================================================
// LLM-as-Judge Evaluation
// ============================================================

/**
 * Evaluate a RAG response using LLM-as-Judge
 */
export async function evaluateRAGResponse(
  input: RAGEvaluationInput,
): Promise<RAGEvaluation> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    // Return neutral scores if no LLM is configured
    return {
      contextPrecision: 0.5,
      contextRecall: 0.5,
      faithfulness: 0.5,
      answerRelevancy: 0.5,
    };
  }
  if (config.providerId === "openai-compatible" && !config.baseUrl) {
    console.warn("[Evaluation] OpenAI-compatible provider missing baseUrl, skipping evaluation.");
    return {
      contextPrecision: 0.5,
      contextRecall: 0.5,
      faithfulness: 0.5,
      answerRelevancy: 0.5,
    };
  }

  const contextText = input.context
    .map((c, i) => `[${i + 1}] ${c}`)
    .join("\n\n");

  const prompt = buildEvaluationPrompt(
    input.query,
    contextText,
    input.answer,
    input.groundTruth,
  );

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as LLMProviderId,
      model: config.defaultModel || "gpt-4o-mini",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      messages: [
        {
          role: "system",
          content: `You are an expert RAG system evaluator. Evaluate the following RAG response based on four dimensions. Be strict but fair in your evaluation.

Output a JSON object with exactly these four fields, each a number between 0 and 1:
{
  "context_precision": 0.X,
  "context_recall": 0.X,
  "faithfulness": 0.X,
  "answer_relevancy": 0.X
}

Output ONLY the JSON object, no explanation or other text.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      maxTokens: 200,
    });

    const scores = parseEvaluationResponse(response.content);
    return scores;
  } catch (err) {
    console.warn("[Evaluation] LLM evaluation failed:", err);
    return {
      contextPrecision: 0.5,
      contextRecall: 0.5,
      faithfulness: 0.5,
      answerRelevancy: 0.5,
    };
  }
}

function buildEvaluationPrompt(
  query: string,
  context: string,
  answer: string,
  groundTruth?: string,
): string {
  let prompt = `## Evaluation Task

### User Question
${query}

### Retrieved Context
${context}

### System Answer
${answer}
`;

  if (groundTruth) {
    prompt += `
### Reference Answer (Ground Truth)
${groundTruth}
`;
  }

  prompt += `
### Evaluation Criteria

1. **Context Precision** (0-1): How relevant is the retrieved context to the question?
   - 1.0: All retrieved content is directly relevant
   - 0.5: Mix of relevant and irrelevant content
   - 0.0: Retrieved content is not relevant

2. **Context Recall** (0-1): Does the context contain all information needed to answer?
   - 1.0: Context contains all necessary information
   - 0.5: Context contains some but not all needed information
   - 0.0: Context is missing critical information

3. **Faithfulness** (0-1): Is the answer grounded in the retrieved context?
   - 1.0: Every claim in the answer is supported by the context
   - 0.5: Some claims are supported, some are not
   - 0.0: Answer contains hallucinations or unsupported claims

4. **Answer Relevancy** (0-1): Does the answer address the question?
   - 1.0: Answer directly and completely addresses the question
   - 0.5: Answer partially addresses the question
   - 0.0: Answer does not address the question`;

  return prompt;
}

function parseEvaluationResponse(response: string): RAGEvaluation {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, number>;

    return {
      contextPrecision: normalizeScore(parsed.context_precision ?? parsed.contextPrecision),
      contextRecall: normalizeScore(parsed.context_recall ?? parsed.contextRecall),
      faithfulness: normalizeScore(parsed.faithfulness),
      answerRelevancy: normalizeScore(parsed.answer_relevancy ?? parsed.answerRelevancy),
    };
  } catch {
    return {
      contextPrecision: 0.5,
      contextRecall: 0.5,
      faithfulness: 0.5,
      answerRelevancy: 0.5,
    };
  }
}

function normalizeScore(score: unknown): number {
  if (typeof score !== "number") return 0.5;
  return Math.max(0, Math.min(1, score));
}

// ============================================================
// Sufficiency Evaluation (Self-RAG)
// ============================================================

/**
 * Evaluate if the retrieved context is sufficient to answer the question
 */
export async function evaluateSufficiency(
  query: string,
  context: string[],
): Promise<{ sufficient: boolean; missing?: string }> {
  const config = await configStore.getInternalByType("llm");
  if (!config || !config.enabled) {
    return { sufficient: true };
  }
  if (config.providerId === "openai-compatible" && !config.baseUrl) {
    console.warn("[Evaluation] OpenAI-compatible provider missing baseUrl, skipping sufficiency check.");
    return { sufficient: true };
  }

  const contextText = context.slice(0, 5).join("\n---\n");

  try {
    const response = await llmGateway.chat({
      provider: config.providerId as LLMProviderId,
      model: config.defaultModel || "gpt-4o-mini",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      messages: [
        {
          role: "system",
          content: `Evaluate if the retrieved content is sufficient to comprehensively answer the question.
Output JSON: {"sufficient": true/false, "missing": "brief description of missing information if any"}
Output ONLY the JSON, no other text.`,
        },
        {
          role: "user",
          content: `Question: ${query}\n\nRetrieved Content:\n${contextText}`,
        },
      ],
      temperature: 0,
      maxTokens: 100,
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as { sufficient: boolean; missing?: string };
    }

    return { sufficient: true };
  } catch {
    return { sufficient: true };
  }
}

// ============================================================
// Batch Evaluation
// ============================================================

/**
 * Run evaluation on a batch of test cases
 */
export async function runEvaluationSuite(
  testCases: TestCase[],
  executeRAG: (query: string, docIds?: string[]) => Promise<{
    results: IndexSearchResult[];
    answer: string;
  }>,
  options: {
    passThreshold?: number;
    traceContext?: TraceContext;
  } = {},
): Promise<EvaluationSuiteResult> {
  const { passThreshold = 0.6, traceContext } = options;
  const results: EvaluationResult[] = [];

  for (const testCase of testCases) {
    const startTime = Date.now();

    try {
      // Execute RAG
      const { results: ragResults, answer } = await executeRAG(
        testCase.query,
        testCase.expectedDocIds,
      );

      // Evaluate
      const context = ragResults.map((r) => r.content);
      const evaluation = await evaluateRAGResponse({
        query: testCase.query,
        context,
        answer,
        groundTruth: testCase.groundTruth,
      });

      const durationMs = Date.now() - startTime;

      results.push({
        testCaseId: testCase.id,
        query: testCase.query,
        evaluation,
        retrievedDocIds: ragResults.map((r) => r.doc_id),
        answer,
        durationMs,
      });

      // Log to Langfuse if trace context provided
      if (traceContext) {
        ragTraceManager.scoreRAGTrace(traceContext, evaluation);
      }
    } catch (err) {
      console.error(`[Evaluation] Test case ${testCase.id} failed:`, err);
      results.push({
        testCaseId: testCase.id,
        query: testCase.query,
        evaluation: {
          contextPrecision: 0,
          contextRecall: 0,
          faithfulness: 0,
          answerRelevancy: 0,
        },
        retrievedDocIds: [],
        answer: "",
        durationMs: Date.now() - startTime,
      });
    }
  }

  // Calculate averages
  const averageScores = calculateAverageScores(results);

  // Count passed test cases (average score >= threshold)
  const passedTestCases = results.filter((r) => {
    const avg =
      (r.evaluation.contextPrecision +
        r.evaluation.contextRecall +
        r.evaluation.faithfulness +
        r.evaluation.answerRelevancy) /
      4;
    return avg >= passThreshold;
  }).length;

  return {
    averageScores,
    results,
    totalTestCases: testCases.length,
    passedTestCases,
    passThreshold,
  };
}

function calculateAverageScores(results: EvaluationResult[]): RAGEvaluation {
  if (results.length === 0) {
    return {
      contextPrecision: 0,
      contextRecall: 0,
      faithfulness: 0,
      answerRelevancy: 0,
    };
  }

  const sum = results.reduce(
    (acc, r) => ({
      contextPrecision: acc.contextPrecision + r.evaluation.contextPrecision,
      contextRecall: acc.contextRecall + r.evaluation.contextRecall,
      faithfulness: acc.faithfulness + r.evaluation.faithfulness,
      answerRelevancy: acc.answerRelevancy + r.evaluation.answerRelevancy,
    }),
    { contextPrecision: 0, contextRecall: 0, faithfulness: 0, answerRelevancy: 0 },
  );

  const count = results.length;

  return {
    contextPrecision: sum.contextPrecision / count,
    contextRecall: sum.contextRecall / count,
    faithfulness: sum.faithfulness / count,
    answerRelevancy: sum.answerRelevancy / count,
  };
}

// ============================================================
// Retrieval Evaluation
// ============================================================

/**
 * Evaluate retrieval quality (precision and recall at K)
 */
export function evaluateRetrieval(
  retrievedDocIds: string[],
  expectedDocIds: string[],
  k?: number,
): {
  precisionAtK: number;
  recallAtK: number;
  hitRate: number;
  mrr: number;
} {
  const topK = k || retrievedDocIds.length;
  const topResults = retrievedDocIds.slice(0, topK);
  const expectedSet = new Set(expectedDocIds);

  // Precision@K: Relevant retrieved / Retrieved
  const relevantRetrieved = topResults.filter((id) => expectedSet.has(id)).length;
  const precisionAtK = topResults.length > 0 ? relevantRetrieved / topResults.length : 0;

  // Recall@K: Relevant retrieved / Total relevant
  const recallAtK = expectedDocIds.length > 0 ? relevantRetrieved / expectedDocIds.length : 1;

  // Hit Rate: At least one relevant in top K
  const hitRate = relevantRetrieved > 0 ? 1 : 0;

  // MRR: Mean Reciprocal Rank
  let mrr = 0;
  for (let i = 0; i < topResults.length; i++) {
    if (expectedSet.has(topResults[i])) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  return { precisionAtK, recallAtK, hitRate, mrr };
}

// ============================================================
// Export Summary
// ============================================================

/**
 * Generate a human-readable evaluation summary
 */
export function generateEvaluationSummary(
  suiteResult: EvaluationSuiteResult,
): string {
  const { averageScores, totalTestCases, passedTestCases, passThreshold } = suiteResult;

  const overallScore =
    (averageScores.contextPrecision +
      averageScores.contextRecall +
      averageScores.faithfulness +
      averageScores.answerRelevancy) /
    4;

  return `
## RAG Evaluation Summary

### Overall Performance
- **Overall Score**: ${(overallScore * 100).toFixed(1)}%
- **Test Cases**: ${passedTestCases}/${totalTestCases} passed (threshold: ${(passThreshold * 100).toFixed(0)}%)

### Metrics Breakdown
| Metric | Score |
|--------|-------|
| Context Precision | ${(averageScores.contextPrecision * 100).toFixed(1)}% |
| Context Recall | ${(averageScores.contextRecall * 100).toFixed(1)}% |
| Faithfulness | ${(averageScores.faithfulness * 100).toFixed(1)}% |
| Answer Relevancy | ${(averageScores.answerRelevancy * 100).toFixed(1)}% |

### Interpretation
- **Context Precision**: ${interpretScore(averageScores.contextPrecision, "retrieval relevance")}
- **Context Recall**: ${interpretScore(averageScores.contextRecall, "information coverage")}
- **Faithfulness**: ${interpretScore(averageScores.faithfulness, "answer grounding")}
- **Answer Relevancy**: ${interpretScore(averageScores.answerRelevancy, "question addressing")}
`.trim();
}

function interpretScore(score: number, dimension: string): string {
  if (score >= 0.8) return `Excellent ${dimension}`;
  if (score >= 0.6) return `Good ${dimension}`;
  if (score >= 0.4) return `Moderate ${dimension}, room for improvement`;
  return `Poor ${dimension}, needs attention`;
}
