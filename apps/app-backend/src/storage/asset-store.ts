import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

const REPO_ROOT = process.env.REPO_ROOT ?? path.join(process.cwd(), "data", "repos");

export type AssetMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
};

export class AssetStore {
  private getAssetDir(projectKey: string): string {
    return path.join(REPO_ROOT, projectKey, "assets");
  }

  private getAssetPath(projectKey: string, assetId: string, ext: string): string {
    return path.join(this.getAssetDir(projectKey), `${assetId}${ext}`);
  }

  private getMetaPath(projectKey: string, assetId: string): string {
    return path.join(this.getAssetDir(projectKey), `${assetId}.meta.json`);
  }

  public async save(
    projectKey: string,
    filename: string,
    mime: string,
    buffer: Buffer
  ): Promise<AssetMeta> {
    const assetDir = this.getAssetDir(projectKey);
    await fs.mkdir(assetDir, { recursive: true });

    const assetId = uuidv4();
    const ext = path.extname(filename) || "";
    const assetPath = this.getAssetPath(projectKey, assetId, ext);
    const metaPath = this.getMetaPath(projectKey, assetId);

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

  public async getMeta(projectKey: string, assetId: string): Promise<AssetMeta | null> {
    const metaPath = this.getMetaPath(projectKey, assetId);
    try {
      const content = await fs.readFile(metaPath, "utf-8");
      return JSON.parse(content) as AssetMeta;
    } catch (e) {
      return null;
    }
  }

  public async getContent(projectKey: string, assetId: string): Promise<{ buffer: Buffer; meta: AssetMeta } | null> {
    const meta = await this.getMeta(projectKey, assetId);
    if (!meta) return null;

    const ext = path.extname(meta.filename) || "";
    const assetPath = this.getAssetPath(projectKey, assetId, ext);
    
    try {
      const buffer = await fs.readFile(assetPath);
      return { buffer, meta };
    } catch (e) {
      return null;
    }
  }

  public async delete(projectKey: string, assetId: string): Promise<boolean> {
    const meta = await this.getMeta(projectKey, assetId);
    if (!meta) return false;

    const ext = path.extname(meta.filename) || "";
    const assetPath = this.getAssetPath(projectKey, assetId, ext);
    const metaPath = this.getMetaPath(projectKey, assetId);

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
