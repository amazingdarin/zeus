/**
 * Skills Panel
 *
 * Settings panel for managing AI skill configurations.
 */

import { useState, useEffect, useCallback } from "react";
import { Switch, Spin, message, Collapse, Tooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import {
  listSkills,
  updateSkillEnabled,
  batchUpdateSkillEnabled,
  type SkillCategoryInfo,
} from "../api/skills";

function SkillsPanel() {
  const [categories, setCategories] = useState<SkillCategoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [updatingCategory, setUpdatingCategory] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listSkills();
      setCategories(data.categories);
    } catch (err) {
      console.error("Failed to load skills:", err);
      message.error("加载技能配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = async (skillName: string, enabled: boolean) => {
    try {
      setUpdating(skillName);
      await updateSkillEnabled(skillName, enabled);
      // Update local state
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          skills: cat.skills.map((skill) =>
            skill.name === skillName
              ? { ...skill, config: { ...skill.config, enabled } }
              : skill,
          ),
        })),
      );
      message.success(enabled ? "技能已启用" : "技能已禁用");
    } catch (err) {
      console.error("Failed to update skill:", err);
      message.error("更新技能状态失败");
    } finally {
      setUpdating(null);
    }
  };

  const handleCategoryToggle = async (categoryId: string, enabled: boolean) => {
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return;

    const updates = category.skills.map((skill) => ({
      skillName: skill.name,
      enabled,
    }));

    try {
      setUpdatingCategory(categoryId);
      await batchUpdateSkillEnabled(updates);
      // Update local state
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? {
                ...cat,
                skills: cat.skills.map((skill) => ({
                  ...skill,
                  config: { ...skill.config, enabled },
                })),
              }
            : cat,
        ),
      );
      message.success(enabled ? `${category.name}类技能已全部启用` : `${category.name}类技能已全部禁用`);
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

  return (
    <div className="skills-panel">
      <div className="skills-panel-header">
        <h3>AI 技能</h3>
        <p className="skills-panel-description">
          配置 AI 助手可以使用的技能。禁用的技能将不会在对话中生效，也不会加载到 AI 上下文中。
        </p>
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
            const enabledCount = category.skills.filter(
              (s) => s.config.enabled,
            ).length;
            const allEnabled = enabledCount === category.skills.length;
            const someEnabled = enabledCount > 0 && enabledCount < category.skills.length;
            return (
              <Collapse.Panel
                key={category.id}
                header={
                  <div className="skills-category-header">
                    <span className="skills-category-icon">{category.icon}</span>
                    <span className="skills-category-name">{category.name}</span>
                    <span className="skills-category-count">
                      {enabledCount}/{category.skills.length} 已启用
                    </span>
                    <div
                      className="skills-category-switch"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Switch
                        checked={allEnabled}
                        loading={updatingCategory === category.id}
                        onChange={(checked) => handleCategoryToggle(category.id, checked)}
                        size="small"
                        className={someEnabled ? "switch-indeterminate" : ""}
                      />
                    </div>
                  </div>
                }
              >
                <div className="skills-list">
                  {category.skills.map((skill) => (
                    <div key={skill.name} className="skill-item">
                      <div className="skill-info">
                        <span className="skill-command">{skill.command}</span>
                        <Tooltip title={skill.description}>
                          <QuestionCircleOutlined className="skill-help-icon" />
                        </Tooltip>
                      </div>
                      <Switch
                        checked={skill.config.enabled}
                        loading={updating === skill.name}
                        onChange={(checked) => handleToggle(skill.name, checked)}
                        size="small"
                      />
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
