import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchInventory } from '../api';
import { useProject } from '../project';

function Col({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="muted mb-1 text-xs uppercase tracking-wide">{title}</h4>
      <ul className="flex flex-col gap-1 text-sm">{children}</ul>
    </div>
  );
}

/** The harness's capability inventory: built-in tools, learned skills, and attached external MCP servers. */
export function InventoryPanel() {
  const { project } = useProject();
  const { data } = useQuery({
    queryKey: ['inventory', project],
    queryFn: () => fetchInventory(project),
  });
  const tools = data?.tools ?? [];
  const skills = data?.skills ?? [];
  const mcp = data?.mcpExternal ?? [];
  return (
    <section className="card p-3">
      <h3 className="mb-2 font-medium">Capabilities</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Col title={`Tools (${tools.length})`}>
          {tools.map((t) => (
            <li key={t.name} className="flex flex-col">
              <span className="mono">{t.name}</span>
              <span className="muted text-xs">{t.category}</span>
            </li>
          ))}
        </Col>
        <Col title={`Skills (${skills.length})`}>
          {skills.length ? (
            skills.map((s) => (
              <li key={s.name} className="flex flex-col">
                <span>{s.name}</span>
                <span className="muted text-xs">
                  {s.tier} · {s.status}
                </span>
              </li>
            ))
          ) : (
            <li className="muted text-sm">none yet</li>
          )}
        </Col>
        <Col title={`MCP (${mcp.length})`}>
          {mcp.length ? (
            mcp.map((m) => (
              <li key={m.name} className="mono text-sm">
                {m.name}
              </li>
            ))
          ) : (
            <li className="muted text-sm">none attached</li>
          )}
        </Col>
      </div>
    </section>
  );
}
