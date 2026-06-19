import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Chat } from './Chat';
import { ProjectProvider } from '../project';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Chat', () => {
  test('renders the composer, new-chat button, and the model/profile status bar when enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/api/chat/info'))
          return json({ model: 'gpt-5.4', project: 'baa', driver: 'openai' });
        if (u.includes('/api/chat/sessions')) return json({ sessions: [] });
        return json({});
      }),
    );
    render(
      <ProjectProvider>
        <Chat />
      </ProjectProvider>,
    );
    expect(await screen.findByText(/New chat/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Message the harness/i)).toBeInTheDocument();
    expect(await screen.findByText(/openai\/gpt-5\.4/)).toBeInTheDocument(); // status bar model
  });

  test('shows a friendly message when chat is not enabled (info 503)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/chat/info')) return json({}, 503);
        return json({ sessions: [] });
      }),
    );
    render(
      <ProjectProvider>
        <Chat />
      </ProjectProvider>,
    );
    expect(await screen.findByText(/Chat isn/i)).toBeInTheDocument();
  });
});
