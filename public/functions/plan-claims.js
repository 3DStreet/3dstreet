const { getAuth } = require('firebase-admin/auth');

/**
 * Set a user's `plan` claim, keeping their other claims (admin, beta):
 * setCustomUserClaims replaces the whole object. Every plan write goes
 * through here.
 */
const setPlanClaim = async (uid, plan) => {
  const { customClaims } = await getAuth().getUser(uid);
  await getAuth().setCustomUserClaims(uid, { ...customClaims, plan });
};

module.exports = { setPlanClaim };
