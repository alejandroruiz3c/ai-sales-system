import { describe, expect, it } from 'vitest';

import { manifest } from './index.ts';

describe('@sales-os/agent-voice', () => {
  it('se declara en el workspace con su fase del plan', () => {
    expect(manifest.name).toBe('@sales-os/agent-voice');
    expect(manifest.phase).not.toBe('');
  });
});
