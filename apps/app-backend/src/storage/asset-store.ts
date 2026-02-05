import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getAssetsRoot } from "./paths.js";

export type AssetMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
};

export class AssetStore {
  private getAssetDir(userId: string, projectKey: string): string {
    return getAssetsRoot(userId, "personal", projectKey);
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
