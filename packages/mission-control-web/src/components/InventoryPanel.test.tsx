import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Inventory } from '../api';
import { InventoryPanel } from './InventoryPanel';

const inv: Inventory = {
  tools: [
    { name: 'write_file', category: 'build', description: 'writes a file' },
    { name: 'parity-eval', category: 'verify', description: '7-layer judge' },
  ],
  mcpExternal: [{ name: 'figma', description: 'figma mcp' }],
  skills: [
    {
      name: 'JSTL date parity',
      description: 'date format',
      tier: 'project',
      status: 'active',
      useCount: 3,
      successCount: 2,
      source: 'db',
    },
  ],
  digit: { home: '~/.copilot', skills: [], agents: [], mcp: [] },
};

function mock(i: Inventory) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(i), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
}

function withClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe('InventoryPanel', () => {
  test('lists the harness tools and skills', async () => {
    mock(inv);
    withClient(<InventoryPanel />);
    expect(await screen.findByText('write_file')).toBeInTheDocument();
    expect(await screen.findByText('parity-eval')).toBeInTheDocument();
    expect(await screen.findByText('JSTL date parity')).toBeInTheDocument();
  });
});
