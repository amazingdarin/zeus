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
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectKey, setCurrentProjectKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reloadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/projects");
      if (!response.ok) {
        throw new Error("Failed to load projects");
      }
      const payload = await response.json();
      const items = Array.isArray(payload?.data) ? payload.data : [];
      const mapped = items.map((item: any) => ({
        id: String(item.id ?? ""),
        key: String(item.key ?? ""),
        name: String(item.name ?? ""),
        description: item.description ?? undefined,
        status: item.status ?? undefined,
        createdAt: item.created_at ?? item.createdAt ?? undefined,
      }));
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
      setProjects([]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    reloadProjects();
  }, [reloadProjects]);

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
