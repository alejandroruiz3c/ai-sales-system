import { describe, expect, it } from 'vitest';

import { manifest } from './index.ts';

describe('@sales-os/agent-prospecting', () => {
  it('se declara en el workspace con su fase del plan', () => {
    expect(manifest.name).toBe('@sales-os/agent-prospecting');
    expect(manifest.phase).not.toBe('');
  });
});
