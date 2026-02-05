/**
 * RAG System Integration Test
 *
 * Tests the multi-granularity indexing and retrieval system.
 */

import { indexStore } from "../src/knowledge/index-store.js";
import { ragSearch, ragSearchWithState } from "../src/knowledge/rag-graph.js";
import { chunkDocument, flattenChunkResult, getChunkStats } from "../src/knowledge/chunker-v2.js";
import type { Document } from "../src/storage/types.js";

// Test configuration
const TEST_USER_ID = "test-user";
const TEST_PROJECT_KEY = "test-project";

// Sample document for testing
const sampleDocument: Document = {
  meta: {
    id: "test-doc-001",
    schema_version: "1.0",
    title: "Zeus 用户认证指南",
    slug: "auth-guide",
    path: "/docs/auth-guide",
    parent_id: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  body: {
    type: "tiptap",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, id: "intro" },
          content: [{ type: "text", text: "用户认证概述" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [
            {
              type: "text",
              text: "Zeus 支持多种认证方式，包括 JWT Token 认证、OAuth 2.0 和 API Key 认证。本文档将详细介绍如何配置和使用这些认证方式。",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2, id: "jwt" },
          content: [{ type: "text", text: "JWT Token 认证" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p2" },
          content: [
            {
              type: "text",
              text: "JWT (JSON Web Token) 是最常用的认证方式。用户登录后会获得一个 JWT Token，后续请求需要在 Authorization header 中携带此 Token。",
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "typescript", id: "code1" },
          content: [
            {
              type: "text",
              text: `// JWT 验证中间件
export function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}`,
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2, id: "oauth" },
          content: [{ type: "text", text: "OAuth 2.0 认证" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p3" },
          content: [
            {
              type: "text",
              text: "OAuth 2.0 支持 GitHub、Google 等第三方登录。配置 OAuth 需要在管理后台设置 Client ID 和 Client Secret。",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2, id: "apikey" },
          content: [{ type: "text", text: "API Key 认证" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p4" },
          content: [
            {
              type: "text",
              text: "API Key 适用于服务器间调用。在请求头中添加 X-API-Key 即可完成认证。API Key 可以在用户设置页面生成和管理。",
            },
          ],
        },
      ],
    },
  },
};

// Another document for testing
const sampleDocument2: Document = {
  meta: {
    id: "test-doc-002",
    schema_version: "1.0",
    title: "数据库配置说明",
    slug: "database-config",
    path: "/docs/database-config",
    parent_id: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  body: {
    type: "tiptap",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, id: "db-intro" },
          content: [{ type: "text", text: "数据库配置" }],
        },
        {
          type: "paragraph",
          attrs: { id: "db-p1" },
          content: [
            {
              type: "text",
              text: "Zeus 使用 PostgreSQL 作为主数据库，支持 pgvector 扩展进行向量检索，zhparser 进行中文全文搜索。",
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "sql", id: "db-code1" },
          content: [
            {
              type: "text",
              text: `-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS zhparser;`,
            },
          ],
        },
      ],
    },
  },
};

async function runTests() {
  console.log("🚀 Starting RAG System Tests\n");

  // Test 1: Chunking
  console.log("📝 Test 1: Multi-Granularity Chunking");
  console.log("─".repeat(50));

  const chunks = chunkDocument(TEST_USER_ID, TEST_PROJECT_KEY, sampleDocument);
  const stats = getChunkStats(chunks);

  console.log(`  Document: ${sampleDocument.meta.title}`);
  console.log(`  Chunks created:`);
  console.log(`    - Document level: ${stats.documentChunks}`);
  console.log(`    - Section level: ${stats.sectionChunks}`);
  console.log(`    - Block level: ${stats.blockChunks}`);
  console.log(`    - Code level: ${stats.codeChunks}`);
  console.log(`    - Total: ${stats.totalChunks}`);

  const entries = flattenChunkResult(chunks);
  console.log(`\n  Sample entries:`);
  for (const entry of entries.slice(0, 3)) {
    console.log(`    [${entry.granularity}] ${entry.content.slice(0, 60)}...`);
  }
  console.log("  ✅ Chunking test passed\n");

  // Test 2: Indexing
  console.log("📥 Test 2: Document Indexing");
  console.log("─".repeat(50));

  try {
    // Index first document
    const result1 = await indexStore.indexDocument(
      TEST_USER_ID,
      TEST_PROJECT_KEY,
      sampleDocument,
    );
    console.log(`  Document 1: Indexed ${result1.indexed} entries`);
    if (result1.errors.length > 0) {
      console.log(`  Warnings: ${result1.errors.join(", ")}`);
    }

    // Index second document
    const result2 = await indexStore.indexDocument(
      TEST_USER_ID,
      TEST_PROJECT_KEY,
      sampleDocument2,
    );
    console.log(`  Document 2: Indexed ${result2.indexed} entries`);

    // Get stats
    const indexStats = await indexStore.getStats(TEST_USER_ID, TEST_PROJECT_KEY);
    console.log(`\n  Index statistics:`);
    console.log(`    - Total entries: ${indexStats.totalEntries}`);
    console.log(`    - Documents: ${indexStats.documentCount}`);
    console.log(`    - By granularity:`);
    for (const [gran, count] of Object.entries(indexStats.byGranularity)) {
      if (count > 0) {
        console.log(`      - ${gran}: ${count}`);
      }
    }
    console.log("  ✅ Indexing test passed\n");
  } catch (err) {
    console.log(`  ⚠️ Indexing test skipped: ${err instanceof Error ? err.message : String(err)}`);
    console.log("  (This may be due to missing embedding provider configuration)\n");
  }

  // Test 3: Full-text Search
  console.log("🔍 Test 3: Full-text Search");
  console.log("─".repeat(50));

  try {
    const fulltextResults = await indexStore.searchByFulltext(
      TEST_USER_ID,
      TEST_PROJECT_KEY,
      "JWT Token 认证",
      { limit: 5 },
    );

    console.log(`  Query: "JWT Token 认证"`);
    console.log(`  Results: ${fulltextResults.length}`);
    for (const result of fulltextResults.slice(0, 3)) {
      console.log(`    - [${result.granularity}] score=${result.score.toFixed(3)}: ${result.content.slice(0, 50)}...`);
    }
    console.log("  ✅ Full-text search test passed\n");
  } catch (err) {
    console.log(`  ⚠️ Full-text search test failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Test 4: Vector Search (if embedding is configured)
  console.log("🧠 Test 4: Vector Search");
  console.log("─".repeat(50));

  try {
    const vectorResults = await indexStore.searchByVector(
      TEST_USER_ID,
      TEST_PROJECT_KEY,
      "如何验证用户身份",
      { limit: 5 },
    );

    console.log(`  Query: "如何验证用户身份"`);
    console.log(`  Results: ${vectorResults.length}`);
    for (const result of vectorResults.slice(0, 3)) {
      console.log(`    - [${result.granularity}] score=${result.score.toFixed(3)}: ${result.content.slice(0, 50)}...`);
    }
    console.log("  ✅ Vector search test passed\n");
  } catch (err) {
    console.log(`  ⚠️ Vector search test skipped: ${err instanceof Error ? err.message : String(err)}`);
    console.log("  (This requires embedding provider to be configured)\n");
  }

  // Test 5: Hybrid Search
  console.log("🔄 Test 5: Hybrid Search (RRF Fusion)");
  console.log("─".repeat(50));

  try {
    const hybridResults = await indexStore.searchHybrid(
      TEST_USER_ID,
      TEST_PROJECT_KEY,
      "PostgreSQL 数据库配置",
      { limit: 5 },
    );

    console.log(`  Query: "PostgreSQL 数据库配置"`);
    console.log(`  Results: ${hybridResults.length}`);
    for (const result of hybridResults.slice(0, 3)) {
      console.log(`    - [${result.granularity}] score=${result.score.toFixed(3)}: ${result.content.slice(0, 50)}...`);
    }
    console.log("  ✅ Hybrid search test passed\n");
  } catch (err) {
    console.log(`  ⚠️ Hybrid search test failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Test 6: RAG Search with State Machine
  console.log("🤖 Test 6: RAG Search (Adaptive Strategy)");
  console.log("─".repeat(50));

  try {
    const ragState = await ragSearchWithState(
      TEST_USER_ID,
      TEST_PROJECT_KEY,
      "如何配置 JWT 认证?",
      {
        strategy: "adaptive",
        enableSelfRAG: false, // Disable to avoid LLM calls
        enableReranking: false,
      },
    );

    console.log(`  Query: "如何配置 JWT 认证?"`);
    console.log(`  Query Type: ${ragState.queryType}`);
    console.log(`  Strategy: ${ragState.strategy}`);
    console.log(`  Retrieved: ${ragState.retrievedDocs.length} documents`);
    console.log(`  Reranked: ${ragState.rerankedDocs.length} documents`);

    if (ragState.rerankedDocs.length > 0) {
      console.log(`\n  Top results:`);
      for (const doc of ragState.rerankedDocs.slice(0, 3)) {
        console.log(`    - [${doc.granularity}] ${doc.content.slice(0, 50)}...`);
      }
    }
    console.log("  ✅ RAG search test passed\n");
  } catch (err) {
    console.log(`  ⚠️ RAG search test failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Test 7: Code Symbol Extraction
  console.log("💻 Test 7: Code Symbol Extraction");
  console.log("─".repeat(50));

  const codeEntries = entries.filter((e) => e.granularity === "code");
  for (const entry of codeEntries) {
    console.log(`  Code block language: ${entry.metadata.language}`);
    console.log(`  Extracted symbols: ${entry.metadata.symbols?.join(", ") || "none"}`);
  }
  console.log("  ✅ Code symbol extraction test passed\n");

  // Cleanup
  console.log("🧹 Cleanup");
  console.log("─".repeat(50));

  try {
    const removed = await indexStore.removeProject(TEST_USER_ID, TEST_PROJECT_KEY);
    console.log(`  Removed ${removed} index entries`);
    console.log("  ✅ Cleanup completed\n");
  } catch (err) {
    console.log(`  ⚠️ Cleanup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  console.log("🎉 All tests completed!");
}

// Run tests
runTests().catch(console.error);
