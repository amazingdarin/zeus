const TEMPLATE_CATALOG_PATH = "templates/catalog.json";
const PPT_AGENT_ID = "ppt-plugin.agent";
const PPT_AGENT_ROUTE = "/plugins/ppt-plugin/agent";
const PPT_TREE_ROUTE = "/plugins/ppt-plugin/agent/tree";
const PPT_DOC_CONTAINER_ID = "ppt-plugin-docs-root";

const DEFAULT_PPT_TEMPLATE_CATALOG = {
  version: 1,
  presets: [
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
  ],
  custom: [],
};

function asString(value) {
  return String(value ?? "").trim();
}

function buildHashRoute(path) {
  const raw = asString(path);
  if (!raw) return "#/";
  return raw.startsWith("/") ? `#${raw}` : `#/${raw}`;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeTemplate(item, source, index) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const row = item;
  const id = asString(row.id || `template-${index + 1}`);
  const name = asString(row.name || row.title || id);
  if (!id || !name) {
    return null;
  }
  const description = asString(row.description || "暂无描述");
  return {
    id,
    name,
    description,
    tags: normalizeTags(row.tags),
    source: source === "custom" ? "custom" : "preset",
  };
}

function dedupeTemplates(templates) {
  const result = [];
  const seen = new Set();
  for (const template of templates) {
    if (!template || seen.has(template.id)) {
      continue;
    }
    seen.add(template.id);
    result.push(template);
  }
  return result;
}

function parseTemplateCatalog(raw) {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const row = raw;
  const presets = Array.isArray(row.presets) ? row.presets : [];
  const custom = Array.isArray(row.custom) ? row.custom : [];
  const merged = [];

  for (let index = 0; index < presets.length; index += 1) {
    const normalized = normalizeTemplate(presets[index], "preset", index);
    if (normalized) {
      merged.push(normalized);
    }
  }
  for (let index = 0; index < custom.length; index += 1) {
    const normalized = normalizeTemplate(custom[index], "custom", index);
    if (normalized) {
      merged.push(normalized);
    }
  }

  return dedupeTemplates(merged);
}

async function loadTemplates(ctx) {
  const projectRef = asString(ctx && ctx.projectKey);
  const localData = ctx && typeof ctx.localData === "object"
    ? ctx.localData
    : null;

  if (!projectRef) {
    return parseTemplateCatalog(DEFAULT_PPT_TEMPLATE_CATALOG);
  }

  if (localData && typeof localData.readFile === "function") {
    try {
      const file = await localData.readFile(TEMPLATE_CATALOG_PATH, {
        scope: "project",
        encoding: "utf8",
      });
      const raw = JSON.parse(asString(file.content) || "{}");
      const templates = parseTemplateCatalog(raw);
      if (templates.length > 0) {
        return templates;
      }
    } catch (error) {
      console.warn("[ppt-plugin] Failed to read template catalog:", error);
    }
  }

  const fallback = parseTemplateCatalog(DEFAULT_PPT_TEMPLATE_CATALOG);
  if (localData && typeof localData.writeFile === "function") {
    try {
      await localData.writeFile(
        TEMPLATE_CATALOG_PATH,
        JSON.stringify(DEFAULT_PPT_TEMPLATE_CATALOG, null, 2),
        {
          scope: "project",
          encoding: "utf8",
          overwrite: false,
        },
      );
    } catch (error) {
      console.warn("[ppt-plugin] Failed to bootstrap template catalog:", error);
    }
  }

  return fallback;
}

function parseProjectRef(projectRef) {
  const raw = asString(projectRef);
  if (!raw) return null;
  const parts = raw.split("::").map((item) => item.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return {
    ownerType: parts[0],
    ownerKey: parts[1],
    projectKey: parts.slice(2).join("::"),
  };
}

function buildProjectApiBase(projectRef) {
  const parsed = parseProjectRef(projectRef);
  if (!parsed) return null;
  return `/api/projects/${encodeURIComponent(parsed.ownerType)}/${encodeURIComponent(parsed.ownerKey)}/${encodeURIComponent(parsed.projectKey)}`;
}

function buildAssetUrl(projectRef, assetId) {
  const base = buildProjectApiBase(projectRef);
  if (!base) return "";
  const raw = asString(assetId).replace(/^storage:\/\//, "");
  if (!raw) return "";
  return `${base}/assets/${encodeURIComponent(raw)}/content`;
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== "OK") {
    throw new Error(payload.message || "请求失败");
  }
  return payload.data;
}

async function loadAgentDocuments(projectRef, query) {
  const base = buildProjectApiBase(projectRef);
  if (!base) {
    throw new Error("缺少项目上下文");
  }
  const params = new URLSearchParams();
  params.set("generated_by", PPT_AGENT_ID);
  params.set("doc_type", "ppt");
  const keyword = asString(query);
  if (keyword) {
    params.set("q", keyword);
  }
  return fetchJson(`${base}/documents/filter?${params.toString()}`);
}

async function loadDocumentDetail(projectRef, docId) {
  const base = buildProjectApiBase(projectRef);
  if (!base) {
    throw new Error("缺少项目上下文");
  }
  return fetchJson(`${base}/documents/${encodeURIComponent(docId)}`);
}

function formatDate(value) {
  const raw = asString(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

function extractText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return asString(node.text);
  if (node.type === "hardBreak") return "\n";
  if (Array.isArray(node.content)) {
    return node.content.map((child) => extractText(child)).join("");
  }
  return "";
}

function extractDocSections(content) {
  const nodes = Array.isArray(content) ? content : [];
  const fileBlocks = [];
  const htmlBlocks = [];
  let pptContent = [];
  let contentStart = -1;

  nodes.forEach((node, index) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "file_block") {
      fileBlocks.push(node);
    }
    if (node.type === "codeBlock") {
      const lang = asString(node.attrs && node.attrs.language).toLowerCase();
      if (lang === "html") {
        htmlBlocks.push(node);
      }
    }
    if (node.type === "heading") {
      const title = extractText(node).trim();
      if (title === "PPT 内容") {
        contentStart = index + 1;
      }
    }
  });

  if (contentStart >= 0) {
    pptContent = nodes.slice(contentStart);
  } else {
    pptContent = nodes.filter((node) => {
      if (!node || typeof node !== "object") return false;
      if (node.type === "file_block") return false;
      if (node.type === "codeBlock") {
        const lang = asString(node.attrs && node.attrs.language).toLowerCase();
        if (lang === "html") return false;
      }
      return true;
    });
  }

  return { fileBlocks, htmlBlocks, pptContent };
}

function parseHtmlBody(html) {
  const raw = asString(html);
  if (!raw) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, "text/html");
    if (doc.body && doc.body.innerHTML.trim()) {
      return doc.body.innerHTML;
    }
  } catch (error) {
    return raw;
  }
  return raw;
}

function renderDocNodes(nodes) {
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    switch (node.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(node.attrs && node.attrs.level) || 1));
        const el = document.createElement(`h${level}`);
        el.textContent = extractText(node);
        fragment.appendChild(el);
        break;
      }
      case "paragraph": {
        const el = document.createElement("p");
        el.textContent = extractText(node);
        fragment.appendChild(el);
        break;
      }
      case "bulletList":
      case "orderedList": {
        const list = document.createElement(node.type === "orderedList" ? "ol" : "ul");
        const items = Array.isArray(node.content) ? node.content : [];
        for (const item of items) {
          if (!item || item.type !== "listItem") continue;
          const li = document.createElement("li");
          li.textContent = extractText(item);
          list.appendChild(li);
        }
        fragment.appendChild(list);
        break;
      }
      case "horizontalRule": {
        fragment.appendChild(document.createElement("hr"));
        break;
      }
      case "codeBlock": {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = extractText(node);
        pre.appendChild(code);
        fragment.appendChild(pre);
        break;
      }
      case "image": {
        const src = asString(node.attrs && node.attrs.src);
        if (src) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = asString(node.attrs && node.attrs.alt);
          fragment.appendChild(img);
        }
        break;
      }
      default: {
        const text = extractText(node);
        if (text) {
          const span = document.createElement("p");
          span.textContent = text;
          fragment.appendChild(span);
        }
        break;
      }
    }
  }
  return fragment;
}

function bootstrapPptDocList(containerId, ctx) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const hasLayout = !!container.querySelector(".ppt-plugin-doc-layout");
  if (container.dataset.ready === "true" && hasLayout) return;
  container.dataset.ready = "true";

  container.innerHTML = `
    <div class="ppt-plugin-doc-layout">
      <aside class="kb-sidebar ppt-plugin-doc-sidebar">
        <div class="kb-sidebar-toolbar">
          <div class="ppt-plugin-doc-list-title">PPT 文档</div>
          <div class="kb-sidebar-toolbar-spacer"></div>
          <button
            type="button"
            class="kb-sidebar-toolbar-btn ppt-plugin-doc-refresh"
            aria-label="刷新文档列表"
          >
            <svg class="ppt-plugin-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M17.65 6.35A7.95 7.95 0 0 0 12 4C7.58 4 4 7.58 4 12h2a6 6 0 1 1 6 6 5.94 5.94 0 0 1-4.24-1.76L9 15H4v5l1.5-1.5A7.94 7.94 0 0 0 12 20c4.42 0 8-3.58 8-8 0-2.21-.9-4.21-2.35-5.65Z"
              />
            </svg>
          </button>
        </div>
        <div class="kb-sidebar-content">
          <div class="ppt-plugin-doc-status"></div>
          <div class="ppt-plugin-doc-list-wrap"></div>
        </div>
      </aside>
      <div class="ppt-plugin-doc-detail">
        <div class="ppt-plugin-doc-tabs"></div>
        <div class="ppt-plugin-doc-view"></div>
      </div>
    </div>
  `;

  const refreshButton = container.querySelector(".ppt-plugin-doc-refresh");
  const statusEl = container.querySelector(".ppt-plugin-doc-status");
  const listEl = container.querySelector(".ppt-plugin-doc-list-wrap");
  const tabsEl = container.querySelector(".ppt-plugin-doc-tabs");
  const viewEl = container.querySelector(".ppt-plugin-doc-view");

  let agentDocs = [];
  let loading = false;
  let selectedId = "";
  let selectedSections = null;
  let activeTab = "doc";

  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message;
  };

  const listItems = new Map();
  const rebuildList = () => {
    if (!listEl) return;
    listItems.clear();
    listEl.innerHTML = "";
    if (!agentDocs.length) {
      const empty = document.createElement("div");
      empty.className = "kb-doc-empty ppt-plugin-doc-empty";
      empty.textContent = "暂无 Agent 生成的 PPT 文档";
      listEl.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "kb-doc-group ppt-plugin-doc-list";
    for (const doc of agentDocs) {
      const node = document.createElement("div");
      node.className = "kb-doc-node";
      const row = document.createElement("div");
      row.className = "kb-doc-row";
      const control = document.createElement("div");
      control.className = "kb-doc-control ppt-plugin-doc-control";
      control.tabIndex = 0;
      control.addEventListener("click", () => handleSelect(doc));
      control.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          handleSelect(doc);
        }
      });

      const action = document.createElement("span");
      action.className = "kb-doc-action";
      const dot = document.createElement("span");
      dot.className = "kb-doc-dot";
      action.appendChild(dot);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "kb-doc-item ppt-plugin-doc-item";
      button.tabIndex = -1;

      const textWrap = document.createElement("div");
      textWrap.className = "ppt-plugin-doc-text";
      const title = document.createElement("div");
      title.className = "ppt-plugin-doc-title";
      title.textContent = doc.title;
      const meta = document.createElement("div");
      meta.className = "ppt-plugin-doc-meta";
      meta.textContent = doc.updatedAt ? `更新时间 ${formatDate(doc.updatedAt)}` : "更新信息未知";

      textWrap.appendChild(title);
      textWrap.appendChild(meta);
      button.appendChild(textWrap);

      control.appendChild(action);
      control.appendChild(button);
      row.appendChild(control);
      node.appendChild(row);
      list.appendChild(node);
      listItems.set(doc.id, control);
    }
    listEl.appendChild(list);
  };

  const setActiveItem = (docId) => {
    listItems.forEach((item, id) => {
      if (id === docId) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });
  };

  const renderTabs = () => {
    if (!tabsEl || !selectedSections) return;
    tabsEl.innerHTML = "";
    const tabs = [];
    if (selectedSections.fileBlocks.length > 0) {
      tabs.push({ id: "ppt", label: "PPT 文档" });
    }
    if (selectedSections.htmlBlocks.length > 0) {
      tabs.push({ id: "html", label: "HTML 视图" });
    }
    tabs.push({ id: "doc", label: "文档视图" });
    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `ppt-plugin-doc-tab ${activeTab === tab.id ? "is-active" : ""}`;
      btn.textContent = tab.label;
      btn.addEventListener("click", () => {
        activeTab = tab.id;
        renderTabs();
        renderView();
      });
      tabsEl.appendChild(btn);
    });
  };

  const renderView = () => {
    if (!viewEl || !selectedSections) return;
    viewEl.innerHTML = "";
    if (activeTab === "ppt") {
      const block = selectedSections.fileBlocks[0];
      if (!block) return;
      const attrs = block.attrs || {};
      const assetId = asString(attrs.asset_id);
      const fileName = asString(attrs.file_name) || "presentation.pptx";
      const size = attrs.size ? `${attrs.size}` : "";
      const wrap = document.createElement("div");
      wrap.className = "ppt-plugin-view-card";

      const title = document.createElement("div");
      title.className = "ppt-plugin-view-title";
      title.textContent = fileName;
      wrap.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "ppt-plugin-view-meta";
      meta.textContent = size ? `大小 ${size} bytes` : "PPTX 文件";
      wrap.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "ppt-plugin-view-actions";
      const openAsset = document.createElement("a");
      openAsset.href = buildAssetUrl(ctx.projectKey, assetId);
      openAsset.textContent = "打开 PPTX";
      openAsset.className = "ppt-plugin-doc-open";
      openAsset.target = "_blank";
      const openDoc = document.createElement("a");
      openDoc.href = `#/documents/${encodeURIComponent(selectedId)}`;
      openDoc.textContent = "在文档中查看";
      openDoc.className = "ppt-plugin-doc-open";
      openDoc.target = "_blank";
      actions.appendChild(openAsset);
      actions.appendChild(openDoc);
      wrap.appendChild(actions);

      viewEl.appendChild(wrap);
      return;
    }
    if (activeTab === "html") {
      const htmlBlocks = selectedSections.htmlBlocks;
      if (!htmlBlocks.length) return;
      const stack = document.createElement("div");
      stack.className = "ppt-plugin-html-stack";
      htmlBlocks.forEach((block, index) => {
        const code = extractText(block);
        const bodyHtml = parseHtmlBody(code);
        const section = document.createElement("section");
        section.className = "ppt-plugin-html-card";
        const heading = document.createElement("div");
        heading.className = "ppt-plugin-html-title";
        heading.textContent = `幻灯片第 ${index + 1} 页`;
        const editable = document.createElement("div");
        editable.className = "ppt-plugin-html-editable";
        editable.contentEditable = "true";
        editable.spellcheck = false;
        editable.innerHTML = bodyHtml;
        section.appendChild(heading);
        section.appendChild(editable);
        stack.appendChild(section);
      });
      viewEl.appendChild(stack);
      return;
    }

    const docNodes = selectedSections.pptContent;
    if (!docNodes || docNodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ppt-plugin-doc-empty";
      empty.textContent = "暂无文档内容";
      viewEl.appendChild(empty);
      return;
    }
    const docWrap = document.createElement("div");
    docWrap.className = "ppt-plugin-doc-render";
    docWrap.appendChild(renderDocNodes(docNodes));
    viewEl.appendChild(docWrap);
  };

  const handleSelect = async (doc) => {
    selectedId = doc.id;
    setActiveItem(selectedId);
    setStatus("");
    try {
      const detail = await loadDocumentDetail(ctx.projectKey, doc.id);
      const meta = detail && typeof detail === "object" ? detail.meta : null;
      const body = detail && typeof detail === "object" ? detail.body : null;
      const content = body && body.content && body.content.content ? body.content.content : [];
      selectedSections = extractDocSections(content);
      if (selectedSections.fileBlocks.length > 0) {
        activeTab = "ppt";
      } else if (selectedSections.htmlBlocks.length > 0) {
        activeTab = "html";
      } else {
        activeTab = "doc";
      }
      renderTabs();
      renderView();
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "加载详情失败");
    }
  };

  const normalizeDoc = (row) => {
    if (!row || typeof row !== "object") {
      return null;
    }
    const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
    return {
      id: asString(row.id),
      title: asString(row.title || row.slug || row.id),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      sourceDocIds: Array.isArray(extra.source_doc_ids)
        ? extra.source_doc_ids.map((item) => asString(item)).filter(Boolean)
        : [],
      knowledgeQueries: Array.isArray(extra.knowledge_queries)
        ? extra.knowledge_queries.map((item) => asString(item)).filter(Boolean)
        : [],
    };
  };

  const loadAgentDocs = async () => {
    if (loading) return;
    loading = true;
    setStatus("");
    try {
      const rows = await loadAgentDocuments(ctx.projectKey);
      const collected = Array.isArray(rows)
        ? rows.map(normalizeDoc).filter(Boolean)
        : [];
      collected.sort((a, b) => {
        const aTime = Date.parse(a.updatedAt || a.createdAt || "") || 0;
        const bTime = Date.parse(b.updatedAt || b.createdAt || "") || 0;
        return bTime - aTime;
      });
      agentDocs = collected;
      rebuildList();
      if (selectedId && listItems.has(selectedId)) {
        setActiveItem(selectedId);
      } else {
        selectedId = "";
      }
      if (tabsEl) tabsEl.innerHTML = "";
      if (viewEl) {
        viewEl.innerHTML = `<div class="ppt-plugin-doc-empty">请选择左侧文档查看详情</div>`;
      }
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "加载失败");
    } finally {
      loading = false;
    }
  };

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      void loadAgentDocs();
    });
  }

  void loadAgentDocs();
}

let pptDocBootstrapSeq = 0;

function schedulePptDocBootstrap(ctx) {
  const seq = (pptDocBootstrapSeq += 1);
  const start = Date.now();
  const attempt = () => {
    if (seq !== pptDocBootstrapSeq) return;
    const container = document.getElementById(PPT_DOC_CONTAINER_ID);
    if (container) {
      bootstrapPptDocList(PPT_DOC_CONTAINER_ID, ctx);
      return;
    }
    if (Date.now() - start > 3000) {
      console.warn("[ppt-plugin] PPT 文档容器未挂载，跳过初始化。");
      return;
    }
    setTimeout(attempt, 50);
  };
  setTimeout(attempt, 0);
}

function renderTemplateCard(h, template) {
  const sourceLabel = template.source === "custom" ? "自定义模版" : "预设模版";
  return h("article", { key: template.id, className: "ppt-plugin-template-card" }, [
    h("div", { className: "ppt-plugin-template-card-head" }, [
      h("h3", { className: "ppt-plugin-template-card-title" }, template.name),
      h("div", { className: "ppt-plugin-template-card-meta" }, [
        h(
          "span",
          {
            className: `ppt-plugin-template-source ${template.source === "custom" ? "is-custom" : "is-preset"}`,
          },
          sourceLabel,
        ),
        h("span", { className: "ppt-plugin-template-card-id" }, template.id),
      ]),
    ]),
    h("p", { className: "ppt-plugin-template-card-desc" }, template.description),
    h(
      "div",
      { className: "ppt-plugin-template-card-tags" },
      template.tags.length > 0
        ? template.tags.map((tag) =>
          h("span", { key: `${template.id}-${tag}`, className: "ppt-plugin-template-tag" }, tag),
        )
        : [h("span", { className: "ppt-plugin-template-tag is-muted" }, "未设置标签")],
    ),
  ]);
}

function renderPptNav(h, active) {
  return h("nav", { className: "ppt-plugin-nav" }, [
    h(
      "a",
      {
        className: `ppt-plugin-nav-item ${active === "templates" ? "is-active" : ""}`,
        href: buildHashRoute(PPT_AGENT_ROUTE),
      },
      "模版库",
    ),
    h(
      "a",
      {
        className: `ppt-plugin-nav-item ${active === "tree" ? "is-active" : ""}`,
        href: buildHashRoute(PPT_TREE_ROUTE),
      },
      "PPT 文档",
    ),
  ]);
}

function renderPptAgentPage(h, templates) {
  const hasTemplates = Array.isArray(templates) && templates.length > 0;
  return h("section", { className: "ppt-plugin-page" }, [
    h("header", { className: "ppt-plugin-header" }, [
      h("h2", { className: "ppt-plugin-title" }, "PPT Agent"),
    ]),
    renderPptNav(h, "templates"),
    hasTemplates
      ? h(
        "div",
        { key: "ppt-template-grid", className: "ppt-plugin-template-grid" },
        templates.map((template) => renderTemplateCard(h, template)),
      )
      : h("div", { key: "ppt-template-empty", className: "ppt-plugin-empty" }, "暂无可用 PPT 模版。"),
  ]);
}

function renderPptTreePage(h, ctx) {
  schedulePptDocBootstrap(ctx);
  return h("section", { className: "ppt-plugin-page" }, [
    h("header", { className: "ppt-plugin-header" }, [
      h("h2", { className: "ppt-plugin-title" }, "PPT Agent"),
    ]),
    renderPptNav(h, "tree"),
    h("div", { key: "ppt-doc-panel", id: PPT_DOC_CONTAINER_ID, className: "ppt-plugin-doc-panel" }),
  ]);
}

const plugin = {
  async register(ctx) {
    const sdk = ctx && ctx.docEditor ? ctx.docEditor : null;
    const createElement = sdk && sdk.react && typeof sdk.react.createElement === "function"
      ? sdk.react.createElement
      : null;

    if (sdk && typeof sdk.loadStyle === "function") {
      try {
        sdk.loadStyle("ppt-agent.css");
      } catch (error) {
        console.warn("[ppt-plugin] Failed to load style:", error);
      }
    }

    const templates = await loadTemplates(ctx);
    return {
      routes: [
        {
          id: "agent",
          path: "/plugins/ppt-plugin/agent",
          title: "PPT Agent",
          render: () =>
            createElement
              ? renderPptAgentPage(createElement, templates)
              : "PPT Agent 插件已加载。",
        },
        {
          id: "agent-tree",
          path: "/plugins/ppt-plugin/agent/tree",
          title: "PPT 文档",
          render: () =>
            createElement
              ? renderPptTreePage(createElement, ctx)
              : "PPT Agent 插件已加载。",
        },
      ],
    };
  },
};

export default plugin;
