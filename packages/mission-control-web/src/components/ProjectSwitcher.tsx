import { useQuery } from '@tanstack/react-query';
import { fetchProjects } from '../api';
import { useProject } from '../project';

/** A `<select>` over the projects the harness knows about; hidden when there's nothing to switch. */
export function ProjectSwitcher() {
  const { project, setProject } = useProject();
  const { data } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const projects = data?.projects ?? [];
  if (projects.length <= 1) return null;
  return (
    <select
      className="field"
      value={project ?? data?.active ?? projects[0] ?? ''}
      onChange={(e) => setProject(e.target.value)}
    >
      {projects.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
