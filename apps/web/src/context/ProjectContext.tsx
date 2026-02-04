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

import { fetchProjects } from "../api/projects";
import { useAuth } from "./AuthContext";

export type Project = {
  id: string;
  key: string;
  name: string;
  description?: string;
  status?: string;
  createdAt?: string;
};

export type ProjectContextValue = {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProject: (key: string) => void;
  setLoading: (loading: boolean) => void;
  reloadProjects: () => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const lastProjectKeyStorageKey = "zeus.lastProjectKey";

type ProjectProviderProps = {
  children: ReactNode;
};

function ProjectProvider({ children }: ProjectProviderProps) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectKey, setCurrentProjectKey] = useState<string | null>(null);
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
    // Don't load if not authenticated
    if (!isAuthenticated) {
      setProjects([]);
      setCurrentProjectKey(null);
      return;
    }

    setLoading(true);
    try {
      const items = await fetchProjects();
      const mapped = items;
      if (!mountedRef.current) {
        return;
      }
      setProjects(mapped);
      const storedKey = localStorage.getItem(lastProjectKeyStorageKey);
      const hasStored = storedKey
        ? mapped.some((project) => project.key === storedKey)
        : false;
      if (hasStored) {
        setCurrentProjectKey(storedKey);
      } else {
        const fallbackKey = mapped[0]?.key ?? null;
        setCurrentProjectKey(fallbackKey);
        if (fallbackKey) {
          localStorage.setItem(lastProjectKeyStorageKey, fallbackKey);
        } else {
          localStorage.removeItem(lastProjectKeyStorageKey);
        }
      }
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      console.error("Failed to load projects:", error);
      setProjects([]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [isAuthenticated]);

  // Load projects when auth state changes (after auth loading completes)
  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      return;
    }

    // Only load if authenticated
    if (isAuthenticated) {
      // Reload projects when user becomes authenticated
      reloadProjects();
      hasLoadedRef.current = true;
    } else {
      // Clear projects when user logs out
      setProjects([]);
      setCurrentProjectKey(null);
      hasLoadedRef.current = false;
    }
  }, [isAuthenticated, authLoading, reloadProjects]);

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }
    if (currentProjectKey && projects.some((project) => project.key === currentProjectKey)) {
      return;
    }
    const fallbackKey = projects[0]?.key ?? null;
    setCurrentProjectKey(fallbackKey);
    if (fallbackKey) {
      localStorage.setItem(lastProjectKeyStorageKey, fallbackKey);
    } else {
      localStorage.removeItem(lastProjectKeyStorageKey);
    }
  }, [projects, currentProjectKey]);

  const currentProject = useMemo(
    () => projects.find((project) => project.key === currentProjectKey) ?? null,
    [projects, currentProjectKey],
  );

  const setCurrentProject = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) {
      setCurrentProjectKey(null);
      localStorage.removeItem(lastProjectKeyStorageKey);
      return;
    }
    setCurrentProjectKey(trimmed);
    localStorage.setItem(lastProjectKeyStorageKey, trimmed);
  };

  const value = useMemo(
    () => ({
      projects,
      currentProject,
      loading,
      setProjects,
      setCurrentProject,
      setLoading,
      reloadProjects,
    }),
    [projects, currentProject, loading, reloadProjects],
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
