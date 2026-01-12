import { useEffect, useState } from "react";
import { DownOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";

import { type Project, useProjectContext } from "../context/ProjectContext";
import CreateProjectModal from "./CreateProjectModal";
import { apiFetch } from "../config/api";

const mockProjects: Project[] = [
  { id: "project-atlas", key: "atlas", name: "Atlas" },
  { id: "project-apollo", key: "apollo", name: "Apollo" },
  { id: "project-orbit", key: "orbit", name: "Orbit" },
];

type ProjectSelectorProps = {
  collapsed?: boolean;
};

function ProjectSelector({ collapsed = false }: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const { projects, currentProject, setCurrentProject, reloadProjects } = useProjectContext();

  useEffect(() => {
    if (currentProject) {
      console.log("project_key:", currentProject.key);
    }
  }, [currentProject]);

  const availableProjects = projects.length > 0 ? projects : mockProjects;
  const activeProject = currentProject ?? availableProjects[0] ?? null;

  const toggleOpen = () => setOpen((prev) => !prev);
  const projectInitial = (activeProject?.name || "P").trim().charAt(0).toUpperCase();

  const handleSelect = (project: Project) => {
    setCurrentProject(project.key);
    setOpen(false);
  };

  const handleAddProject = () => {
    setOpen(false);
    setShowModal(true);
  };

  const requestRebuildProject = async (withSummary: boolean) => {
    if (!activeProject || rebuilding) {
      return;
    }
    setRebuilding(true);
    try {
      const query = withSummary ? "?with_summary=true" : "";
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(activeProject.key)}/rag/rebuild${query}`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error("rebuild failed");
      }
      console.log("rag_project_rebuild_done", {
        projectKey: activeProject.key,
        withSummary,
      });
    } catch (err) {
      console.log("rag_project_rebuild_error", err);
    } finally {
      setRebuilding(false);
    }
  };

  const handleRebuildProject = () => {
    if (!activeProject || rebuilding) {
      return;
    }
    setOpen(false);
    setRebuildModalOpen(true);
  };

  const handleRebuildChoice = (withSummary: boolean) => {
    setRebuildModalOpen(false);
    requestRebuildProject(withSummary);
  };

  return (
    <div className={`project-selector${collapsed ? " compact" : ""}`}>
      <div className={`sidebar-title-wrap project-title-wrap${collapsed ? " compact" : ""}`}>
        <div className="project-title-row">
          <div className={`sidebar-title${collapsed ? " compact" : ""}`}>Project</div>
          {!collapsed ? (
            <button
              className="project-rebuild-button"
              type="button"
              aria-label="Rebuild project knowledge"
              onClick={handleRebuildProject}
              disabled={!activeProject || rebuilding}
            >
              <ReloadOutlined />
            </button>
          ) : null}
        </div>
        {collapsed ? <div className="sidebar-divider" aria-hidden="true" /> : null}
      </div>
      <button
        className={`project-selector-button${collapsed ? " compact" : ""}`}
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {collapsed ? (
          <span className="project-selector-icon" aria-label="Project">
            {projectInitial}
          </span>
        ) : (
          <>
            <span className="project-selector-label">
              {activeProject ? activeProject.name : "Select a project"}
            </span>
            <span className="project-selector-caret">
              {open ? <DownOutlined /> : <RightOutlined />}
            </span>
          </>
        )}
      </button>
      {open ? (
        <div className={`project-selector-menu${collapsed ? " compact" : ""}`}>
          <button
            className="project-selector-item project-selector-add"
            type="button"
            onClick={handleAddProject}
          >
            Add a new project
          </button>
          <div className="project-selector-divider" />
          {availableProjects.map((project) => (
            <button
              key={project.id}
              className={`project-selector-item${
                activeProject && project.key === activeProject.key ? " active" : ""
              }`}
              type="button"
              onClick={() => handleSelect(project)}
            >
              {project.name}
            </button>
          ))}
        </div>
      ) : null}
      {rebuildModalOpen ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setRebuildModalOpen(false)}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Rebuild project knowledge</h2>
              <button
                className="modal-close"
                type="button"
                onClick={() => setRebuildModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="modal-body">
              Generate document summaries as well?
            </div>
            <div className="modal-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => setRebuildModalOpen(false)}
                disabled={rebuilding}
              >
                Cancel
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => handleRebuildChoice(false)}
                disabled={rebuilding}
              >
                Rebuild only
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => handleRebuildChoice(true)}
                disabled={rebuilding}
              >
                Rebuild + Summary
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showModal ? (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onCreated={async (project) => {
            setCurrentProject(project.key);
            await reloadProjects();
            setCurrentProject(project.key);
          }}
        />
      ) : null}
    </div>
  );
}

export default ProjectSelector;
