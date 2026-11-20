/**
 * The client's team wallet math (src/shared/utils/teamWallet.js) must match
 * the server's (public/functions/wallet-utils.js), or the app would show a
 * balance the server then refuses.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as client from '@shared/utils/teamWallet.js';

const require = createRequire(import.meta.url);
const server = require('../../public/functions/wallet-utils.js');

const wallets = [
  {},
  { genToken: 40, monthlyTokenBudget: 1000, lastRefill: '2026-9' },
  { genToken: 1500, monthlyTokenBudget: 1000, lastRefill: '2026-9' },
  { genToken: 40, monthlyTokenBudget: 1000, lastRefill: '2026-10' },
  { genToken: 300, memberMonthlyCap: 50, monthlyTokenBudget: 0 },
  { genToken: -5, memberMonthlyCap: null }
];

describe('team wallet client/server sync', () => {
  it('keys months the same way', () => {
    const date = new Date(2026, 10, 20);
    expect(client.monthKey(date)).toBe(server.monthKey(date));
  });

  it('refills and limits members the same way', () => {
    for (const wallet of wallets) {
      expect(client.refillWallet(wallet, '2026-10')).toEqual(
        server.refillWallet(wallet, '2026-10')
      );
      for (const usedThisMonth of [0, 45, 60]) {
        expect(client.memberAvailable({ wallet, usedThisMonth })).toBe(
          server.memberAvailable({ wallet, usedThisMonth })
        );
      }
    }
  });
});
