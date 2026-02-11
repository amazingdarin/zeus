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

const lastProjectRefStorageKey = "zeus.lastProjectRef";

type ProjectProviderProps = {
  children: ReactNode;
};

function ProjectProvider({ children }: ProjectProviderProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [ownerContexts, setOwnerContexts] = useState<ProjectOwnerContext[]>([]);
  const [currentProjectRef, setCurrentProjectRef] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reloadProjects = useCallback(async () => {
    if (!isAuthenticated) {
      setProjects([]);
      setOwnerContexts([]);
      setCurrentProjectRef(null);
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

      const storedRef = localStorage.getItem(lastProjectRefStorageKey);
      const hasStored = storedRef
        ? result.projects.some((project) => project.projectRef === storedRef)
        : false;

      if (hasStored) {
        setCurrentProjectRef(storedRef);
      } else {
        const fallbackRef = result.projects[0]?.projectRef ?? null;
        setCurrentProjectRef(fallbackRef);
        if (fallbackRef) {
          localStorage.setItem(lastProjectRefStorageKey, fallbackRef);
        } else {
          localStorage.removeItem(lastProjectRefStorageKey);
        }
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      console.error("Failed to load projects:", error);
      setProjects([]);
      setOwnerContexts([]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (isAuthenticated) {
      reloadProjects();
      hasLoadedRef.current = true;
    } else {
      setProjects([]);
      setOwnerContexts([]);
      setCurrentProjectRef(null);
      hasLoadedRef.current = false;
    }
  }, [isAuthenticated, authLoading, reloadProjects]);

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
      localStorage.setItem(lastProjectRefStorageKey, fallbackRef);
    } else {
      localStorage.removeItem(lastProjectRefStorageKey);
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
      localStorage.removeItem(lastProjectRefStorageKey);
      return;
    }
    setCurrentProjectRef(trimmed);
    localStorage.setItem(lastProjectRefStorageKey, trimmed);
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
