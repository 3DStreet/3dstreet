/* global describe, it */

import assert from 'assert';
import stopRules from '../../public/functions/email/stop-rules.js';

const { evaluateStopRules, toMillis, DAY_MS } = stopRules;

const NOW = 1_800_000_000_000; // fixed clock for deterministic window checks

// Builds an emailLog summary doc with one prior send of `emailId`.
const summaryWithSend = (emailId, category, sentAtMs, dedupeKey = null) => ({
  emails: {
    [emailId]: {
      lastSentAt: sentAtMs,
      sentCount: 1,
      ...(dedupeKey ? { dedupeKeys: { [dedupeKey]: sentAtMs } } : {})
    }
  },
  categories: { [category]: { lastSentAt: sentAtMs } }
});

describe('email stop-rules', function () {
  describe('#evaluateStopRules()', function () {
    it('allows when there is no summary doc (first-ever send)', function () {
      const verdict = evaluateStopRules({
        emailId: 'welcome',
        category: 'transactional',
        rules: { onceEver: true },
        summary: null,
        nowMs: NOW
      });
      assert.deepStrictEqual(verdict, { allowed: true, reason: null });
    });

    it('allows with no rules at all', function () {
      const verdict = evaluateStopRules({
        emailId: 'testPing',
        category: 'transactional',
        summary: summaryWithSend('testPing', 'transactional', NOW - 1000),
        nowMs: NOW
      });
      assert.strictEqual(verdict.allowed, true);
    });

    describe('onceEver', function () {
      it('blocks a second send of the same emailId', function () {
        const verdict = evaluateStopRules({
          emailId: 'welcome',
          category: 'transactional',
          rules: { onceEver: true },
          summary: summaryWithSend(
            'welcome',
            'transactional',
            NOW - 400 * DAY_MS
          ),
          nowMs: NOW
        });
        assert.deepStrictEqual(verdict, { allowed: false, reason: 'onceEver' });
      });

      it('does not block a different emailId', function () {
        const verdict = evaluateStopRules({
          emailId: 'geoNotUsed',
          category: 'lifecycle',
          rules: { onceEver: true },
          summary: summaryWithSend('welcome', 'transactional', NOW - DAY_MS),
          nowMs: NOW
        });
        assert.strictEqual(verdict.allowed, true);
      });
    });

    describe('notWithinDays', function () {
      it('blocks inside the window', function () {
        const verdict = evaluateStopRules({
          emailId: 'pricingNudge',
          category: 'conversion',
          rules: { notWithinDays: 30 },
          summary: summaryWithSend(
            'pricingNudge',
            'conversion',
            NOW - 29 * DAY_MS
          ),
          nowMs: NOW
        });
        assert.deepStrictEqual(verdict, {
          allowed: false,
          reason: 'notWithinDays'
        });
      });

      it('allows once the window has elapsed', function () {
        const verdict = evaluateStopRules({
          emailId: 'pricingNudge',
          category: 'conversion',
          rules: { notWithinDays: 30 },
          summary: summaryWithSend(
            'pricingNudge',
            'conversion',
            NOW - 31 * DAY_MS
          ),
          nowMs: NOW
        });
        assert.strictEqual(verdict.allowed, true);
      });
    });

    describe('categoryNotWithinDays', function () {
      it('blocks when a DIFFERENT email in the same category sent recently', function () {
        // e.g. checkoutAbandoned72h suppressed because checkoutAbandoned1h
        // went out 2 days ago (≤1 conversion email per user per 7d).
        const verdict = evaluateStopRules({
          emailId: 'checkoutAbandoned72h',
          category: 'conversion',
          rules: { categoryNotWithinDays: 7 },
          summary: summaryWithSend(
            'checkoutAbandoned1h',
            'conversion',
            NOW - 2 * DAY_MS
          ),
          nowMs: NOW
        });
        assert.deepStrictEqual(verdict, {
          allowed: false,
          reason: 'categoryNotWithinDays'
        });
      });

      it('ignores sends in other categories', function () {
        const verdict = evaluateStopRules({
          emailId: 'checkoutAbandoned1h',
          category: 'conversion',
          rules: { categoryNotWithinDays: 7 },
          summary: summaryWithSend('geoNotUsed', 'lifecycle', NOW - DAY_MS),
          nowMs: NOW
        });
        assert.strictEqual(verdict.allowed, true);
      });
    });

    describe('dedupeKey', function () {
      it('blocks a repeat of the same key (same invoice/session)', function () {
        const verdict = evaluateStopRules({
          emailId: 'failedPayment',
          category: 'transactional',
          summary: summaryWithSend(
            'failedPayment',
            'transactional',
            NOW - DAY_MS,
            'in_123'
          ),
          dedupeKey: 'in_123',
          nowMs: NOW
        });
        assert.deepStrictEqual(verdict, {
          allowed: false,
          reason: 'dedupeKey'
        });
      });

      it('allows a new key for the same emailId', function () {
        const verdict = evaluateStopRules({
          emailId: 'failedPayment',
          category: 'transactional',
          summary: summaryWithSend(
            'failedPayment',
            'transactional',
            NOW - DAY_MS,
            'in_123'
          ),
          dedupeKey: 'in_456',
          nowMs: NOW
        });
        assert.strictEqual(verdict.allowed, true);
      });
    });

    describe('stopIfPro', function () {
      it('blocks when the caller resolved the user as Pro', function () {
        const verdict = evaluateStopRules({
          emailId: 'geoNotUsed',
          category: 'lifecycle',
          rules: { stopIfPro: true },
          summary: null,
          isPro: true,
          nowMs: NOW
        });
        assert.deepStrictEqual(verdict, { allowed: false, reason: 'pro' });
      });

      it('ignores isPro when the rule is not set', function () {
        const verdict = evaluateStopRules({
          emailId: 'postUpgradeWelcome',
          category: 'transactional',
          summary: null,
          isPro: true,
          nowMs: NOW
        });
        assert.strictEqual(verdict.allowed, true);
      });
    });

    it('combines rules: first blocking rule wins (pro before onceEver)', function () {
      const verdict = evaluateStopRules({
        emailId: 'geoNotUsed',
        category: 'lifecycle',
        rules: { stopIfPro: true, onceEver: true },
        summary: summaryWithSend('geoNotUsed', 'lifecycle', NOW - DAY_MS),
        isPro: true,
        nowMs: NOW
      });
      assert.strictEqual(verdict.reason, 'pro');
    });
  });

  describe('#toMillis()', function () {
    it('handles epoch ms, Date, Firestore Timestamp-like, and null', function () {
      assert.strictEqual(toMillis(NOW), NOW);
      assert.strictEqual(toMillis(new Date(NOW)), NOW);
      assert.strictEqual(toMillis({ toMillis: () => NOW }), NOW);
      assert.strictEqual(toMillis(null), null);
      assert.strictEqual(toMillis(undefined), null);
      assert.strictEqual(toMillis('not-a-time'), null);
    });
  });
});
