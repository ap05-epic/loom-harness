import { describe, expect, test } from 'vitest';
import { packWorkOrder, type Slot } from './packer.js';
import { heuristicCount } from './tokens.js';

const opts = (budget: number, vision = true) => ({ budget, count: heuristicCount, vision });

function slot(
  partial: Partial<Slot> & Pick<Slot, 'name' | 'content' | 'priority' | 'shrink'>,
): Slot {
  return partial;
}

describe('packWorkOrder', () => {
  test('includes every slot in full when within budget, ordered by priority', () => {
    const result = packWorkOrder(
      [
        slot({ name: 'src', content: 'y'.repeat(40), priority: 1, shrink: 'truncate' }),
        slot({ name: 'spec', content: 'x'.repeat(40), priority: 0, shrink: 'keep' }),
      ],
      opts(100),
    );
    expect(result.slots.map((s) => s.name)).toEqual(['spec', 'src']); // priority order
    expect(result.slots.every((s) => s.status === 'full')).toBe(true);
    expect(result.usedTokens).toBe(22);
    expect(result.text.indexOf('spec')).toBeLessThan(result.text.indexOf('src'));
  });

  test('truncates the least-important slot when over budget, keeps the task spec', () => {
    const result = packWorkOrder(
      [
        slot({ name: 'spec', content: 'x'.repeat(40), priority: 0, shrink: 'keep' }),
        slot({ name: 'src', content: 'y'.repeat(400), priority: 1, shrink: 'truncate' }),
      ],
      opts(60),
    );
    const spec = result.slots.find((s) => s.name === 'spec')!;
    const src = result.slots.find((s) => s.name === 'src')!;
    expect(spec.status).toBe('full');
    expect(src.status).toBe('truncated');
    expect(result.usedTokens).toBeLessThanOrEqual(60);
    expect(result.text).toContain('truncated');
  });

  test('drops a droppable slot that does not fit', () => {
    const result = packWorkOrder(
      [
        slot({ name: 'spec', content: 'x'.repeat(40), priority: 0, shrink: 'keep' }),
        slot({ name: 'extra', content: 'z'.repeat(400), priority: 2, shrink: 'drop' }),
      ],
      opts(50),
    );
    expect(result.slots.find((s) => s.name === 'extra')!.status).toBe('dropped');
    expect(result.text).not.toContain('extra');
  });

  test('drops vision-requiring slots when the model has no vision', () => {
    const slots = [
      slot({ name: 'spec', content: 'x'.repeat(40), priority: 0, shrink: 'keep' }),
      slot({
        name: 'shot',
        content: '<image>',
        priority: 5,
        shrink: 'drop',
        requiresVision: true,
        tokenEstimate: 1000,
      }),
    ];
    const noVision = packWorkOrder(slots, opts(5000, false));
    expect(noVision.slots.find((s) => s.name === 'shot')!.status).toBe('dropped');

    const withVision = packWorkOrder(slots, opts(5000, true));
    expect(withVision.slots.find((s) => s.name === 'shot')!.status).toBe('full');
  });

  test('a keep slot is never truncated, even if it alone exceeds the budget', () => {
    const result = packWorkOrder(
      [slot({ name: 'spec', content: 'x'.repeat(4000), priority: 0, shrink: 'keep' })],
      opts(100),
    );
    expect(result.slots[0]!.status).toBe('full');
    expect(result.usedTokens).toBeGreaterThan(100); // task spec preserved despite overflow
  });

  test('a per-slot maxTokens cap leaves budget for lower-priority slots', () => {
    const result = packWorkOrder(
      [
        slot({ name: 'spec', content: 'x'.repeat(40), priority: 0, shrink: 'keep' }),
        slot({
          name: 'src',
          content: 'y'.repeat(4000),
          priority: 1,
          shrink: 'truncate',
          maxTokens: 200,
        }),
        slot({ name: 'tail', content: 'z'.repeat(40), priority: 2, shrink: 'drop' }),
      ],
      opts(400),
    );
    const src = result.slots.find((s) => s.name === 'src')!;
    const tail = result.slots.find((s) => s.name === 'tail')!;
    expect(src.status).toBe('truncated');
    expect(src.tokens).toBeLessThanOrEqual(200); // capped, did not eat the whole budget
    expect(tail.status).toBe('full'); // room remained for the lower-priority slot
  });

  test('uses tokenEstimate override instead of counting content', () => {
    const result = packWorkOrder(
      [slot({ name: 'img', content: 'tiny', priority: 0, shrink: 'keep', tokenEstimate: 900 })],
      opts(2000),
    );
    expect(result.slots[0]!.tokens).toBe(900);
  });
});
