import { describe, expect, test } from 'vitest';
import { makePalette } from './colors.js';
import {
  ChatView,
  formatApprovalPrompt,
  formatBanner,
  formatToolDone,
  renderMarkdown,
} from './chat-view.js';

const plain = makePalette(false); // color off → formatters return readable plain text

describe('renderMarkdown (light)', () => {
  test('headers drop the # and bullets become •', () => {
    expect(renderMarkdown('# Title', plain)).toBe('Title');
    expect(renderMarkdown('- item', plain)).toBe('• item');
  });
  test('strips **bold**, *italic*, and `code` markers', () => {
    expect(renderMarkdown('a **b**, *i*, and `c`', plain)).toBe('a b, i, and c');
  });
  test('passes plain lines through unchanged', () => {
    expect(renderMarkdown('just text', plain)).toBe('just text');
  });
});

describe('formatToolDone', () => {
  test('a success shows ✓ name — first line of the summary', () => {
    const out = formatToolDone('map', 'Mapped 42 screens\nignored', true, plain, true);
    expect(out).toContain('✓');
    expect(out).toContain('map');
    expect(out).toContain('— Mapped 42 screens');
    expect(out).not.toContain('ignored');
  });
  test('a failure shows ✗', () => {
    expect(formatToolDone('run', 'boom', false, plain, true)).toContain('✗');
  });
  test('ASCII fallback when unicode is off', () => {
    expect(formatToolDone('run', 'ok', true, plain, false)).toContain('OK');
  });
});

describe('formatApprovalPrompt', () => {
  test('shows the tool, its risk, and the y/N/a/! options', () => {
    const out = formatApprovalPrompt('run', 'expensive', plain, true);
    expect(out).toContain('allow run');
    expect(out).toContain('(expensive)');
    expect(out).toMatch(/y\/N.*a=always.*!=all/);
  });
});

describe('formatBanner', () => {
  test('shows the mark, provider:model, and the permission mode', () => {
    const out = formatBanner({ provider: 'openai', model: 'gpt-5.4', mode: 'ask' }, plain, true);
    expect(out).toContain('loom chat');
    expect(out).toContain('openai:gpt-5.4 · permission: ask');
  });
});

describe('ChatView (non-TTY: no spinner)', () => {
  function view() {
    const out: string[] = [];
    const v = new ChatView(plain, (s) => out.push(s), { unicode: true, tty: false });
    return { v, text: () => out.join('') };
  }

  test('assistant renders the reply as markdown', () => {
    const { v, text } = view();
    v.assistant('**done** — 1 screen');
    expect(text()).toContain('done — 1 screen');
  });

  test('toolDone prints a one-line result', () => {
    const { v, text } = view();
    v.toolDone('status', 'No runs yet.', true);
    expect(text()).toContain('status');
    expect(text()).toContain('No runs yet.');
  });

  test('error prints a marked line', () => {
    const { v, text } = view();
    v.error('boom');
    expect(text()).toContain('boom');
  });
});
