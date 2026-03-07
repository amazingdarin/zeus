import { useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { useProjectContext, type ProjectOwnerContext } from "../context/ProjectContext";
import CreateProjectModal from "./CreateProjectModal";
import { fetchTaskStatus as apiFetchTaskStatus } from "../api/tasks";
import { rebuildProjectRag } from "../api/projects";

type ProjectSelectorProps = {
  collapsed?: boolean;
};

type OwnerGroup = ProjectOwnerContext & {
  ownerRef: string;
  projects: ReturnType<typeof useProjectContext>["projects"];
};

const buildOwnerRef = (ownerType: string, ownerKey: string): string => `${ownerType}::${ownerKey}`;

function ProjectSelector({ collapsed = false }: ProjectSelectorProps) {
  const { t } = useTranslation("team");
  const [open, setOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [createOwnerRef, setCreateOwnerRef] = useState<string>("personal::me");
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildModalOpen, setRebuildModalOpen] = useState(false);
  const [rebuildTaskId, setRebuildTaskId] = useState<string | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<string | null>(null);
  const { projects, ownerContexts, currentProject, setCurrentProject, reloadProjects } = useProjectContext();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void reloadProjects().catch(() => undefined);
  }, [open, reloadProjects]);

  const groupedProjects = useMemo<OwnerGroup[]>(() => {
    const groups = new Map<string, OwnerGroup>();

    ownerContexts.forEach((ctx) => {
      const ownerRef = buildOwnerRef(ctx.ownerType, ctx.ownerKey);
      groups.set(ownerRef, {
        ...ctx,
        ownerRef,
        projects: [],
      });
    });

    for (const project of projects) {
      const ownerRef = buildOwnerRef(project.ownerType, project.ownerKey);
      const existing = groups.get(ownerRef);
      if (existing) {
        existing.projects.push(project);
      } else {
        groups.set(ownerRef, {
          ownerType: project.ownerType,
          ownerKey: project.ownerKey,
          ownerId: project.ownerId,
          ownerName: project.ownerName,
          myRole: project.ownerType === "personal" ? "owner" : "member",
          canCreate: project.ownerType === "personal" ? true : project.canWrite,
          ownerRef,
          projects: [project],
        });
      }
    }

    const list = Array.from(groups.values());
    list.forEach((group) => {
      group.projects.sort((a, b) => {
        const left = Date.parse(a.createdAt ?? "") || 0;
        const right = Date.parse(b.createdAt ?? "") || 0;
        if (left !== right) {
          return right - left;
        }
        return a.name.localeCompare(b.name, "zh-Hans-CN");
      });
    });

    list.sort((a, b) => {
      if (a.ownerType === "personal" && b.ownerType !== "personal") {
        return -1;
      }
      if (a.ownerType !== "personal" && b.ownerType === "personal") {
        return 1;
      }
      if (a.ownerType === "personal" && b.ownerType === "personal") {
        return 0;
      }
      return a.ownerName.localeCompare(b.ownerName, "zh-Hans-CN");
    });

    return list;
  }, [ownerContexts, projects]);
  const canCreateAnyProject = useMemo(
    () => groupedProjects.some((group) => group.canCreate),
    [groupedProjects],
  );

  const availableProjects = projects;
  const activeProject = currentProject ?? availableProjects[0] ?? null;

  const toggleOpen = () => setOpen((prev) => !prev);
  const projectInitial = (activeProject?.name || "P").trim().charAt(0).toUpperCase();

  const handleSelect = (projectRef: string) => {
    setCurrentProject(projectRef);
    setOpen(false);
  };

  const findDefaultCreateOwnerRef = (): string => {
    if (activeProject) {
      const activeOwnerRef = buildOwnerRef(activeProject.ownerType, activeProject.ownerKey);
      const activeGroup = groupedProjects.find((group) => group.ownerRef === activeOwnerRef);
      if (activeGroup?.canCreate) {
        return activeOwnerRef;
      }
    }

    const firstCreatable = groupedProjects.find((group) => group.canCreate);
    return firstCreatable?.ownerRef ?? "personal::me";
  };

  const handleAddProject = () => {
    setOpen(false);
    setCreateOwnerRef(findDefaultCreateOwnerRef());
    setShowModal(true);
  };

  const rebuildStorageKey = (projectKey: string) => `zeus_project_rebuild_task_${projectKey}`;

  const updateRebuildState = (projectKey: string, status: string | null, taskId: string | null) => {
    setRebuildStatus(status);
    setRebuildTaskId(taskId);
    setRebuilding(status === "pending" || status === "running");
    if (!taskId || !status || status === "success" || status === "failed" || status === "canceled") {
      localStorage.removeItem(rebuildStorageKey(projectKey));
    }
  };

  const fetchTaskStatus = async (projectKey: string, taskId: string) => {
    try {
      const data = await apiFetchTaskStatus(taskId);
      if (!data) {
        updateRebuildState(projectKey, null, null);
        return;
      }
      const status = typeof data.status === "string" ? data.status : null;
      updateRebuildState(projectKey, status, taskId);
    } catch (err) {
      console.log("rag_project_rebuild_status_error", err);
    }
  };

  useEffect(() => {
    if (!activeProject?.projectRef) {
      setRebuildTaskId(null);
      setRebuildStatus(null);
      setRebuilding(false);
      return;
    }
    const key = rebuildStorageKey(activeProject.projectRef);
    const taskId = localStorage.getItem(key);
    if (taskId) {
      setRebuildTaskId(taskId);
      void fetchTaskStatus(activeProject.projectRef, taskId);
    } else {
      setRebuildTaskId(null);
      setRebuildStatus(null);
      setRebuilding(false);
    }
  }, [activeProject?.projectRef]);

  useEffect(() => {
    if (!activeProject?.projectRef || !rebuildTaskId) {
      return;
    }
    if (rebuildStatus && rebuildStatus !== "pending" && rebuildStatus !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchTaskStatus(activeProject.projectRef, rebuildTaskId);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeProject?.projectRef, rebuildStatus, rebuildTaskId]);

  const requestRebuildProject = async (withSummary: boolean) => {
    if (!activeProject || rebuilding) {
      return;
    }
    if (rebuildTaskId && (rebuildStatus === "pending" || rebuildStatus === "running")) {
      return;
    }
    setRebuilding(true);
    try {
      const data = await rebuildProjectRag(activeProject.projectRef, { with_summary: withSummary });
      const taskId = data.taskId;
      const status = data.status;
      if (taskId) {
        localStorage.setItem(rebuildStorageKey(activeProject.projectRef), taskId);
        updateRebuildState(activeProject.projectRef, status, taskId);
      } else {
        setRebuilding(false);
      }
    } catch (err) {
      console.log("rag_project_rebuild_error", err);
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
    <div className="project-selector compact" ref={containerRef}>
      <Tooltip
        title={activeProject ? activeProject.name : t("project.selector.choose")}
        placement="right"
        mouseEnterDelay={0.3}
      >
        <button
          className="sidebar-menu-item"
          type="button"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          <span className="project-selector-initial" aria-label={t("project.selector.project")}>
            {projectInitial}
          </span>
        </button>
      </Tooltip>
      {open ? (
        <div className={`project-selector-menu${collapsed ? " compact" : ""}`}>
          <button
            className="project-selector-item project-selector-add"
            type="button"
            onClick={handleAddProject}
            disabled={!canCreateAnyProject}
          >
            {t("project.selector.create")}
          </button>
          <div className="project-selector-divider" />

          {groupedProjects.map((group, index) => (
            <div key={group.ownerRef} className="project-selector-group">
              <div className="project-selector-group-header">
                <span>{group.ownerName}</span>
                {!group.canCreate ? <span className="project-selector-group-badge">{t("project.selector.readonly")}</span> : null}
              </div>
              {group.projects.length === 0 ? (
                <div className="project-selector-empty">{t("project.selector.empty")}</div>
              ) : (
                group.projects.map((project) => (
                  <button
                    key={project.id}
                    className={`project-selector-item${
                      activeProject && project.projectRef === activeProject.projectRef ? " active" : ""
                    }`}
                    type="button"
                    onClick={() => handleSelect(project.projectRef)}
                  >
                    {project.name}
                  </button>
                ))
              )}
              {index < groupedProjects.length - 1 ? <div className="project-selector-divider" /> : null}
            </div>
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
              <h2>重建项目知识库</h2>
              <button
                className="modal-close"
                type="button"
                onClick={() => setRebuildModalOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="modal-body">
              是否同时生成文档摘要？
            </div>
            <div className="modal-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => setRebuildModalOpen(false)}
                disabled={rebuilding}
              >
                取消
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => handleRebuildChoice(false)}
                disabled={rebuilding}
              >
                仅重建
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => handleRebuildChoice(true)}
                disabled={rebuilding}
              >
                重建 + 摘要
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showModal ? (
        <CreateProjectModal
          ownerContexts={groupedProjects.map((group) => ({
            ownerType: group.ownerType,
            ownerKey: group.ownerKey,
            ownerId: group.ownerId,
            ownerName: group.ownerName,
            myRole: group.myRole,
            canCreate: group.canCreate,
          }))}
          defaultOwnerRef={createOwnerRef}
          onClose={() => setShowModal(false)}
          onCreated={async (project) => {
            setCurrentProject(project.projectRef);
            await reloadProjects();
            setCurrentProject(project.projectRef);
          }}
        />
      ) : null}
    </div>
  );
}

export default ProjectSelector;
