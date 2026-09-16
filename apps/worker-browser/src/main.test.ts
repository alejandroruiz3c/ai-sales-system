import { describe, expect, it } from 'vitest';

import { describeWorker, workerInfo } from './main.ts';

describe('@sales-os/worker-browser', () => {
  it('declara que su sitio es Hetzner y no Vercel', () => {
    expect(workerInfo.host).toBe('hetzner');
    expect(describeWorker()).toContain('hetzner');
  });
});
