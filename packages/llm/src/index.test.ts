import { describe, expect, it } from 'vitest';

import { manifest } from './index.ts';

describe('@sales-os/llm', () => {
  it('se declara en el workspace con su fase del plan', () => {
    expect(manifest.name).toBe('@sales-os/llm');
    expect(manifest.phase).not.toBe('');
  });
});
