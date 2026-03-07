const AGENT_ID = "ppt-plugin.agent";
const MAX_SOURCE_DOCS = 12;
const MAX_KNOWLEDGE_QUERIES = 8;
const MAX_KNOWLEDGE_ITEMS = 18;
const TRACE_CACHE = new WeakMap();

const TEMPLATES = [
  {
    id: "clean-blue",
    name: "Clean Blue",
    description: "Corporate deck with calm blue accents.",
    tags: ["business", "minimal"],
  },
  {
    id: "growth-orange",
    name: "Growth Orange",
    description: "High-energy sales presentation template.",
    tags: ["sales", "marketing"],
  },
  {
    id: "research-dark",
    name: "Research Dark",
    description: "Academic presentation with dense content layout.",
    tags: ["research", "report"],
  },
];

const DEFAULT_AGENDA = [
  "背景与目标",
  "现状洞察",
  "关键结论",
  "方案与路径",
  "实施计划",
  "风险与下一步",
];

async function isTraceEnabled(ctx) {
  if (!ctx || !ctx.host || !ctx.host.trace || typeof ctx.host.trace.isEnabled !== "function") {
    return false;
  }
  const cached = TRACE_CACHE.get(ctx);
  if (cached && typeof cached.enabled === "boolean") {
    return cached.enabled;
  }
  let enabled = false;
  try {
    enabled = await ctx.host.trace.isEnabled();
  } catch {
    enabled = false;
  }
  TRACE_CACHE.set(ctx, { enabled });
  return enabled;
}

async function startTraceSpan(ctx, name, input) {
  if (!name) return null;
  if (!(await isTraceEnabled(ctx))) return null;
  try {
    return await ctx.host.trace.startSpan(name, input);
  } catch {
    return null;
  }
}

async function endTraceSpan(ctx, span, output, level) {
  if (!span || !span.spanId) return;
  try {
    await ctx.host.trace.endSpan(span.spanId, output, level);
  } catch {
    // ignore tracing errors
  }
}

function asString(value) {
  return String(value ?? "").trim();
}

function asNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asString(item)).filter(Boolean);
}

function uniqueStrings(values, max = 100) {
  const merged = [];
  const seen = new Set();
  for (const raw of values) {
    const value = asString(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    merged.push(value);
    if (merged.length >= max) break;
  }
  return merged;
}

function truncateText(text, maxLength = 220) {
  const normalized = asString(text).replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeWhitespace(text) {
  return asString(text).replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return asString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveHtmlTheme(style) {
  const templateId = asString(style?.templateId).toLowerCase();
  const description = asString(style?.description).toLowerCase();
  const hint = `${templateId} ${description}`;
  if (hint.includes("dark") || hint.includes("night") || hint.includes("black")) return "dark";
  if (hint.includes("minimal") || hint.includes("clean") || hint.includes("simple")) return "minimal";
  if (hint.includes("business") || hint.includes("corporate") || hint.includes("formal")) return "business";
  return "modern";
}

function themeTokens(theme) {
  switch (theme) {
    case "business":
      return {
        bg: "#f3f6fb",
        card: "#ffffff",
        title: "#0b1f3a",
        text: "#1f2f46",
        subtle: "#5a6b85",
        accent: "#2255dd",
      };
    case "minimal":
      return {
        bg: "#fafafa",
        card: "#ffffff",
        title: "#111827",
        text: "#1f2937",
        subtle: "#6b7280",
        accent: "#4f46e5",
      };
    case "dark":
      return {
        bg: "#0b1020",
        card: "#141b2d",
        title: "#f9fafb",
        text: "#d1d5db",
        subtle: "#9ca3af",
        accent: "#60a5fa",
      };
    case "modern":
    default:
      return {
        bg: "#eef4ff",
        card: "#ffffff",
        title: "#0f172a",
        text: "#1e293b",
        subtle: "#64748b",
        accent: "#2563eb",
      };
  }
}

function renderHtmlDeck(input) {
  const title = asString(input?.title) || "演示稿";
  const subtitle = asString(input?.subtitle);
  const presenter = asString(input?.presenter) || "待填写";
  const reportTime = asString(input?.reportTime) || new Date().toISOString().slice(0, 10);
  const slides = Array.isArray(input?.slides) ? input.slides : [];
  const theme = resolveHtmlTheme(input?.style);
  const t = themeTokens(theme);

  const slidesHtml = slides.map((slide, index) => {
    const displayIndex = Number.isFinite(slide?.index) ? slide.index : index + 1;
    const bullets = (slide?.bullets || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `
<section class="slide" data-slide-index="${displayIndex}">
  <header class="slide-header">
    <div class="slide-index">${displayIndex}</div>
    <h2>${escapeHtml(slide?.title || `幻灯片 ${displayIndex}`)}</h2>
    ${slide?.subtitle ? `<p class="slide-subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
  </header>
  ${slide?.goal ? `<p class="slide-goal"><strong>页面目标：</strong>${escapeHtml(slide.goal)}</p>` : ""}
  ${bullets ? `<ul class="slide-bullets">${bullets}</ul>` : ""}
  ${(slide?.visualHint || slide?.layoutHint)
    ? `<div class="slide-hints">${slide?.visualHint ? `<p><strong>视觉建议：</strong>${escapeHtml(slide.visualHint)}</p>` : ""}${slide?.layoutHint ? `<p><strong>版式建议：</strong>${escapeHtml(slide.layoutHint)}</p>` : ""}</div>`
    : ""}
  ${slide?.speakerNotes ? `<aside class="slide-notes"><strong>讲解备注：</strong>${escapeHtml(slide.speakerNotes)}</aside>` : ""}
</section>`.trim();
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: ${t.bg};
      --card: ${t.card};
      --title: ${t.title};
      --text: ${t.text};
      --subtle: ${t.subtle};
      --accent: ${t.accent};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .deck-meta {
      margin-bottom: 16px;
      padding: 16px;
      border-radius: 12px;
      background: var(--card);
      border: 1px solid rgba(0,0,0,0.06);
    }
    .deck-meta h1 {
      margin: 0 0 8px;
      color: var(--title);
      font-size: 28px;
    }
    .deck-meta .subtitle {
      margin: 0 0 10px;
      color: var(--subtle);
    }
    .deck-meta .meta-line {
      margin: 0;
      font-size: 14px;
      color: var(--subtle);
    }
    .deck {
      display: grid;
      gap: 14px;
    }
    .slide {
      background: var(--card);
      border: 1px solid rgba(0,0,0,0.08);
      border-left: 6px solid var(--accent);
      border-radius: 12px;
      padding: 18px;
    }
    .slide-header { margin-bottom: 8px; }
    .slide-index { font-size: 12px; color: var(--subtle); margin-bottom: 4px; }
    .slide-header h2 { margin: 0; font-size: 22px; color: var(--title); }
    .slide-subtitle { margin: 6px 0 0; color: var(--subtle); font-size: 14px; }
    .slide-goal { margin: 10px 0; }
    .slide-bullets { margin: 10px 0; padding-left: 18px; }
    .slide-bullets li { margin: 6px 0; }
    .slide-hints {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(37,99,235,0.08);
      font-size: 14px;
    }
    .slide-notes {
      margin-top: 12px;
      font-size: 13px;
      color: var(--subtle);
      border-top: 1px dashed rgba(0,0,0,0.18);
      padding-top: 8px;
    }
  </style>
</head>
<body>
  <section class="deck-meta">
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
    <p class="meta-line">报告人：${escapeHtml(presenter)}｜报告时间：${escapeHtml(reportTime)}</p>
  </section>
  <main class="deck">${slidesHtml}</main>
</body>
</html>`;
}

function buildCodeBlockNode(language, code) {
  return {
    type: "codeBlock",
    attrs: {
      language: asString(language),
    },
    content: [{ type: "text", text: asString(code) }],
  };
}

function buildFileBlockNodeFromAsset(assetMeta) {
  return {
    type: "file_block",
    attrs: {
      asset_id: asString(assetMeta?.id),
      file_name: asString(assetMeta?.filename),
      mime: asString(assetMeta?.mime),
      size: asNumber(assetMeta?.size, 0),
      file_type: "office",
      office_type: "pptx",
    },
  };
}

function buildHeadingNode(text, level = 1) {
  return {
    type: "heading",
    attrs: {
      level: Math.min(6, Math.max(1, asNumber(level, 1))),
    },
    content: [{ type: "text", text: asString(text) }],
  };
}

function extractTextFromNode(node, collector) {
  if (!node || typeof node !== "object") return;

  if (node.type === "text") {
    collector.push(String(node.text || ""));
    return;
  }

  if (node.type === "hardBreak") {
    collector.push("\n");
    return;
  }

  const content = Array.isArray(node.content) ? node.content : [];
  for (const child of content) {
    extractTextFromNode(child, collector);
  }

  if (["paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock", "horizontalRule"].includes(node.type)) {
    collector.push("\n");
  }
}

function extractTextFromBody(body) {
  if (!body || typeof body !== "object") {
    return "";
  }

  if (body.type === "markdown" && typeof body.content === "string") {
    return normalizeWhitespace(body.content);
  }

  if (body.type === "tiptap" && body.content && typeof body.content === "object") {
    const chunks = [];
    extractTextFromNode(body.content, chunks);
    return normalizeWhitespace(chunks.join(" "));
  }

  if (body.content && typeof body.content === "object") {
    const chunks = [];
    extractTextFromNode(body.content, chunks);
    return normalizeWhitespace(chunks.join(" "));
  }

  if (typeof body.content === "string") {
    return normalizeWhitespace(body.content);
  }

  return "";
}

function extractBulletsFromText(text, maxItems = 6) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const candidates = normalized
    .split(/[\n。！？.!?；;]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);

  const items = candidates.length > 0 ? candidates : [normalized];
  return items.slice(0, maxItems).map((item) => truncateText(item, 120));
}

function normalizeKnowledgeResults(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.results)) {
    return raw.results;
  }
  return [];
}

function textNode(text) {
  return { type: "text", text };
}

function headingNode(level, text) {
  const value = truncateText(text, 90);
  if (!value) return null;
  return {
    type: "heading",
    attrs: { level },
    content: [textNode(value)],
  };
}

function paragraphNode(text) {
  const value = truncateText(text, 280);
  if (!value) return null;
  return {
    type: "paragraph",
    content: [textNode(value)],
  };
}

function bulletListNode(items) {
  const normalizedItems = (items || [])
    .map((item) => truncateText(item, 180))
    .filter(Boolean);
  if (normalizedItems.length === 0) {
    return null;
  }

  return {
    type: "bulletList",
    content: normalizedItems.map((item) => ({
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [textNode(item)],
        },
      ],
    })),
  };
}

function horizontalRuleNode() {
  return { type: "horizontalRule" };
}

function appendSlide(docContent, input) {
  const title = headingNode(1, input.title);
  if (title) {
    docContent.push(title);
  }

  if (input.subtitle) {
    const subtitle = paragraphNode(input.subtitle);
    if (subtitle) {
      docContent.push(subtitle);
    }
  }

  if (Array.isArray(input.bullets) && input.bullets.length > 0) {
    const bulletList = bulletListNode(input.bullets);
    if (bulletList) {
      docContent.push(bulletList);
    }
  }

  if (Array.isArray(input.paragraphs)) {
    for (const line of input.paragraphs) {
      const paragraph = paragraphNode(line);
      if (paragraph) {
        docContent.push(paragraph);
      }
    }
  }

  docContent.push(horizontalRuleNode());
}

async function appendSlideWithTrace(ctx, docContent, input, traceName) {
  const span = await startTraceSpan(ctx, traceName || "ppt.append_slide", {
    title: truncateText(asString(input?.title), 80),
    subtitle: truncateText(asString(input?.subtitle), 120),
    bulletCount: Array.isArray(input?.bullets) ? input.bullets.length : 0,
    paragraphCount: Array.isArray(input?.paragraphs) ? input.paragraphs.length : 0,
  });
  appendSlide(docContent, input);
  await endTraceSpan(ctx, span, { status: "ok" });
}

function stripTrailingSeparator(docContent) {
  if (!Array.isArray(docContent) || docContent.length === 0) {
    return;
  }
  const tail = docContent[docContent.length - 1];
  if (tail && tail.type === "horizontalRule") {
    docContent.pop();
  }
}

function searchTemplates(keywordRaw) {
  const keyword = asString(keywordRaw).toLowerCase();

  if (!keyword) {
    return TEMPLATES;
  }

  return TEMPLATES.filter((item) =>
    item.name.toLowerCase().includes(keyword)
      || item.description.toLowerCase().includes(keyword)
      || item.tags.some((tag) => tag.toLowerCase().includes(keyword)),
  );
}

function resolveSourceDocIds(input) {
  const directIds = asStringArray(input?.source_doc_ids);
  const fallbackDocId = asString(input?.doc_id);
  if (fallbackDocId) {
    directIds.push(fallbackDocId);
  }
  return uniqueStrings(directIds, MAX_SOURCE_DOCS);
}

function resolveKnowledgeQueries(input, topic) {
  const queries = asStringArray(input?.knowledge_queries);
  const fallbackQuery = asString(input?.knowledge_query);
  if (fallbackQuery) {
    queries.push(fallbackQuery);
  }
  if (queries.length === 0 && topic) {
    queries.push(topic);
  }
  return uniqueStrings(queries, MAX_KNOWLEDGE_QUERIES);
}

function derivePresentationTitle(input, sourceDocs, topic) {
  const explicit = asString(input?.title);
  if (explicit) {
    return explicit;
  }
  if (sourceDocs.length > 0) {
    return `${sourceDocs[0].title} - 演示稿`;
  }
  return "PPT 演示稿";
}

function normalizeCommand(commandId) {
  const value = asString(commandId).toLowerCase();
  switch (value) {
    case "list-templates":
    case "ppt-plugin.list-templates":
      return "list-templates";
    case "agent-generate":
    case "ppt-plugin.agent.generate":
      return "agent-generate";
    case "task-status":
    case "ppt-plugin.agent.task-status":
      return "task-status";
    default:
      return value;
  }
}

async function loadSourceDocuments(ctx, projectKey, sourceDocIds) {
  const sourceDocs = [];
  const missing = [];
  for (const docId of sourceDocIds) {
    const docSpan = await startTraceSpan(ctx, "ppt.load_doc", { docId });
    const doc = await ctx.host.getDocument(projectKey, docId);
    if (!doc || typeof doc !== "object") {
      missing.push(docId);
      await endTraceSpan(ctx, docSpan, { status: "missing" }, "WARNING");
      continue;
    }

    const meta = doc.meta && typeof doc.meta === "object" ? doc.meta : {};
    const title = asString(meta.title) || docId;
    const text = extractTextFromBody(doc.body);
    sourceDocs.push({
      id: docId,
      title,
      text,
    });
    await endTraceSpan(ctx, docSpan, {
      status: "ok",
      title: truncateText(title, 80),
      textChars: text.length,
    });
  }
  return { docs: sourceDocs, missing };
}

async function loadKnowledgePoints(ctx, projectKey, queries, perQueryLimit = 6) {
  const points = [];
  const seen = new Set();

  for (const query of queries) {
    const querySpan = await startTraceSpan(ctx, "ppt.search_query", {
      query: truncateText(query, 60),
      limit: perQueryLimit,
    });
    const raw = await ctx.host.searchKnowledge(projectKey, query, perQueryLimit);
    const rows = normalizeKnowledgeResults(raw);
    let accepted = 0;
    let maxScore = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const snippet = truncateText(
        asString(row.snippet) || asString(row.content) || asString(row.text),
        180,
      );
      if (!snippet) continue;

      const dedupeKey = `${query}::${snippet}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      accepted += 1;
      points.push({
        query,
        docId: asString(row.doc_id) || asString(row.docId),
        snippet,
        score: asNumber(row.score, 0),
      });
      maxScore = Math.max(maxScore, asNumber(row.score, 0));
      if (points.length >= MAX_KNOWLEDGE_ITEMS) {
        await endTraceSpan(ctx, querySpan, {
          hits: rows.length,
          accepted,
          maxScore,
          capped: true,
        });
        return points;
      }
    }

    await endTraceSpan(ctx, querySpan, {
      hits: rows.length,
      accepted,
      maxScore,
    });
  }

  return points;
}

function buildStyleRequest(input) {
  const styleInput = input?.style && typeof input.style === "object" ? input.style : {};
  const description = asString(styleInput.description) || asString(input?.style_description);
  const templateId = asString(styleInput.templateId) || asString(input?.template_id);
  const templateImages = uniqueStrings(
    asStringArray(styleInput.templateImages).concat(asStringArray(input?.template_images)),
    8,
  );

  const style = {
    description: description || undefined,
    templateId: templateId || undefined,
    templateImages: templateImages.length > 0 ? templateImages : undefined,
  };
  return style;
}

function buildGenerateOptions(input) {
  const optionsInput = input?.options && typeof input.options === "object" ? input.options : {};
  const aspectRatioRaw = asString(optionsInput.aspectRatio) || asString(input?.aspect_ratio);
  const aspectRatio = aspectRatioRaw === "16:9" || aspectRatioRaw === "4:3"
    ? aspectRatioRaw
    : undefined;
  const language = asString(optionsInput.language) || asString(input?.language);

  return {
    aspectRatio,
    language: language || undefined,
  };
}

async function runListTemplates(input, ctx) {
  const keyword = truncateText(asString(input?.keyword), 80);
  const span = await startTraceSpan(ctx, "ppt.list_templates", { keyword });
  const templates = searchTemplates(input?.keyword);
  await endTraceSpan(ctx, span, { count: templates.length });
  return {
    pluginId: ctx.pluginId,
    operationId: "list-templates",
    count: templates.length,
    templates,
    message: `Found ${templates.length} PPT templates`,
  };
}

async function runTaskStatus(input, ctx) {
  const taskId = asString(input?.task_id);
  if (!taskId) {
    throw new Error("task_id is required");
  }

  const span = await startTraceSpan(ctx, "ppt.task_status", { taskId });
  const status = await ctx.host.getPptTaskStatus(taskId);
  await endTraceSpan(ctx, span, { status: asString(status?.status) || "unknown" });
  return {
    pluginId: ctx.pluginId,
    operationId: "task-status",
    taskId,
    status,
    message: `PPT task ${taskId} status: ${asString(status?.status) || "unknown"}`,
  };
}

async function runUnifiedPptAgent(input, ctx) {
  const projectKey = asString(input?.project_key) || ctx.projectKey;
  const sourceDocIds = resolveSourceDocIds(input);
  const sourceSpan = await startTraceSpan(ctx, "ppt.load_sources", { count: sourceDocIds.length });
  const { docs: sourceDocs, missing: missingDocIds } = await loadSourceDocuments(ctx, projectKey, sourceDocIds);
  await endTraceSpan(ctx, sourceSpan, {
    loaded: sourceDocs.length,
    missing: missingDocIds.length,
    missingSamples: missingDocIds.slice(0, 3),
  });

  const inputSpan = await startTraceSpan(ctx, "ppt.resolve_input", {
    sourceDocCount: sourceDocIds.length,
  });
  const rawTopic = asString(input?.topic)
    || asString(input?.input)
    || asString(input?.request)
    || asString(input?.prompt)
    || asString(input?.query);
  const topic = rawTopic.trim();
  const objective = asString(input?.objective);
  const audience = asString(input?.audience);
  const title = topic ? topic : derivePresentationTitle(input, sourceDocs, topic);
  const knowledgeQueries = resolveKnowledgeQueries(input, topic || title);
  const knowledgeLimit = Math.min(Math.max(1, asNumber(input?.knowledge_limit, 6)), 12);
  const exportPpt = asBoolean(input?.export_ppt, true);
  await endTraceSpan(ctx, inputSpan, {
    topic: truncateText(topic || title, 120),
    objective: truncateText(objective, 120),
    audience: truncateText(audience, 80),
    knowledgeQueryCount: knowledgeQueries.length,
    knowledgeQuerySamples: knowledgeQueries.slice(0, 3).map((query) => truncateText(query, 60)),
    knowledgeLimit,
    exportPpt,
  });
  const knowledgeSpan = await startTraceSpan(ctx, "ppt.search_knowledge", {
    queryCount: knowledgeQueries.length,
    limit: knowledgeLimit,
  });
  const knowledgePoints = await loadKnowledgePoints(ctx, projectKey, knowledgeQueries, knowledgeLimit);
  const queryStats = knowledgeQueries.map((query) => ({
    query: truncateText(query, 60),
    hits: knowledgePoints.filter((point) => point.query === query).length,
  }));
  await endTraceSpan(ctx, knowledgeSpan, {
    count: knowledgePoints.length,
    queryStats,
  });

  const overviewBullets = sourceDocs.length > 0
    ? sourceDocs.map((doc) => {
      const bullets = extractBulletsFromText(doc.text, 1);
      const summary = bullets[0] || "Source document";
      return `${doc.title}: ${summary}`;
    })
    : ["No source documents provided. Draft generated from topic and knowledge only."];
  const overviewSpan = await startTraceSpan(ctx, "ppt.build_overview", {
    docCount: sourceDocs.length,
    bulletCount: overviewBullets.length,
  });
  await endTraceSpan(ctx, overviewSpan, { status: "ok" });

  const insightBullets = [];
  for (const doc of sourceDocs) {
    const docInsightSpan = await startTraceSpan(ctx, "ppt.extract_doc_insights", {
      docId: doc.id,
      title: truncateText(doc.title, 80),
    });
    const bullets = extractBulletsFromText(doc.text, 2);
    let accepted = 0;
    for (const bullet of bullets) {
      insightBullets.push(`[Doc] ${bullet}`);
      accepted += 1;
      if (insightBullets.length >= 8) break;
    }
    await endTraceSpan(ctx, docInsightSpan, {
      extracted: bullets.length,
      accepted,
      capped: insightBullets.length >= 8,
    });
    if (insightBullets.length >= 8) break;
  }
  for (const point of knowledgePoints) {
    if (insightBullets.length >= 12) break;
    insightBullets.push(`[KB] ${point.snippet}`);
  }
  if (insightBullets.length === 0) {
    insightBullets.push("No insights were extracted. Add source_doc_ids or knowledge_queries.");
  }
  const kbInsightSpan = await startTraceSpan(ctx, "ppt.merge_kb_insights", {
    kbCount: knowledgePoints.length,
    totalInsights: insightBullets.length,
  });
  await endTraceSpan(ctx, kbInsightSpan, { status: "ok" });
  const insightSpan = await startTraceSpan(ctx, "ppt.build_insights", {
    docCount: sourceDocs.length,
    kbCount: knowledgePoints.length,
    bulletCount: insightBullets.length,
  });
  await endTraceSpan(ctx, insightSpan, { status: "ok" });

  const planBullets = uniqueStrings(
    asStringArray(input?.plan_items).concat([
      objective ? `目标: ${objective}` : "",
      audience ? `受众: ${audience}` : "",
      "明确阶段目标与验收标准",
      "沉淀关键数据与案例支撑",
      "组织评审并迭代演示内容",
    ]),
    8,
  );
  const planSpan = await startTraceSpan(ctx, "ppt.build_plan", {
    bulletCount: planBullets.length,
  });
  await endTraceSpan(ctx, planSpan, { status: "ok" });

  const riskBullets = uniqueStrings(
    asStringArray(input?.risk_items).concat([
      "数据口径与来源不一致",
      "实施排期与资源冲突",
      "关键假设缺少验证",
    ]),
    8,
  );
  const riskSpan = await startTraceSpan(ctx, "ppt.build_risks", {
    bulletCount: riskBullets.length,
  });
  await endTraceSpan(ctx, riskSpan, { status: "ok" });

  const agenda = uniqueStrings(asStringArray(input?.agenda), 8);
  const finalAgenda = agenda.length > 0 ? agenda : DEFAULT_AGENDA;
  const agendaSpan = await startTraceSpan(ctx, "ppt.build_agenda", {
    count: finalAgenda.length,
  });
  await endTraceSpan(ctx, agendaSpan, { status: "ok" });

  const buildSpan = await startTraceSpan(ctx, "ppt.build_content", {
    agendaCount: finalAgenda.length,
    overviewCount: overviewBullets.length,
    insightCount: insightBullets.length,
    planCount: planBullets.length,
    riskCount: riskBullets.length,
  });
  const deckContent = [];
  await appendSlideWithTrace(ctx, deckContent, {
    title,
    subtitle: [topic, audience ? `Audience: ${audience}` : "", objective ? `Objective: ${objective}` : ""]
      .filter(Boolean)
      .join(" | "),
  }, "ppt.slide.title");
  await appendSlideWithTrace(ctx, deckContent, {
    title: "目录",
    bullets: finalAgenda,
  }, "ppt.slide.agenda");
  await appendSlideWithTrace(ctx, deckContent, {
    title: "资料概览",
    bullets: overviewBullets,
  }, "ppt.slide.overview");
  await appendSlideWithTrace(ctx, deckContent, {
    title: "核心洞察",
    bullets: insightBullets,
  }, "ppt.slide.insights");
  await appendSlideWithTrace(ctx, deckContent, {
    title: "方案与路径",
    bullets: planBullets,
  }, "ppt.slide.plan");
  await appendSlideWithTrace(ctx, deckContent, {
    title: "风险与下一步",
    bullets: riskBullets,
  }, "ppt.slide.risks");
  if (knowledgePoints.length > 0) {
    const refSpan = await startTraceSpan(ctx, "ppt.build_kb_slide", {
      count: Math.min(knowledgePoints.length, 8),
    });
    await appendSlideWithTrace(ctx, deckContent, {
      title: "知识库引用",
      bullets: knowledgePoints.slice(0, 8).map((item) =>
        item.docId ? `${item.snippet} (doc:${item.docId})` : item.snippet
      ),
    }, "ppt.slide.kb");
    await endTraceSpan(ctx, refSpan, { status: "ok" });
  }
  stripTrailingSeparator(deckContent);
  const slideCount = deckContent.filter((node) => node.type === "horizontalRule").length + 1;
  await endTraceSpan(ctx, buildSpan, {
    slideCount,
    blockCount: deckContent.length,
  });

  const style = buildStyleRequest(input);
  const options = buildGenerateOptions(input);
  const htmlSpan = await startTraceSpan(ctx, "ppt.render_html", {
    theme: resolveHtmlTheme(style),
    slideCount,
  });
  const presenter = asString(input?.presenter) || "待填写";
  const reportTime = asString(input?.report_time) || new Date().toISOString().slice(0, 10);
  const subtitle = topic || "";
  const htmlSlidesRaw = [
    {
      title,
      subtitle: [topic, audience ? `Audience: ${audience}` : "", objective ? `Objective: ${objective}` : ""]
        .filter(Boolean)
        .join(" | "),
    },
    { title: "目录", bullets: finalAgenda },
    { title: "资料概览", bullets: overviewBullets },
    { title: "核心洞察", bullets: insightBullets },
    { title: "方案与路径", bullets: planBullets },
    { title: "风险与下一步", bullets: riskBullets },
  ];
  if (knowledgePoints.length > 0) {
    htmlSlidesRaw.push({
      title: "知识库引用",
      bullets: knowledgePoints.slice(0, 8).map((item) =>
        item.docId ? `${item.snippet} (doc:${item.docId})` : item.snippet
      ),
    });
  }
  const htmlSlides = htmlSlidesRaw.map((slide, index) => ({ ...slide, index: index + 1 }));
  const html = renderHtmlDeck({
    title,
    subtitle,
    presenter,
    reportTime,
    slides: htmlSlides,
    style,
  });
  await endTraceSpan(ctx, htmlSpan, { htmlChars: html.length });

  const exportSpan = await startTraceSpan(ctx, "ppt.export_from_html", {
    theme: resolveHtmlTheme(style),
    slideCount,
  });
  const exportWaitMs = Math.max(2000, Math.min(asNumber(input?.export_wait_ms, 10000), 20000));
  const exportPollMs = Math.max(500, Math.min(asNumber(input?.export_poll_ms, 1000), 3000));
  const exportResult = await ctx.host.generatePptFromHtml(projectKey, html, {
    fileName: `${title}-${Date.now()}`,
    style,
    options,
    waitMs: exportWaitMs,
    pollIntervalMs: exportPollMs,
  });
  await endTraceSpan(ctx, exportSpan, {
    status: exportResult.status,
    waitedMs: exportResult.waitedMs,
  }, exportResult.status === "completed" ? undefined : "WARNING");

  if (!exportResult.asset || !exportResult.asset.id) {
    throw new Error(`PPT export not completed (status=${exportResult.status})`);
  }

  const fileBlock = buildFileBlockNodeFromAsset(exportResult.asset);
  const htmlBlocks = htmlSlides.map((slide) =>
    buildCodeBlockNode(
      "html",
      renderHtmlDeck({
        title,
        subtitle,
        presenter,
        reportTime,
        slides: [slide],
        style,
      })
    )
  );
  const docContent = [
    buildHeadingNode("PPT 文件", 1),
    fileBlock,
    horizontalRuleNode(),
    buildHeadingNode("PPT HTML", 1),
    ...htmlBlocks,
    horizontalRuleNode(),
    buildHeadingNode("PPT 内容", 1),
    ...deckContent,
  ];

  const parentId = asString(input?.parent_id) || "root";
  const createPayload = {
    meta: {
      title,
      parent_id: parentId,
      extra: {
        doc_type: "ppt",
        generated_by: AGENT_ID,
        source_doc_ids: sourceDocIds,
        knowledge_queries: knowledgeQueries,
      },
    },
    body: {
      type: "tiptap",
      content: {
        type: "doc",
        content: docContent,
      },
    },
  };

  const createSpan = await startTraceSpan(ctx, "ppt.create_document", {
    title,
    parentId,
  });
  const created = await ctx.host.createDocument(projectKey, createPayload);
  const createdMeta = created && typeof created === "object" && created.meta && typeof created.meta === "object"
    ? created.meta
    : {};
  const createdDocId = asString(createdMeta.id);
  await endTraceSpan(ctx, createSpan, { docId: createdDocId });

  const resultSpan = await startTraceSpan(ctx, "ppt.result", {
    docId: createdDocId,
    slideCount,
    exportStatus: exportResult.status,
  });
  await endTraceSpan(ctx, resultSpan, { status: "ok" });

  return {
    pluginId: ctx.pluginId,
    agent: {
      id: AGENT_ID,
      version: "1.0.0",
    },
    operationId: "agent-generate",
    projectKey,
    topic: topic || title,
    sourceDocIds,
    knowledgeQueries,
    generated: {
      docId: createdDocId,
      title,
      slideCount,
    },
    export: {
      status: exportResult.status,
      taskId: exportResult.taskId,
      asset: exportResult.asset,
      waitedMs: exportResult.waitedMs,
    },
    html: {
      chars: html.length,
    },
    message: exportResult.asset
      ? `PPT 文档已生成（doc_id=${createdDocId}，asset_id=${exportResult.asset.id}）`
      : "PPT 文档已生成",
  };
}

async function dispatchOperation(command, input, ctx) {
  const traceInput = {
    command,
    projectKey: ctx.projectKey,
  };
  if (command === "agent-generate") {
    const sourceCount = asStringArray(input?.source_doc_ids).length + (asString(input?.doc_id) ? 1 : 0);
    const queryCount = asStringArray(input?.knowledge_queries).length + (asString(input?.knowledge_query) ? 1 : 0);
    traceInput.sourceDocCount = sourceCount;
    traceInput.knowledgeQueryCount = queryCount;
  }
  const span = await startTraceSpan(ctx, `ppt-plugin.${command}`, traceInput);
  try {
    switch (command) {
      case "list-templates": {
        const result = await runListTemplates(input, ctx);
        await endTraceSpan(ctx, span, { status: "ok" });
        return result;
      }
      case "task-status": {
        const result = await runTaskStatus(input, ctx);
        await endTraceSpan(ctx, span, { status: "ok" });
        return result;
      }
      case "agent-generate": {
        const result = await runUnifiedPptAgent(input, ctx);
        await endTraceSpan(ctx, span, { status: "ok" });
        return result;
      }
      default:
        throw new Error(`Unsupported command: ${command}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await endTraceSpan(ctx, span, { error: message }, "ERROR");
    throw err;
  }
}

const plugin = {
  async listOperations() {
    return [
      {
        id: "agent-generate",
        title: "Generate PPT document and export task",
        description: "Build a PPT-like document from source docs + knowledge, then queue PPT export.",
        riskLevel: "medium",
        requiresDocScope: false,
      },
      {
        id: "task-status",
        title: "Get PPT export task status",
        description: "Query PPT export task progress by task_id.",
        riskLevel: "low",
        requiresDocScope: false,
      },
      {
        id: "list-templates",
        title: "List PPT templates",
        description: "List available PPT templates.",
        riskLevel: "low",
        requiresDocScope: false,
      },
    ];
  },

  async execute(operationId, input, ctx) {
    return dispatchOperation(normalizeCommand(operationId), input, ctx);
  },

  async executeCommand(commandId, input, ctx) {
    return dispatchOperation(normalizeCommand(commandId), input, ctx);
  },
};

export default plugin;
