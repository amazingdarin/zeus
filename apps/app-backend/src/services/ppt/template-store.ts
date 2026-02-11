/**
 * PPT Template Store
 *
 * Manages custom PPT style templates uploaded by users.
 * Templates are stored in the database and can be used to guide PPT generation.
 */

import { query } from "../../db/postgres.js";
import { resolveProjectScope } from "../../project-scope.js";
import type { StyleTemplate, PresetTemplate } from "./types.js";

/**
 * Database row for custom template
 */
interface TemplateRow {
  id: string;
  owner_type: string;
  owner_id: string;
  project_key: string;
  name: string;
  description: string | null;
  preview_url: string | null;
  template_images: string[];
  color_primary: string | null;
  color_secondary: string | null;
  color_background: string | null;
  color_text: string | null;
  color_accent: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input for creating a custom template
 */
export interface CreateTemplateInput {
  name: string;
  description?: string;
  previewUrl?: string;
  templateImages?: string[];
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
  };
}

/**
 * Convert database row to StyleTemplate
 */
function rowToTemplate(row: TemplateRow): StyleTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    previewUrl: row.preview_url || undefined,
    templateImages: row.template_images || [],
    colorScheme:
      row.color_primary || row.color_secondary || row.color_background || row.color_text
        ? {
            primary: row.color_primary || "#000000",
            secondary: row.color_secondary || "#666666",
            background: row.color_background || "#ffffff",
            text: row.color_text || "#000000",
            accent: row.color_accent || undefined,
          }
        : undefined,
  };
}

/**
 * PPT Template Store
 */
export const templateStore = {
  /**
   * Initialize the templates table
   */
  async initialize(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS ppt_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_type TEXT NOT NULL DEFAULT 'personal',
        owner_id TEXT NOT NULL DEFAULT '',
        project_key VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        preview_url TEXT,
        template_images TEXT[] DEFAULT '{}',
        color_primary VARCHAR(7),
        color_secondary VARCHAR(7),
        color_background VARCHAR(7),
        color_text VARCHAR(7),
        color_accent VARCHAR(7),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(owner_type, owner_id, project_key, name)
      )
    `);

    await query(`ALTER TABLE ppt_templates ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal'`);
    await query(`ALTER TABLE ppt_templates ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT ''`);

    await query(`
      UPDATE ppt_templates
         SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
             owner_id = split_part(project_key, '::', 2)
       WHERE owner_id = '' AND project_key LIKE '%::%::%'
    `);

    await query(`
      UPDATE ppt_templates t
         SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
             owner_id = p.owner_id
        FROM project p
       WHERE t.owner_id = '' AND t.project_key = p.key
    `);

    await query(`
      UPDATE ppt_templates
         SET project_key = split_part(project_key, '::', 3)
       WHERE project_key LIKE '%::%::%'
    `);

    await query(`ALTER TABLE ppt_templates DROP CONSTRAINT IF EXISTS ppt_templates_project_key_name_key`);
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ppt_templates_owner_project_name
      ON ppt_templates (owner_type, owner_id, project_key, name)
    `);
  },

  /**
   * Create a custom template
   */
  async create(projectKey: string, input: CreateTemplateInput): Promise<StyleTemplate> {
    const scope = resolveProjectScope("", projectKey);

    const result = await query<TemplateRow>(
      `INSERT INTO ppt_templates (
        owner_type, owner_id, project_key, name, description, preview_url, template_images,
        color_primary, color_secondary, color_background, color_text, color_accent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        scope.ownerType,
        scope.ownerId,
        scope.projectKey,
        input.name,
        input.description || null,
        input.previewUrl || null,
        input.templateImages || [],
        input.colorScheme?.primary || null,
        input.colorScheme?.secondary || null,
        input.colorScheme?.background || null,
        input.colorScheme?.text || null,
        input.colorScheme?.accent || null,
      ],
    );

    return rowToTemplate(result.rows[0]);
  },

  /**
   * Get a template by ID
   */
  async get(projectKey: string, templateId: string): Promise<StyleTemplate | null> {
    const scope = resolveProjectScope("", projectKey);

    const result = await query<TemplateRow>(
      `SELECT * FROM ppt_templates
       WHERE id = $1 AND owner_type = $2 AND owner_id = $3 AND project_key = $4`,
      [templateId, scope.ownerType, scope.ownerId, scope.projectKey],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToTemplate(result.rows[0]);
  },

  /**
   * List all custom templates for a project
   */
  async list(projectKey: string): Promise<StyleTemplate[]> {
    const scope = resolveProjectScope("", projectKey);

    const result = await query<TemplateRow>(
      `SELECT * FROM ppt_templates
       WHERE owner_type = $1 AND owner_id = $2 AND project_key = $3
       ORDER BY name ASC`,
      [scope.ownerType, scope.ownerId, scope.projectKey],
    );

    return result.rows.map(rowToTemplate);
  },

  /**
   * Update a custom template
   */
  async update(
    projectKey: string,
    templateId: string,
    input: Partial<CreateTemplateInput>,
  ): Promise<StyleTemplate | null> {
    const scope = resolveProjectScope("", projectKey);

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.previewUrl !== undefined) {
      updates.push(`preview_url = $${paramIndex++}`);
      values.push(input.previewUrl);
    }
    if (input.templateImages !== undefined) {
      updates.push(`template_images = $${paramIndex++}`);
      values.push(input.templateImages);
    }
    if (input.colorScheme?.primary !== undefined) {
      updates.push(`color_primary = $${paramIndex++}`);
      values.push(input.colorScheme.primary);
    }
    if (input.colorScheme?.secondary !== undefined) {
      updates.push(`color_secondary = $${paramIndex++}`);
      values.push(input.colorScheme.secondary);
    }
    if (input.colorScheme?.background !== undefined) {
      updates.push(`color_background = $${paramIndex++}`);
      values.push(input.colorScheme.background);
    }
    if (input.colorScheme?.text !== undefined) {
      updates.push(`color_text = $${paramIndex++}`);
      values.push(input.colorScheme.text);
    }
    if (input.colorScheme?.accent !== undefined) {
      updates.push(`color_accent = $${paramIndex++}`);
      values.push(input.colorScheme.accent);
    }

    if (updates.length === 0) {
      return this.get(scope.scopedProjectKey, templateId);
    }

    updates.push(`updated_at = NOW()`);
    values.push(templateId, scope.ownerType, scope.ownerId, scope.projectKey);

    const result = await query<TemplateRow>(
      `UPDATE ppt_templates SET ${updates.join(", ")}
       WHERE id = $${paramIndex++}
         AND owner_type = $${paramIndex++}
         AND owner_id = $${paramIndex++}
         AND project_key = $${paramIndex}
       RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToTemplate(result.rows[0]);
  },

  /**
   * Delete a custom template
   */
  async delete(projectKey: string, templateId: string): Promise<boolean> {
    const scope = resolveProjectScope("", projectKey);

    const result = await query(
      `DELETE FROM ppt_templates
       WHERE id = $1 AND owner_type = $2 AND owner_id = $3 AND project_key = $4`,
      [templateId, scope.ownerType, scope.ownerId, scope.projectKey],
    );

    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Get all templates (preset + custom) for a project
   */
  async getAllTemplates(projectKey: string): Promise<{
    presets: PresetTemplate[];
    custom: StyleTemplate[];
  }> {
    // Import at runtime to avoid circular dependency
    const { PRESET_TEMPLATES } = await import("./types.js");
    const custom = await this.list(projectKey);

    return {
      presets: PRESET_TEMPLATES,
      custom,
    };
  },

  /**
   * Resolve a template ID to a StyleTemplate
   * Checks both presets and custom templates
   */
  async resolve(projectKey: string, templateId: string): Promise<StyleTemplate | null> {
    // First check presets
    const { PRESET_TEMPLATES } = await import("./types.js");
    const preset = PRESET_TEMPLATES.find((t) => t.id === templateId);
    if (preset) {
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
      };
    }

    // Then check custom templates
    return this.get(projectKey, templateId);
  },
};

export default templateStore;
