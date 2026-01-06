import { useEffect, useState } from "react";

import { type Project, useProjectContext } from "../context/ProjectContext";
import CreateProjectModal from "./CreateProjectModal";

const mockProjects: Project[] = [
  { id: "project-atlas", key: "atlas", name: "Atlas" },
  { id: "project-apollo", key: "apollo", name: "Apollo" },
  { id: "project-orbit", key: "orbit", name: "Orbit" },
];

function ProjectSelector() {
  const [open, setOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const { projects, currentProject, setCurrentProject, reloadProjects } = useProjectContext();

  useEffect(() => {
    if (currentProject) {
      console.log("project_key:", currentProject.key);
    }
  }, [currentProject]);

  const availableProjects = projects.length > 0 ? projects : mockProjects;
  const activeProject = currentProject ?? availableProjects[0] ?? null;

  const toggleOpen = () => setOpen((prev) => !prev);

  const handleSelect = (project: Project) => {
    setCurrentProject(project.key);
    setOpen(false);
  };

  const handleAddProject = () => {
    setOpen(false);
    setShowModal(true);
  };

  return (
    <div className="project-selector">
      <div className="sidebar-title">Project</div>
      <button
        className="project-selector-button"
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className="project-selector-label">
          {activeProject ? activeProject.name : "Select a project"}
        </span>
        <span className="project-selector-caret">{open ? "v" : ">"}</span>
      </button>
      {open ? (
        <div className="project-selector-menu">
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
