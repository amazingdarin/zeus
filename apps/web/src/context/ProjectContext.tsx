import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  fetchProjects,
  type Project as ApiProject,
  type ProjectOwnerContext,
} from "../api/projects";
import { buildProjectRef, parseProjectRef } from "../config/api";
import { readLastProjectRef, writeLastProjectRef } from "./project-ref-storage";
import { requiresAuthForCoreRoutes } from "../utils/runtime";
import { useAuth } from "./AuthContext";

export type Project = ApiProject;
export type { ProjectOwnerContext };

export type ProjectContextValue = {
  projects: Project[];
  ownerContexts: ProjectOwnerContext[];
  currentProject: Project | null;
  loading: boolean;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProject: (projectRef: string) => void;
  setLoading: (loading: boolean) => void;
  reloadProjects: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const localDefaultProjectKey =
  String(import.meta.env.VITE_LOCAL_DEFAULT_PROJECT_KEY ?? "").trim() || "test";

type ProjectProviderProps = {
  children: ReactNode;
};

function ProjectProvider({ children }: ProjectProviderProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const coreAuthRequired = requiresAuthForCoreRoutes();
  const [projects, setProjects] = useState<Project[]>([]);
  const [ownerContexts, setOwnerContexts] = useState<ProjectOwnerContext[]>([]);
  const [currentProjectRef, setCurrentProjectRef] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);

  const applyAnonymousProjectState = useCallback(() => {
    const storedRef = readLastProjectRef();
    const parsed = parseProjectRef(storedRef ?? "");
    const projectKey = String(parsed.projectKey ?? "").trim() || localDefaultProjectKey;
    const fallbackRef = buildProjectRef({
      ownerType: "personal",
      ownerKey: "me",
      projectKey,
    });

    const anonymousProject: Project = {
      id: `local-${projectKey}`,
      key: projectKey,
      name: projectKey,
      ownerType: "personal",
      ownerKey: "me",
      ownerId: "default-user",
      ownerName: "个人",
      canWrite: true,
      projectRef: fallbackRef,
    };

    const anonymousContext: ProjectOwnerContext = {
      ownerType: "personal",
      ownerKey: "me",
      ownerId: "default-user",
      ownerName: "个人",
      myRole: "owner",
      canCreate: false,
    };

    setProjects([anonymousProject]);
    setOwnerContexts([anonymousContext]);
    setCurrentProjectRef(fallbackRef);
    writeLastProjectRef(fallbackRef);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reloadProjects = useCallback(async () => {
    if (!isAuthenticated) {
      if (coreAuthRequired) {
        setProjects([]);
        setOwnerContexts([]);
        setCurrentProjectRef(null);
      } else {
        applyAnonymousProjectState();
      }
      return;
    }

    setLoading(true);
    try {
      const result = await fetchProjects();
      if (!mountedRef.current) {
        return;
      }
      setProjects(result.projects);
      setOwnerContexts(result.contexts);

      const storedRef = readLastProjectRef();
      const hasStored = storedRef
        ? result.projects.some((project) => project.projectRef === storedRef)
        : false;

      if (hasStored) {
        setCurrentProjectRef(storedRef);
      } else {
        const fallbackRef = result.projects[0]?.projectRef ?? null;
        setCurrentProjectRef(fallbackRef);
        if (fallbackRef) {
          writeLastProjectRef(fallbackRef);
        } else {
          writeLastProjectRef(null);
        }
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      console.error("Failed to load projects:", error);
      if (coreAuthRequired) {
        setProjects([]);
        setOwnerContexts([]);
        setCurrentProjectRef(null);
      } else {
        applyAnonymousProjectState();
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, coreAuthRequired, applyAnonymousProjectState]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (isAuthenticated) {
      reloadProjects();
      hasLoadedRef.current = true;
    } else {
      if (coreAuthRequired) {
        setProjects([]);
        setOwnerContexts([]);
        setCurrentProjectRef(null);
      } else {
        applyAnonymousProjectState();
      }
      hasLoadedRef.current = false;
    }
  }, [isAuthenticated, authLoading, reloadProjects, coreAuthRequired, applyAnonymousProjectState]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }
    if (currentProjectRef && projects.some((project) => project.projectRef === currentProjectRef)) {
      return;
    }
    const fallbackRef = projects[0]?.projectRef ?? null;
    setCurrentProjectRef(fallbackRef);
    if (fallbackRef) {
      writeLastProjectRef(fallbackRef);
    } else {
      writeLastProjectRef(null);
    }
  }, [projects, currentProjectRef]);

  const currentProject = useMemo(
    () => projects.find((project) => project.projectRef === currentProjectRef) ?? null,
    [projects, currentProjectRef],
  );

  const setCurrentProject = (projectRef: string) => {
    const trimmed = String(projectRef ?? "").trim();
    if (!trimmed) {
      setCurrentProjectRef(null);
      writeLastProjectRef(null);
      return;
    }
    setCurrentProjectRef(trimmed);
    writeLastProjectRef(trimmed);
  };

  const value = useMemo(
    () => ({
      projects,
      ownerContexts,
      currentProject,
      loading,
      setProjects,
      setCurrentProject,
      setLoading,
      reloadProjects,
    }),
    [projects, ownerContexts, currentProject, loading, reloadProjects],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return context;
}

export { ProjectContext, ProjectProvider, useProjectContext };
