/* global describe, it */

import assert from 'assert';
import {
  isProjectPassHash,
  getProjectPassSource,
  isRedeemHash,
  getRedeemCode
} from '../../src/tested/project-pass-link.js';

describe('project-pass-link (#1922)', function () {
  describe('#isProjectPassHash()', function () {
    it('matches the bare route and its query forms', function () {
      assert.strictEqual(isProjectPassHash('#project-pass'), true);
      assert.strictEqual(isProjectPassHash('#project-pass?src=email'), true);
      assert.strictEqual(isProjectPassHash('#project-pass&src=email'), true);
      assert.strictEqual(isProjectPassHash('#Project-Pass'), true);
    });

    it('does not match other routes or look-alikes', function () {
      assert.strictEqual(isProjectPassHash(''), false);
      assert.strictEqual(isProjectPassHash(undefined), false);
      assert.strictEqual(isProjectPassHash('#payment'), false);
      assert.strictEqual(isProjectPassHash('#payment-max-annual'), false);
      assert.strictEqual(isProjectPassHash('#project-passport'), false);
      assert.strictEqual(
        isProjectPassHash('#https://streetmix.net/project-pass'),
        false
      );
    });
  });

  describe('#getProjectPassSource()', function () {
    it('reads src from either separator', function () {
      assert.strictEqual(
        getProjectPassSource('#project-pass?src=winback'),
        'winback'
      );
      assert.strictEqual(
        getProjectPassSource('#project-pass&src=Cancel_Flow'),
        'cancel_flow'
      );
      assert.strictEqual(
        getProjectPassSource('#project-pass?utm=x&src=email-1'),
        'email-1'
      );
    });

    it('is null when absent, invalid, or not a pass link', function () {
      assert.strictEqual(getProjectPassSource('#project-pass'), null);
      assert.strictEqual(getProjectPassSource('#project-pass?src='), null);
      assert.strictEqual(
        getProjectPassSource('#project-pass?src=<script>'),
        null
      );
      assert.strictEqual(getProjectPassSource('#project-pass?src=%E0'), null);
      assert.strictEqual(getProjectPassSource('#payment?src=email'), null);
    });
  });

  describe('#isRedeemHash() / #getRedeemCode()', function () {
    it('matches #redeem and reads the code', function () {
      assert.strictEqual(isRedeemHash('#redeem'), true);
      assert.strictEqual(isRedeemHash('#redeem?code=ABC-1234'), true);
      assert.strictEqual(
        getRedeemCode('#redeem?code=foundation-7kq2'),
        'FOUNDATION-7KQ2'
      );
      assert.strictEqual(getRedeemCode('#redeem&code=%20ab-cd%20'), 'AB-CD');
    });

    it('does not match other routes; empty code when absent', function () {
      assert.strictEqual(isRedeemHash('#redeemer'), false);
      assert.strictEqual(isRedeemHash('#project-pass'), false);
      assert.strictEqual(getRedeemCode('#redeem'), '');
      assert.strictEqual(getRedeemCode('#redeem?code=%E0'), '');
      assert.strictEqual(getRedeemCode('#project-pass?code=X'), '');
    });
  });
});
