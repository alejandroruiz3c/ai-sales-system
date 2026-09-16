import { describe, expect, it } from 'vitest';

import { manifest } from './index.ts';

describe('@sales-os/prompts', () => {
  it('se declara en el workspace con su fase del plan', () => {
    expect(manifest.name).toBe('@sales-os/prompts');
    expect(manifest.phase).not.toBe('');
  });
});
