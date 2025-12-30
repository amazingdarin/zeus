import { useState } from "react";

import type { Project } from "../context/ProjectContext";
import { buildApiUrl } from "../config/api";

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
      const response = await fetch(buildApiUrl("/api/projects"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: keyValue,
          name,
          description,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.message || payload?.error || "Create project failed";
        throw new Error(message);
      }
      const data = payload?.data;
      const project: Project = {
        id: String(data?.id ?? ""),
        key: keyValue,
        name,
        description: description || undefined,
        status: "active",
        createdAt: data?.created_at ?? undefined,
      };
      if (!project.id) {
        throw new Error("Project id is missing");
      }
      onCreated?.(project);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create project failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Create Project</h2>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="modal-error">{error}</div> : null}
        <div className="modal-body">
          <label className="modal-field">
            <span>Key</span>
            <input
              type="text"
              value={keyValue}
              onChange={(event) => setKeyValue(event.target.value)}
              placeholder="project-key"
              disabled={loading}
            />
          </label>
          <label className="modal-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
              disabled={loading}
            />
          </label>
          <label className="modal-field">
            <span>Description</span>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional description"
              disabled={loading}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateProjectModal;
