import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTranscriptionEndpoints,
  resolveTranscriptionRuntimeConfig,
  type TranscriptionConfigType,
} from "../src/services/parse-service.ts";

test("buildTranscriptionEndpoints uses OpenAI default endpoint when baseUrl is missing", () => {
  const endpoints = buildTranscriptionEndpoints("openai");
  assert.deepEqual(endpoints, ["https://api.openai.com/v1/audio/transcriptions"]);
});

test("buildTranscriptionEndpoints keeps explicit transcription endpoint as-is", () => {
  const endpoints = buildTranscriptionEndpoints(
    "openai-compatible",
    "http://localhost:8000/v1/audio/transcriptions",
  );
  assert.deepEqual(endpoints, ["http://localhost:8000/v1/audio/transcriptions"]);
});

test("buildTranscriptionEndpoints strips chat completion suffix and builds transcription path", () => {
  const endpoints = buildTranscriptionEndpoints(
    "openai-compatible",
    "http://localhost:8000/v1/chat/completions",
  );
  assert.equal(endpoints[0], "http://localhost:8000/v1/audio/transcriptions");
});

test("buildTranscriptionEndpoints adds compatibility fallback for custom base URL", () => {
  const endpoints = buildTranscriptionEndpoints(
    "openai-compatible",
    "http://localhost:8000/openai",
  );
  assert.deepEqual(endpoints, [
    "http://localhost:8000/openai/v1/audio/transcriptions",
    "http://localhost:8000/openai/audio/transcriptions",
  ]);
});

test("resolveTranscriptionRuntimeConfig prefers transcription config when available", async () => {
  const config = await resolveTranscriptionRuntimeConfig(async (configType) => {
    if (configType === "transcription") {
      return {
        enabled: true,
        providerId: "openai-compatible",
        baseUrl: "http://localhost:8000/v1",
        defaultModel: "whisper-1",
        apiKey: "test-key",
      };
    }
    if (configType === "llm") {
      return {
        enabled: true,
        providerId: "openai",
        apiKey: "llm-key",
      };
    }
    return null;
  });

  assert.equal(config?.configType, "transcription");
  assert.equal(config?.config.providerId, "openai-compatible");
});

test("resolveTranscriptionRuntimeConfig throws when transcription config exists but disabled", async () => {
  await assert.rejects(
    () =>
      resolveTranscriptionRuntimeConfig(async (configType) => {
        if (configType === "transcription") {
          return {
            enabled: false,
            providerId: "openai-compatible",
            apiKey: "disabled",
          };
        }
        return null;
      }),
    /音视频转写配置已禁用/,
  );
});

test("resolveTranscriptionRuntimeConfig falls back to llm then vision", async () => {
  const calls: TranscriptionConfigType[] = [];
  const resolved = await resolveTranscriptionRuntimeConfig(async (configType) => {
    calls.push(configType);
    if (configType === "llm") {
      return {
        enabled: true,
        providerId: "openai-compatible",
        baseUrl: "http://localhost:8000/v1",
        defaultModel: "whisper-1",
        apiKey: "llm-key",
      };
    }
    return null;
  });

  assert.deepEqual(calls, ["transcription", "llm"]);
  assert.equal(resolved?.configType, "llm");
});
