/**
 * The client's team library limit must match the server's, or team settings
 * would show room the server then refuses.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { teamLibraryLimit } from '@shared/assets/teamLibrary.js';

const require = createRequire(import.meta.url);
const server = require('../../../public/functions/team-assets-utils.js');

describe('team library limit client/server sync', () => {
  it('computes the same limit', () => {
    for (const plan of ['PRO', 'MAX', 'OTHER']) {
      for (const seats of [0, 1, 3, 20]) {
        for (const storageLimitGb of [null, 200]) {
          const org = { plan, seats, storageLimitGb };
          expect(teamLibraryLimit(org)).toBe(server.teamStorageLimit(org));
        }
      }
    }
  });
});
