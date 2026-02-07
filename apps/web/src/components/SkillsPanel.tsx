/**
 * Skills Panel
 *
 * Settings panel for managing project-scoped AI skill configurations.
 */

import { useState, useEffect, useCallback } from "react";
import { Switch, Spin, message, Collapse, Tooltip } from "antd";
import { QuestionCircleOutlined, LockOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  listProjectSkills,
  updateProjectSkillEnabled,
  batchUpdateProjectSkillEnabled,
  type ProjectSkillCategoryInfo,
} from "../api/skills";
import { getChatSettings, updateChatSettings } from "../api/chat-settings";
import { useProjectContext } from "../context/ProjectContext";

function SkillsPanel() {
  const { currentProject } = useProjectContext();
  const projectKey = currentProject?.key ?? "";

  const [categories, setCategories] = useState<ProjectSkillCategoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updatingCategory, setUpdatingCategory] = useState<string | null>(null);

  // FullAccess global toggle
  const [fullAccess, setFullAccess] = useState(false);
  const [fullAccessLoading, setFullAccessLoading] = useState(false);

  // Load global chat settings
  useEffect(() => {
    getChatSettings()
      .then((s) => setFullAccess(s.fullAccess))
      .catch(() => { /* ignore, defaults to false */ });
  }, []);

  const handleFullAccessToggle = async (checked: boolean) => {
    try {
      setFullAccessLoading(true);
      const updated = await updateChatSettings({ fullAccess: checked });
      setFullAccess(updated.fullAccess);
      message.success(checked ? "全权模式已开启" : "全权模式已关闭");
    } catch {
      message.error("更新全权模式失败");
    } finally {
      setFullAccessLoading(false);
    }
  };

  const loadSkills = useCallback(async () => {
    if (!projectKey) {
      setCategories([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await listProjectSkills(projectKey);
      setCategories(data.categories);
    } catch (err) {
      console.error("Failed to load project skills:", err);
      message.error("加载项目技能配置失败");
    } finally {
      setLoading(false);
    }
  }, [projectKey]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = async (skillId: string, enabled: boolean) => {
    if (!projectKey) return;
    try {
      setUpdating(skillId);
      await updateProjectSkillEnabled(projectKey, skillId, enabled);
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          skills: cat.skills.map((skill) =>
            skill.id === skillId
              ? { ...skill, enabled }
              : skill,
          ),
        })),
      );
      message.success(enabled ? "技能已启用" : "技能已禁用");
    } catch (err) {
      console.error("Failed to update project skill:", err);
      message.error("更新技能状态失败");
    } finally {
      setUpdating(null);
    }
  };

  const handleCategoryToggle = async (categoryId: string, enabled: boolean) => {
    if (!projectKey) return;
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const configurableSkills = category.skills.filter((s) => s.isConfigurable);
    if (configurableSkills.length === 0) {
      message.info("该分类下没有可配置的技能");
      return;
    }

    const updates = configurableSkills.map((skill) => ({
      skillId: skill.id,
      enabled,
    }));

    try {
      setUpdatingCategory(categoryId);
      await batchUpdateProjectSkillEnabled(projectKey, updates);
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? {
              ...cat,
              skills: cat.skills.map((skill) =>
                skill.isConfigurable
                  ? { ...skill, enabled }
                  : skill,
              ),
            }
            : cat,
        ),
      );
      message.success(
        enabled
          ? `${category.name}类可配置技能已全部启用`
          : `${category.name}类可配置技能已全部禁用`,
      );
    } catch (err) {
      console.error("Failed to update category:", err);
      message.error("更新分类状态失败");
    } finally {
      setUpdatingCategory(null);
    }
  };

  if (loading) {
    return (
      <div className="skills-panel-loading">
        <Spin />
      </div>
    );
  }

  if (!projectKey) {
    return (
      <div className="skills-panel">
        <div className="skills-panel-header">
          <h3>AI 技能</h3>
          <p className="skills-panel-description">技能配置按项目隔离，请先选择项目。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="skills-panel">
      <div className="skills-panel-header">
        <h3>AI 技能</h3>
        <p className="skills-panel-description">
          当前项目：{currentProject?.name || projectKey}。禁用的技能不会在对话中被触发，也不会出现在 / 命令列表。
        </p>
      </div>

      {/* FullAccess global toggle */}
      <div className="skills-full-access">
        <div className="skills-full-access-info">
          <ThunderboltOutlined className="skills-full-access-icon" />
          <div>
            <div className="skills-full-access-title">全权模式 (Full Access)</div>
            <div className="skills-full-access-desc">开启后 AI 执行文档操作无需人工确认</div>
          </div>
        </div>
        <Switch
          checked={fullAccess}
          loading={fullAccessLoading}
          onChange={handleFullAccessToggle}
        />
      </div>

      {categories.length === 0 ? (
        <div className="skills-panel-empty">
          <p>暂无可用技能</p>
        </div>
      ) : (
        <Collapse
          defaultActiveKey={categories.map((c) => c.id)}
          ghost
          className="skills-collapse"
        >
          {categories.map((category) => {
            const configurableSkills = category.skills.filter((s) => s.isConfigurable);
            const requiredSkills = category.skills.filter((s) => !s.isConfigurable);
            const enabledConfigurable = configurableSkills.filter((s) => s.enabled).length;
            const allConfigurableEnabled = configurableSkills.length === 0 || enabledConfigurable === configurableSkills.length;
            const someConfigurableEnabled = enabledConfigurable > 0 && enabledConfigurable < configurableSkills.length;
            const hasConfigurable = configurableSkills.length > 0;
            return (
              <Collapse.Panel
                key={category.id}
                header={
                  <div className="skills-category-header">
                    <span className="skills-category-icon">{category.icon}</span>
                    <span className="skills-category-name">{category.name}</span>
                    <span className="skills-category-count">
                      {requiredSkills.length > 0 && (
                        <span className="skills-required-badge">
                          {requiredSkills.length} 必需
                        </span>
                      )}
                      {hasConfigurable && (
                        <span>{enabledConfigurable}/{configurableSkills.length} 可选已启用</span>
                      )}
                    </span>
                    {hasConfigurable && (
                      <div
                        className="skills-category-switch"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch
                          checked={allConfigurableEnabled}
                          loading={updatingCategory === category.id}
                          onChange={(checked) => handleCategoryToggle(category.id, checked)}
                          size="small"
                          className={someConfigurableEnabled ? "switch-indeterminate" : ""}
                        />
                      </div>
                    )}
                  </div>
                }
              >
                <div className="skills-list">
                  {category.skills.map((skill) => (
                    <div key={skill.id} className={`skill-item ${!skill.isConfigurable ? "skill-item-required" : ""}`}>
                      <div className="skill-info">
                        <span className="skill-command">{skill.command || skill.name}</span>
                        <Tooltip title={skill.description}>
                          <QuestionCircleOutlined className="skill-help-icon" />
                        </Tooltip>
                        {!skill.isConfigurable && (
                          <Tooltip title="系统必需技能，无法禁用">
                            <LockOutlined className="skill-required-icon" />
                          </Tooltip>
                        )}
                      </div>
                      <Tooltip title={!skill.isConfigurable ? "系统必需技能，无法禁用" : undefined}>
                        <Switch
                          checked={skill.enabled}
                          loading={updating === skill.id}
                          onChange={(checked) => handleToggle(skill.id, checked)}
                          size="small"
                          disabled={!skill.isConfigurable}
                        />
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </Collapse.Panel>
            );
          })}
        </Collapse>
      )}
    </div>
  );
}

export default SkillsPanel;
