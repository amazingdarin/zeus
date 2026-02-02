/**
 * Filesystem Skill Scanner
 *
 * 自动发现并加载 Anthropic Agent Skills 格式的技能
 *
 * 功能:
 * 1. 扫描指定目录中的技能
 * 2. 检测技能变更 (新增、删除、更新)
 * 3. 支持热重载
 */

import { readdir, access, stat } from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { UnifiedSkillDefinition, DiscoveryConfig } from "../adapters/types.js";
import { anthropicAdapter } from "../adapters/anthropic-adapter.js";

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DiscoveryConfig = {
  skillDirs: [
    "./data/skills", // 项目级技能
  ],
  watchEnabled: true,
  scanInterval: 30000, // 30 秒
};

/**
 * 扫描器事件类型
 */
export interface ScannerEvents {
  added: (skills: UnifiedSkillDefinition[]) => void;
  removed: (ids: string[]) => void;
  updated: (skills: UnifiedSkillDefinition[]) => void;
  error: (error: Error) => void;
  scanComplete: (skills: UnifiedSkillDefinition[]) => void;
}

/**
 * 技能缓存条目
 */
type CachedSkill = {
  skill: UnifiedSkillDefinition;
  mtime: number; // 文件修改时间
};

/**
 * 文件系统技能扫描器
 *
 * 事件:
 * - added: 新增技能
 * - removed: 删除技能
 * - updated: 更新技能
 * - error: 错误
 * - scanComplete: 扫描完成
 */
export class FilesystemSkillScanner extends EventEmitter {
  private config: DiscoveryConfig;
  private loadedSkills = new Map<string, CachedSkill>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private isScanning = false;

  constructor(config: Partial<DiscoveryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 添加用户目录 (如果 HOME 存在)
    if (process.env.HOME) {
      const userSkillDir = path.join(process.env.HOME, ".zeus", "skills");
      if (!this.config.skillDirs.includes(userSkillDir)) {
        this.config.skillDirs.push(userSkillDir);
      }
    }
  }

  /**
   * 启动扫描器
   */
  async start(): Promise<void> {
    // 初始扫描
    await this.scan();

    // 启动定期扫描
    if (this.config.watchEnabled && this.config.scanInterval > 0) {
      this.scanTimer = setInterval(() => {
        this.scan().catch((err) => {
          this.emit("error", err);
        });
      }, this.config.scanInterval);
    }
  }

  /**
   * 停止扫描器
   */
  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /**
   * 执行一次扫描
   */
  async scan(): Promise<UnifiedSkillDefinition[]> {
    if (this.isScanning) {
      return this.getLoadedSkills();
    }

    this.isScanning = true;

    try {
      const discovered: Array<{ skill: UnifiedSkillDefinition; mtime: number }> = [];

      for (const dir of this.config.skillDirs) {
        try {
          // 检查目录是否存在
          await access(dir);
          const skills = await this.scanDirectory(dir);
          discovered.push(...skills);
        } catch {
          // 目录不存在，跳过
        }
      }

      // 检测变更
      const added: UnifiedSkillDefinition[] = [];
      const removed: string[] = [];
      const updated: UnifiedSkillDefinition[] = [];

      const newIds = new Set(discovered.map((d) => d.skill.id));
      const oldIds = new Set(this.loadedSkills.keys());

      for (const { skill, mtime } of discovered) {
        const existing = this.loadedSkills.get(skill.id);
        if (!existing) {
          added.push(skill);
        } else if (mtime > existing.mtime) {
          updated.push(skill);
        }
      }

      for (const id of oldIds) {
        if (!newIds.has(id)) {
          removed.push(id);
        }
      }

      // 更新缓存
      for (const { skill, mtime } of discovered) {
        this.loadedSkills.set(skill.id, { skill, mtime });
      }
      for (const id of removed) {
        this.loadedSkills.delete(id);
      }

      // 发出事件
      if (added.length > 0) {
        this.emit("added", added);
      }
      if (removed.length > 0) {
        this.emit("removed", removed);
      }
      if (updated.length > 0) {
        this.emit("updated", updated);
      }

      const allSkills = this.getLoadedSkills();
      this.emit("scanComplete", allSkills);

      return allSkills;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 扫描单个目录
   */
  private async scanDirectory(
    dir: string,
  ): Promise<Array<{ skill: UnifiedSkillDefinition; mtime: number }>> {
    const skills: Array<{ skill: UnifiedSkillDefinition; mtime: number }> = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // 跳过隐藏目录
        if (entry.name.startsWith(".")) {
          continue;
        }

        if (entry.isDirectory()) {
          const skillDir = path.join(dir, entry.name);
          const skillMdPath = path.join(skillDir, "SKILL.md");

          try {
            // 检查 SKILL.md 是否存在
            const stats = await stat(skillMdPath);

            // 加载技能
            const skill = await anthropicAdapter.load(skillDir);
            skills.push({
              skill,
              mtime: stats.mtimeMs,
            });
          } catch (err) {
            // 不是有效的技能目录，跳过
            // 可以在这里记录日志
            if (process.env.DEBUG) {
              console.debug(`Skipping ${skillDir}: ${err}`);
            }
          }
        }
      }
    } catch {
      // 无法读取目录
    }

    return skills;
  }

  /**
   * 获取所有已加载的技能
   */
  getLoadedSkills(): UnifiedSkillDefinition[] {
    return Array.from(this.loadedSkills.values()).map((c) => c.skill);
  }

  /**
   * 获取技能数量
   */
  getSkillCount(): number {
    return this.loadedSkills.size;
  }

  /**
   * 检查技能是否存在
   */
  hasSkill(id: string): boolean {
    return this.loadedSkills.has(id);
  }

  /**
   * 获取指定技能
   */
  getSkill(id: string): UnifiedSkillDefinition | undefined {
    return this.loadedSkills.get(id)?.skill;
  }

  /**
   * 强制重新加载指定技能
   */
  async reloadSkill(id: string): Promise<UnifiedSkillDefinition | null> {
    const cached = this.loadedSkills.get(id);
    if (!cached || !cached.skill.sourcePath) {
      return null;
    }

    try {
      const skill = await anthropicAdapter.load(cached.skill.sourcePath);
      const stats = await stat(
        path.join(cached.skill.sourcePath, "SKILL.md"),
      );
      this.loadedSkills.set(id, { skill, mtime: stats.mtimeMs });
      this.emit("updated", [skill]);
      return skill;
    } catch {
      return null;
    }
  }

  /**
   * 添加技能目录
   */
  addSkillDir(dir: string): void {
    if (!this.config.skillDirs.includes(dir)) {
      this.config.skillDirs.push(dir);
    }
  }

  /**
   * 移除技能目录
   */
  removeSkillDir(dir: string): void {
    const index = this.config.skillDirs.indexOf(dir);
    if (index !== -1) {
      this.config.skillDirs.splice(index, 1);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): DiscoveryConfig {
    return { ...this.config };
  }
}

/**
 * 导出单例实例
 */
export const skillScanner = new FilesystemSkillScanner();
