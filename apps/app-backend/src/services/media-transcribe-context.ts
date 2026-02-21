import { assetStore } from "../storage/asset-store.js";
import {
  inspectDocumentSnapshot,
  type DocumentInspectSnapshot,
} from "./document-inspect.js";

export type MediaAttachmentRef = {
  assetId: string;
  name?: string;
  mimeType?: string;
  type?: string;
};

export type MediaScope = "all" | "audio" | "video";

export type MediaCandidateKind = "audio" | "video";

export type MediaTranscribeCandidate = {
  candidateKey: string;
  assetId: string;
  source: "attachment" | "document";
  mediaKind: MediaCandidateKind;
  label: string;
  filename?: string;
  mimeType?: string;
  docId?: string;
  docTitle?: string;
  blockId?: string;
};

type ResolveMediaCandidatesInput = {
  userId: string;
  projectKey: string;
  attachments?: MediaAttachmentRef[];
  docIds?: string[];
  explicitDocId?: string;
  explicitBlockId?: string;
  mediaScope?: MediaScope;
  documentSnapshots?: DocumentInspectSnapshot[];
  maxDocs?: number;
  maxCandidates?: number;
};

const MEDIA_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "flac",
  "webm",
  "mpga",
  "mpeg",
]);

const MEDIA_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "mkv",
  "avi",
  "webm",
  "m4v",
  "ogv",
]);

const DEFAULT_MAX_DOCS = 40;
const DEFAULT_MAX_CANDIDATES = 50;

function extOf(filename: string): string {
  const normalized = String(filename || "").trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) return "";
  return normalized.slice(dot + 1);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeCandidateKind(value: unknown): MediaCandidateKind | null {
  const text = normalizeString(value).toLowerCase();
  if (text === "audio") return "audio";
  if (text === "video") return "video";
  return null;
}

function detectMediaKind(
  mime: string,
  filename: string,
  fileType?: unknown,
): MediaCandidateKind | null {
  const normalizedMime = normalizeString(mime).toLowerCase();
  if (normalizedMime.startsWith("audio/")) return "audio";
  if (normalizedMime.startsWith("video/")) return "video";

  const ext = extOf(filename);
  if (MEDIA_AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (MEDIA_VIDEO_EXTENSIONS.has(ext)) return "video";

  return normalizeCandidateKind(fileType);
}

function toCandidateLabel(parts: Array<string | undefined>): string {
  return parts
    .map((part) => normalizeString(part))
    .filter(Boolean)
    .join(" | ");
}

function buildCandidateKey(candidate: {
  source: "attachment" | "document";
  assetId: string;
  docId?: string;
  blockId?: string;
}): string {
  const sourcePrefix = candidate.source === "document" ? "doc" : "att";
  const docPart = candidate.source === "document" ? `:${candidate.docId || "unknown"}` : "";
  const blockPart = candidate.source === "document" ? `:${candidate.blockId || "block"}` : "";
  const raw = `${sourcePrefix}${docPart}${blockPart}:${candidate.assetId}`;
  return raw.replace(/[^a-zA-Z0-9:_-]/g, "-");
}

function matchesScope(kind: MediaCandidateKind, scope: MediaScope): boolean {
  if (scope === "all") return true;
  return kind === scope;
}

function normalizeCandidate(
  current: MediaTranscribeCandidate,
  existing?: MediaTranscribeCandidate,
): MediaTranscribeCandidate {
  if (!existing) return current;
  return {
    ...existing,
    ...current,
    candidateKey: current.candidateKey || existing.candidateKey,
    label: current.label || existing.label,
    filename: current.filename || existing.filename,
    mimeType: current.mimeType || existing.mimeType,
    docId: existing.docId || current.docId,
    docTitle: existing.docTitle || current.docTitle,
    blockId: existing.blockId || current.blockId,
    mediaKind: current.mediaKind || existing.mediaKind,
    source: existing.source === "attachment" ? "attachment" : current.source,
  };
}

export function normalizeMediaScope(value: unknown): MediaScope {
  const text = normalizeString(value).toLowerCase();
  if (text === "audio" || text === "video") return text;
  return "all";
}

export function querySuggestsBatchTranscription(query: string): boolean {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return false;
  return /(?:全部|所有|多个|多段|批量|分别|逐个|每个|all|every|each|multiple|batch)/i.test(text);
}

function parseMediaCandidatesFromArg(
  value: unknown,
): MediaTranscribeCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: MediaTranscribeCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const assetId = normalizeString(obj.asset_id ?? obj.assetId);
    if (!assetId) continue;

    const sourceRaw = normalizeString(obj.source).toLowerCase();
    const source: "attachment" | "document" =
      sourceRaw === "document" ? "document" : "attachment";

    const filename = normalizeString(obj.filename);
    const mimeType = normalizeString(obj.mime_type ?? obj.mimeType);
    const mediaKind = detectMediaKind(mimeType, filename, obj.media_kind ?? obj.mediaKind);
    if (!mediaKind) continue;

    const docId = normalizeString(obj.doc_id ?? obj.docId);
    const blockId = normalizeString(obj.block_id ?? obj.blockId);

    const candidateKey = normalizeString(obj.candidate_key ?? obj.candidateKey)
      || buildCandidateKey({
        source,
        assetId,
        ...(docId ? { docId } : {}),
        ...(blockId ? { blockId } : {}),
      });

    out.push({
      candidateKey,
      assetId,
      source,
      mediaKind,
      label: normalizeString(obj.label) || assetId,
      filename: filename || undefined,
      mimeType: mimeType || undefined,
      docId: docId || undefined,
      docTitle: normalizeString(obj.doc_title ?? obj.docTitle) || undefined,
      blockId: blockId || undefined,
    });
  }
  return out;
}

export function readMediaCandidatesFromArgs(
  args: Record<string, unknown>,
): MediaTranscribeCandidate[] {
  return parseMediaCandidatesFromArg(args.__media_candidates);
}

function candidateArgFromCandidate(
  candidate: MediaTranscribeCandidate,
): Record<string, string> {
  return {
    candidate_key: candidate.candidateKey,
    asset_id: candidate.assetId,
    source: candidate.source,
    media_kind: candidate.mediaKind,
    label: candidate.label,
    ...(candidate.filename ? { filename: candidate.filename } : {}),
    ...(candidate.mimeType ? { mime_type: candidate.mimeType } : {}),
    ...(candidate.docId ? { doc_id: candidate.docId } : {}),
    ...(candidate.docTitle ? { doc_title: candidate.docTitle } : {}),
    ...(candidate.blockId ? { block_id: candidate.blockId } : {}),
  };
}

export function writeMediaCandidatesToArgs(
  args: Record<string, unknown>,
  candidates: MediaTranscribeCandidate[],
): Record<string, unknown> {
  if (candidates.length === 0) {
    if ("__media_candidates" in args) {
      const next = { ...args };
      delete next.__media_candidates;
      return next;
    }
    return args;
  }

  return {
    ...args,
    __media_candidates: candidates.map(candidateArgFromCandidate),
  };
}

export function resolveCandidateKeys(
  args: Record<string, unknown>,
  value: unknown,
): string[] {
  const keys = normalizeStringList(value);
  if (keys.length === 0) return [];

  const lookup = new Map(
    readMediaCandidatesFromArgs(args).map((candidate) => [candidate.candidateKey, candidate]),
  );

  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const candidate = lookup.get(key);
    if (!candidate) continue;
    if (seen.has(candidate.assetId)) continue;
    seen.add(candidate.assetId);
    out.push(candidate.assetId);
  }
  return out;
}

export function resolveCandidateKey(
  args: Record<string, unknown>,
  value: unknown,
): string {
  const key = normalizeString(value);
  if (!key) return "";
  const lookup = new Map(
    readMediaCandidatesFromArgs(args).map((candidate) => [candidate.candidateKey, candidate]),
  );
  const candidate = lookup.get(key);
  return candidate ? candidate.assetId : "";
}

async function collectCandidatesFromAttachments(
  attachments: MediaAttachmentRef[] | undefined,
  acc: Map<string, MediaTranscribeCandidate>,
  maxCandidates: number,
  scope: MediaScope,
): Promise<void> {
  const list = Array.isArray(attachments) ? attachments : [];
  for (const attachment of list) {
    if (acc.size >= maxCandidates) return;

    const assetId = normalizeString(attachment.assetId);
    if (!assetId) continue;

    const filename = normalizeString(attachment.name);
    const mimeType = normalizeString(attachment.mimeType);
    const mediaKind = detectMediaKind(mimeType, filename, attachment.type);
    if (!mediaKind || !matchesScope(mediaKind, scope)) continue;

    const candidate: MediaTranscribeCandidate = {
      candidateKey: buildCandidateKey({ source: "attachment", assetId }),
      assetId,
      source: "attachment",
      mediaKind,
      label: toCandidateLabel([
        filename || assetId,
        mimeType || undefined,
        "聊天附件",
      ]),
      ...(filename ? { filename } : {}),
      ...(mimeType ? { mimeType } : {}),
    };

    acc.set(assetId, normalizeCandidate(candidate, acc.get(assetId)));
  }
}

async function collectCandidatesFromSnapshot(
  userId: string,
  projectKey: string,
  snapshot: DocumentInspectSnapshot,
  explicitBlockId: string,
  acc: Map<string, MediaTranscribeCandidate>,
  maxCandidates: number,
  scope: MediaScope,
): Promise<void> {
  if (acc.size >= maxCandidates) return;

  const expectedBlockId = normalizeString(explicitBlockId);
  const docId = normalizeString(snapshot.docId);
  const docTitle = normalizeString(snapshot.title);

  for (const block of snapshot.blocks || []) {
    if (acc.size >= maxCandidates) return;
    if (normalizeString(block.type) !== "file_block") continue;

    const attrs = block.attrs || {};
    const blockId = normalizeString(block.id || attrs.id);
    if (expectedBlockId && blockId !== expectedBlockId) continue;

    const assetId = normalizeString(attrs.asset_id);
    if (!assetId) continue;

    let filename = normalizeString(attrs.file_name);
    let mimeType = normalizeString(attrs.mime);
    let mediaKind = detectMediaKind(mimeType, filename, attrs.file_type);

    if (!mediaKind) {
      const meta = await assetStore.getMeta(userId, projectKey, assetId);
      if (meta) {
        filename = filename || normalizeString(meta.filename);
        mimeType = mimeType || normalizeString(meta.mime);
        mediaKind = detectMediaKind(mimeType, filename);
      }
    }

    if (!mediaKind || !matchesScope(mediaKind, scope)) continue;

    const candidate: MediaTranscribeCandidate = {
      candidateKey: buildCandidateKey({
        source: "document",
        assetId,
        ...(docId ? { docId } : {}),
        ...(blockId ? { blockId } : {}),
      }),
      assetId,
      source: "document",
      mediaKind,
      label: toCandidateLabel([
        filename || assetId,
        mimeType || undefined,
        docTitle || docId,
        blockId ? `block:${blockId}` : undefined,
      ]),
      ...(filename ? { filename } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(docId ? { docId } : {}),
      ...(docTitle ? { docTitle } : {}),
      ...(blockId ? { blockId } : {}),
    };

    acc.set(assetId, normalizeCandidate(candidate, acc.get(assetId)));
  }
}

export async function resolveMediaTranscribeCandidates(
  input: ResolveMediaCandidatesInput,
): Promise<MediaTranscribeCandidate[]> {
  const maxDocs = Number.isFinite(input.maxDocs) && (input.maxDocs || 0) > 0
    ? Math.trunc(input.maxDocs || DEFAULT_MAX_DOCS)
    : DEFAULT_MAX_DOCS;
  const maxCandidates = Number.isFinite(input.maxCandidates) && (input.maxCandidates || 0) > 0
    ? Math.trunc(input.maxCandidates || DEFAULT_MAX_CANDIDATES)
    : DEFAULT_MAX_CANDIDATES;
  const scope = normalizeMediaScope(input.mediaScope);

  const candidates = new Map<string, MediaTranscribeCandidate>();
  await collectCandidatesFromAttachments(input.attachments, candidates, maxCandidates, scope);

  const explicitDocId = normalizeString(input.explicitDocId);
  const explicitBlockId = normalizeString(input.explicitBlockId);
  const docQueue = explicitDocId
    ? [explicitDocId]
    : Array.from(
        new Set(
          (Array.isArray(input.docIds) ? input.docIds : [])
            .map((docId) => normalizeString(docId))
            .filter(Boolean),
        ),
      );

  const snapshotMap = new Map<string, DocumentInspectSnapshot>();
  for (const snapshot of Array.isArray(input.documentSnapshots) ? input.documentSnapshots : []) {
    const docId = normalizeString(snapshot.docId);
    if (!docId) continue;
    snapshotMap.set(docId, snapshot);
  }

  for (const docId of docQueue.slice(0, maxDocs)) {
    if (candidates.size >= maxCandidates) break;

    const snapshot = snapshotMap.get(docId)
      || await inspectDocumentSnapshot({
        userId: input.userId,
        projectKey: input.projectKey,
        docId,
        includeContent: false,
        includeBlockAttrs: true,
        blockTypes: ["file_block"],
      }).catch(() => null);

    if (!snapshot) continue;
    await collectCandidatesFromSnapshot(
      input.userId,
      input.projectKey,
      snapshot,
      explicitBlockId,
      candidates,
      maxCandidates,
      scope,
    );
  }

  return Array.from(candidates.values());
}

export function buildMediaCandidateDescription(
  candidates: MediaTranscribeCandidate[],
  maxLines = 12,
): string {
  if (candidates.length === 0) {
    return "未找到可转写的音视频候选。";
  }

  const lines = candidates
    .slice(0, Math.max(1, maxLines))
    .map((candidate, index) => `${index + 1}. [${candidate.candidateKey}] ${candidate.label}`);

  if (candidates.length > lines.length) {
    lines.push(`... 其余 ${candidates.length - lines.length} 个候选未展开`);
  }

  return lines.join("\n");
}

export function normalizeAssetIdList(value: unknown): string[] {
  return normalizeStringList(value);
}
