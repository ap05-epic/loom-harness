import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchExplore } from '../api';
import { useProject } from '../project';
import { appendSample, type TokenSample } from '../lib/series';
import { LiveCrawl } from './LiveCrawl';

/** Polls /api/explore every 2s and accumulates the live token-burn series client-side. */
export function ExploreView() {
  const { project } = useProject();
  const { data } = useQuery({
    queryKey: ['explore', project],
    queryFn: () => fetchExplore(project),
    refetchInterval: 2000,
  });
  const [series, setSeries] = useState<TokenSample[]>([]);
  const tokens = data?.totals.tokens;
  const elapsedMs = data?.totals.elapsedMs;
  useEffect(() => {
    if (tokens == null || elapsedMs == null) return;
    setSeries((s) => appendSample(s, { elapsedMs, tokens }));
  }, [tokens, elapsedMs]);
  return <LiveCrawl state={data ?? null} series={series} />;
}
