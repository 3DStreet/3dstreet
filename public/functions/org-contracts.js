/**
 * A team's contract terms and payments, and the staff team list
 * (#1267, docs/orgs.md#contract-terms). Pure rules in contract-utils.js.
 *
 * Data (Admin SDK writes only; staff read, firestore.rules):
 *   orgContracts/{orgId}                { billingSource, price { amount
 *                                         (cents), currency, interval },
 *                                         paidThrough, autoRenew,
 *                                         billingContact { name, email },
 *                                         invoiceReference, notes,
 *                                         updatedAt, updatedBy }
 *   orgContracts/{orgId}/payments/{id}  { amount, currency, paidAt,
 *                                         paidThrough, reference,
 *                                         recordedBy, recordedAt }
 */

const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { OrgError, callable, requireAuth } = require('./orgs.js');
const { contractPatch, paymentRecord } = require('./contract-utils.js');

const db = () => admin.firestore();
const contractRef = (orgId) => db().collection('orgContracts').doc(orgId);

const requireStaff = (context) => {
  const uid = requireAuth(context);
  if (context.auth.token.admin !== true) throw new OrgError('staff-only');
  return uid;
};

const requireOrgId = (orgId) => {
  if (typeof orgId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(orgId)) {
    throw new OrgError('invalid-argument');
  }
  return orgId;
};

const toMs = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : value ?? null);

/** Firestore data with its Timestamps as ms, for the callable's JSON. */
const plain = (data) =>
  data && Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toMs(value)]));

/** Staff: change contract fields (null clears one). */
async function updateContract({ orgId, patch, actorUid }) {
  requireOrgId(orgId);
  const { fields, refusal } = contractPatch(patch);
  if (refusal) throw new OrgError(refusal);
  if (!Object.keys(fields).length) throw new OrgError('invalid-argument');
  if (!(await db().collection('orgs').doc(orgId).get()).exists) throw new OrgError('org-not-found');
  if (fields.paidThrough) fields.paidThrough = Timestamp.fromMillis(fields.paidThrough);
  await contractRef(orgId).set(
    { ...fields, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid },
    { merge: true }
  );
  return { orgId };
}

/**
 * Staff: record a payment. It extends the contract's paid-through date
 * (never shortens it), and reactivates a suspended team: everything comes
 * back on payment (docs/team-scenes.md).
 */
async function recordPayment({ orgId, payment: input, actorUid }) {
  requireOrgId(orgId);
  const { payment, refusal } = paymentRecord(input);
  if (refusal) throw new OrgError(refusal);
  return db().runTransaction(async (tx) => {
    const orgRef = db().collection('orgs').doc(orgId);
    const org = await tx.get(orgRef);
    if (!org.exists) throw new OrgError('org-not-found');
    const contract = await tx.get(contractRef(orgId));
    const current = toMs(contract.exists ? contract.data().paidThrough : null) || 0;
    const paidThrough = Math.max(current, payment.paidThrough);
    const ref = contractRef(orgId).collection('payments').doc();
    tx.set(ref, {
      ...payment,
      paidAt: Timestamp.fromMillis(payment.paidAt),
      paidThrough: Timestamp.fromMillis(payment.paidThrough),
      recordedBy: actorUid,
      recordedAt: FieldValue.serverTimestamp()
    });
    tx.set(
      contractRef(orgId),
      { paidThrough: Timestamp.fromMillis(paidThrough), updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid },
      { merge: true }
    );
    const reactivated = org.data().status === 'suspended';
    if (reactivated) tx.update(orgRef, { status: 'active', updatedAt: FieldValue.serverTimestamp() });
    return { orgId, paymentId: ref.id, paidThrough, reactivated };
  });
}

/**
 * Staff: every team with its contract, wallet and member count, newest
 * first. Small numbers of teams (staff-assisted): one read each.
 */
async function listTeams() {
  const orgs = await db().collection('orgs').get();
  const teams = await Promise.all(
    orgs.docs.map(async (doc) => {
      const [contract, wallet, members, payments] = await Promise.all([
        contractRef(doc.id).get(),
        db().collection('orgWallets').doc(doc.id).get(),
        doc.ref.collection('members').count().get(),
        contractRef(doc.id).collection('payments').orderBy('paidAt', 'desc').limit(10).get()
      ]);
      return {
        orgId: doc.id,
        ...plain(doc.data()),
        memberCount: members.data().count,
        contract: plain(contract.exists ? contract.data() : null),
        wallet: plain(wallet.exists ? wallet.data() : null),
        payments: payments.docs.map((p) => ({ id: p.id, ...plain(p.data()) }))
      };
    })
  );
  return teams.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

const orgUpdateContract = callable((data, context) =>
  updateContract({ orgId: data.orgId, patch: data.patch, actorUid: requireStaff(context) })
);

const orgRecordPayment = callable((data, context) =>
  recordPayment({ orgId: data.orgId, payment: data.payment, actorUid: requireStaff(context) })
);

const orgListTeams = callable(async (data, context) => {
  requireStaff(context);
  return { teams: await listTeams() };
});

module.exports = {
  updateContract,
  recordPayment,
  listTeams,
  orgUpdateContract,
  orgRecordPayment,
  orgListTeams
};
