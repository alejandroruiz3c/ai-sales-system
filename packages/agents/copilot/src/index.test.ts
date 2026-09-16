import { describe, expect, it } from 'vitest';

import { manifest } from './index.ts';

describe('@sales-os/agent-copilot', () => {
  it('se declara en el workspace con su fase del plan', () => {
    expect(manifest.name).toBe('@sales-os/agent-copilot');
    expect(manifest.phase).not.toBe('');
  });
});
