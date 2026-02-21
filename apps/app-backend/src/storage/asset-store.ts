import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import { getScopedAssetsRoot } from "./paths.js";

export type AssetMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
};

type MediaStreamInfo = {
  codec_name?: string;
  codec_type?: string;
};

type MediaProbeResult = {
  streams?: MediaStreamInfo[];
};

type MediaProfile = {
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
};

const SUPPORTED_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const SUPPORTED_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
    });
  });
}

async function probeMediaProfile(filePath: string): Promise<MediaProfile | null> {
  try {
    const { stdout } = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_type",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as MediaProbeResult;
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    let hasVideo = false;
    let hasAudio = false;
    let videoCodec = "";
    let audioCodec = "";

    for (const stream of streams) {
      const codecType = String(stream?.codec_type ?? "").trim().toLowerCase();
      const codecName = String(stream?.codec_name ?? "").trim().toLowerCase();
      if (codecType === "video" && !hasVideo) {
        hasVideo = true;
        videoCodec = codecName;
      }
      if (codecType === "audio" && !hasAudio) {
        hasAudio = true;
        audioCodec = codecName;
      }
    }

    return { hasVideo, hasAudio, videoCodec, audioCodec };
  } catch {
    return null;
  }
}

function isMp4LikeAsset(filename: string, mime: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const normalizedMime = String(mime ?? "").trim().toLowerCase();
  return ext === ".mp4" || normalizedMime === "video/mp4" || normalizedMime === "audio/mp4";
}

async function transcodeMp4ForPlayback(
  inputPath: string,
  profile: MediaProfile,
): Promise<{ mime: string; size: number } | null> {
  const outputPath = `${inputPath}.transcoding.mp4`;
  const args = profile.hasVideo
    ? [
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        outputPath,
      ]
    : [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        outputPath,
      ];

  try {
    await runCommand("ffmpeg", args);
    await fs.rename(outputPath, inputPath);
    const stat = await fs.stat(inputPath);
    return {
      mime: profile.hasVideo ? "video/mp4" : "audio/mp4",
      size: stat.size,
    };
  } catch {
    try {
      await fs.unlink(outputPath);
    } catch {
      // ignore cleanup error
    }
    return null;
  }
}

async function normalizeMediaForPlayback(filePath: string, meta: AssetMeta): Promise<AssetMeta> {
  if (!isMp4LikeAsset(meta.filename, meta.mime)) {
    return meta;
  }

  const profile = await probeMediaProfile(filePath);
  if (!profile || (!profile.hasAudio && !profile.hasVideo)) {
    return meta;
  }

  const nextMeta: AssetMeta = { ...meta };
  if (profile.hasVideo) {
    nextMeta.mime = "video/mp4";
  } else if (profile.hasAudio) {
    // MP4 with audio-only stream should be treated as audio for rendering.
    nextMeta.mime = "audio/mp4";
  }
  const videoCodecSupported = profile.hasVideo
    ? SUPPORTED_VIDEO_CODECS.has(profile.videoCodec)
    : false;
  const audioCodecSupported = profile.hasAudio
    ? SUPPORTED_AUDIO_CODECS.has(profile.audioCodec)
    : false;

  const needTranscode =
    (profile.hasVideo && (!videoCodecSupported || (profile.hasAudio && !audioCodecSupported))) ||
    (!profile.hasVideo && profile.hasAudio && !audioCodecSupported);

  if (!needTranscode) {
    return nextMeta;
  }

  const transcoded = await transcodeMp4ForPlayback(filePath, profile);
  if (!transcoded) {
    return nextMeta;
  }

  return {
    ...nextMeta,
    mime: transcoded.mime,
    size: transcoded.size,
  };
}

export class AssetStore {
  private getAssetDir(userId: string, projectKey: string): string {
    return getScopedAssetsRoot(userId, projectKey);
  }

  private getAssetPath(userId: string, projectKey: string, assetId: string, ext: string): string {
    return path.join(this.getAssetDir(userId, projectKey), `${assetId}${ext}`);
  }

  private getMetaPath(userId: string, projectKey: string, assetId: string): string {
    return path.join(this.getAssetDir(userId, projectKey), `${assetId}.meta.json`);
  }

  public async save(
    userId: string,
    projectKey: string,
    filename: string,
    mime: string,
    buffer: Buffer
  ): Promise<AssetMeta> {
    const assetDir = this.getAssetDir(userId, projectKey);
    await fs.mkdir(assetDir, { recursive: true });

    const assetId = uuidv4();
    const ext = path.extname(filename) || "";
    const assetPath = this.getAssetPath(userId, projectKey, assetId, ext);
    const metaPath = this.getMetaPath(userId, projectKey, assetId);

    const meta: AssetMeta = {
      id: assetId,
      filename,
      mime,
      size: buffer.length,
      created_at: new Date().toISOString(),
    };

    await fs.writeFile(assetPath, buffer);
    const normalizedMeta = await normalizeMediaForPlayback(assetPath, meta);
    if (normalizedMeta.mime !== meta.mime || normalizedMeta.size !== meta.size) {
      meta.mime = normalizedMeta.mime;
      meta.size = normalizedMeta.size;
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    return meta;
  }

  public async getMeta(userId: string, projectKey: string, assetId: string): Promise<AssetMeta | null> {
    const metaPath = this.getMetaPath(userId, projectKey, assetId);
    try {
      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content) as AssetMeta;
    } catch (e) {
      return null;
    }
  }

  public async getContent(userId: string, projectKey: string, assetId: string): Promise<{ buffer: Buffer; meta: AssetMeta } | null> {
    const meta = await this.getMeta(userId, projectKey, assetId);
    if (!meta) return null;

    const ext = path.extname(meta.filename) || "";
    const assetPath = this.getAssetPath(userId, projectKey, assetId, ext);
    
    try {
      const buffer = await fs.readFile(assetPath);
      return { buffer, meta };
    } catch (e) {
      return null;
    }
  }

  public async getContentFile(
    userId: string,
    projectKey: string,
    assetId: string,
  ): Promise<{ filePath: string; size: number; meta: AssetMeta } | null> {
    const meta = await this.getMeta(userId, projectKey, assetId);
    if (!meta) return null;

    const ext = path.extname(meta.filename) || "";
    const filePath = this.getAssetPath(userId, projectKey, assetId, ext);
    try {
      const normalizedMeta = await normalizeMediaForPlayback(filePath, meta);
      if (normalizedMeta.mime !== meta.mime || normalizedMeta.size !== meta.size) {
        const metaPath = this.getMetaPath(userId, projectKey, assetId);
        await fs.writeFile(metaPath, JSON.stringify(normalizedMeta, null, 2));
      }
      const stat = await fs.stat(filePath);
      return {
        filePath,
        size: stat.size,
        meta: normalizedMeta,
      };
    } catch {
      return null;
    }
  }

  public async delete(userId: string, projectKey: string, assetId: string): Promise<boolean> {
    const meta = await this.getMeta(userId, projectKey, assetId);
    if (!meta) return false;

    const ext = path.extname(meta.filename) || "";
    const assetPath = this.getAssetPath(userId, projectKey, assetId, ext);
    const metaPath = this.getMetaPath(userId, projectKey, assetId);

    try {
      await fs.unlink(assetPath);
      await fs.unlink(metaPath);
      return true;
    } catch (e) {
      return false;
    }
  }
}

export const assetStore = new AssetStore();
