import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchExplore, stopBaa } from '../api';
import { useProject } from '../project';
import { appendSample, type TokenSample } from '../lib/series';
import { LiveCrawl } from './LiveCrawl';

/** Polls /api/explore every 2s and accumulates the live token-burn series client-side. */
export function ExploreView() {
  const { project } = useProject();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['explore', project],
    queryFn: () => fetchExplore(project),
    refetchInterval: 2000,
  });
  const stop = useMutation({
    mutationFn: () => stopBaa(data?.run?.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['explore'] }),
  });
  const [series, setSeries] = useState<TokenSample[]>([]);
  const tokens = data?.totals.tokens;
  const elapsedMs = data?.totals.elapsedMs;
  useEffect(() => {
    if (tokens == null || elapsedMs == null) return;
    setSeries((s) => appendSample(s, { elapsedMs, tokens }));
  }, [tokens, elapsedMs]);
  const running = data?.run?.status === 'running' && !data?.totals.done;
  return (
    <div className="flex flex-col gap-3">
      {running ? (
        <div className="flex items-center justify-end">
          <button
            className="btn btn-no"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
            title="Stop the crawl — halts the explorer and its token use"
          >
            ■ Stop crawl
          </button>
        </div>
      ) : null}
      <LiveCrawl state={data ?? null} series={series} />
    </div>
  );
}
