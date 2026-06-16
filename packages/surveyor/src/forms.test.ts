import type { DomSnapshot } from '@loom/browser';
import { describe, expect, test } from 'vitest';
import { extractForms } from './forms.js';

const el = (
  tag: string,
  attrs: Record<string, string> = {},
  children: DomSnapshot[] = [],
  extra: Partial<DomSnapshot> = {},
): DomSnapshot => ({ tag, attrs, children, ...extra });

describe('extractForms', () => {
  test('recovers fields with their validation constraints, options, and labels', () => {
    const dom = el('body', {}, [
      el('form', { action: '/save', method: 'post' }, [
        el('label', { for: 'email' }, [], { text: 'Email address' }),
        el('input', { id: 'email', name: 'email', type: 'email', required: '' }),
        el('input', { name: 'age', type: 'number', maxlength: '3' }),
        el('select', { name: 'country' }, [], { options: ['us', 'ca'] }),
        el('textarea', { name: 'notes', maxlength: '500' }),
        el('input', { type: 'submit', value: 'Save' }), // an action, not a data field
      ]),
    ]);

    const forms = extractForms(dom);
    expect(forms).toHaveLength(1);
    const form = forms[0]!;
    expect(form.action).toBe('/save');
    expect(form.method).toBe('post');

    const byName = Object.fromEntries(form.fields.map((f) => [f.name, f]));
    expect(byName.email).toMatchObject({ type: 'email', required: true, label: 'Email address' });
    expect(byName.age).toMatchObject({ type: 'number', required: false, maxLength: 3 });
    expect(byName.country).toMatchObject({ type: 'select', options: ['us', 'ca'] });
    expect(byName.notes).toMatchObject({ type: 'textarea', maxLength: 500 });
    // the submit input is an action — not a recovered data field
    expect(form.fields.some((f) => f.type === 'submit')).toBe(false);
  });

  test('returns nothing when there are no forms', () => {
    expect(extractForms(el('body', {}, [el('p', {}, [], { text: 'no forms here' })]))).toEqual([]);
  });

  test('captures a wrapping label and a pattern constraint', () => {
    const dom = el('body', {}, [
      el('form', {}, [
        el('label', {}, [el('input', { name: 'zip', type: 'text', pattern: '\\d{5}' })], {
          text: 'ZIP',
        }),
      ]),
    ]);
    const field = extractForms(dom)[0]!.fields[0]!;
    expect(field).toMatchObject({ name: 'zip', pattern: '\\d{5}', label: 'ZIP' });
  });
});
