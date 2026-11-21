/**
 * Who owns a cloud asset (#1267 Phase 4, docs/team-assets.md): an "owner
 * key". A user's uid for a personal asset (users/{uid}/assets), or
 * `org:<orgId>` for an asset in a team's library (orgs/{orgId}/assets).
 *
 * Scenes store the owner key in data-asset-owner-uid, so everything that
 * carries an asset's identity (serialization, URL resolution, placeholders,
 * Replace) works for team assets unchanged; only the Firestore path differs.
 * A uid never contains a colon, so the two never collide.
 */

export const TEAM_OWNER_PREFIX = 'org:';

/** The owner key of a team's library. */
export const teamAssetOwner = (orgId) => `${TEAM_OWNER_PREFIX}${orgId}`;

/** The team of an owner key, or null for a personal owner. */
export const teamIdOfOwner = (owner) =>
  typeof owner === 'string' && owner.startsWith(TEAM_OWNER_PREFIX)
    ? owner.slice(TEAM_OWNER_PREFIX.length)
    : null;

/** Firestore path segments of the owner's document: [collection, id]. */
export const assetOwnerSegments = (owner) => {
  const orgId = teamIdOfOwner(owner);
  return orgId ? ['orgs', orgId] : ['users', owner];
};
