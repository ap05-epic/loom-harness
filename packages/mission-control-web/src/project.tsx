import { createContext, useContext, useState, type ReactNode } from 'react';

type ProjectCtx = { project: string | undefined; setProject: (p: string | undefined) => void };

const Ctx = createContext<ProjectCtx>({ project: undefined, setProject: () => {} });

/** Holds the dashboard's selected project; queries read it so every view scopes to the same project. */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<string | undefined>(undefined);
  return <Ctx.Provider value={{ project, setProject }}>{children}</Ctx.Provider>;
}

/** The selected project (undefined = the server's default). Works without a provider (default ctx). */
export const useProject = (): ProjectCtx => useContext(Ctx);
