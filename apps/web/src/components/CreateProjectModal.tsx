import { useState } from "react";

import type { Project } from "../context/ProjectContext";
import { createProject } from "../api/projects";

type CreateProjectModalProps = {
  onClose: () => void;
  onCreated?: (project: Project) => void;
};

function CreateProjectModal({ onClose, onCreated }: CreateProjectModalProps) {
  const [keyValue, setKeyValue] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const project = await createProject({
        key: keyValue,
        name,
        description,
      });
      if (!project.id) {
        throw new Error("Project id is missing");
      }
      onCreated?.(project);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建项目失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>创建项目</h2>
          <button className="modal-close" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="modal-body">
          <label className="modal-field">
            <span>标识</span>
            <input
              type="text"
              value={keyValue}
              onChange={(event) => setKeyValue(event.target.value)}
              placeholder="project-key"
              disabled={loading}
            />
          </label>
          <label className="modal-field">
            <span>名称</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="项目名称"
              disabled={loading}
            />
          </label>
          <label className="modal-field">
            <span>描述</span>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选描述"
              disabled={loading}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="btn primary" type="button" onClick={handleCreate} disabled={loading}>
            {loading ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateProjectModal;
