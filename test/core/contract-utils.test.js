/* global describe, it */

/**
 * A team's contract terms (docs/orgs.md#contract-terms): staff patches and
 * payments are validated field by field.
 */

const assert = require('assert');
const {
  contractPatch,
  paymentRecord
} = require('../../public/functions/contract-utils.js');

describe('contract-utils', () => {
  it('accepts each field, trims text and clears with null', () => {
    const { fields } = contractPatch({
      billingSource: 'invoice',
      price: { amount: 200000, currency: 'usd', interval: 'year', extra: 1 },
      paidThrough: 1800000000000,
      autoRenew: false,
      billingContact: { name: ' Ana ', email: 'AP@Metro.test' },
      invoiceReference: ' PO-123 ',
      notes: null
    });
    assert.deepStrictEqual(fields, {
      billingSource: 'invoice',
      price: { amount: 200000, currency: 'usd', interval: 'year' },
      paidThrough: 1800000000000,
      autoRenew: false,
      billingContact: { name: 'Ana', email: 'ap@metro.test' },
      invoiceReference: 'PO-123',
      notes: null
    });
  });

  it('refuses unknown fields and bad values', () => {
    assert.strictEqual(
      contractPatch({ paidUntil: 1 }).refusal,
      'unknown-field'
    );
    for (const patch of [
      { billingSource: 'cash' },
      { billingSource: null },
      { price: { amount: 1.5, currency: 'usd', interval: 'year' } },
      { price: { amount: 100, currency: 'USD', interval: 'year' } },
      { price: { amount: 100, currency: 'usd', interval: 'week' } },
      { paidThrough: '2027-01-01' },
      { autoRenew: 'yes' },
      { billingContact: { name: 'Ana', email: 'nope' } },
      { invoiceReference: 'x'.repeat(201) }
    ]) {
      assert.strictEqual(contractPatch(patch).refusal, 'invalid-contract');
    }
  });

  it('checks a payment', () => {
    const payment = {
      amount: 200000,
      currency: 'usd',
      paidAt: 1760000000000,
      paidThrough: 1800000000000,
      reference: 'INV-7'
    };
    assert.deepStrictEqual(paymentRecord(payment).payment, payment);
    assert.strictEqual(
      paymentRecord({ ...payment, reference: undefined }).payment.reference,
      null
    );
    assert.strictEqual(
      paymentRecord({ ...payment, amount: -1 }).refusal,
      'invalid-payment'
    );
    assert.strictEqual(
      paymentRecord({ ...payment, paidThrough: undefined }).refusal,
      'invalid-payment'
    );
  });
});
