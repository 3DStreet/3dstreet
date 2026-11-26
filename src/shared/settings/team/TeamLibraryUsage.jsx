/**
 * The team asset library's storage in team settings (#1267 Phase 4,
 * docs/team-assets.md): what the library uses of its limit (the one
 * staff set, or the plan's personal storage per seat).
 */
import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@shared/services/firebase';
import { formatBytes, teamLibraryLimit } from '@shared/assets';

export function TeamLibraryUsage({ org }) {
  const { orgId } = org;
  const [bytesUsed, setBytesUsed] = useState(null);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'orgs', orgId, 'meta', 'usage'),
        (snapshot) => setBytesUsed(snapshot.data()?.bytesUsed || 0),
        (error) => console.error('Error loading team library usage:', error)
      ),
    [orgId]
  );
  if (bytesUsed === null) return null;
  return (
    <span>
      <FormattedMessage
        id="teamModal.libraryUsage"
        defaultMessage="Asset library: {used} of {limit}"
        values={{
          used: formatBytes(bytesUsed),
          limit: formatBytes(teamLibraryLimit(org))
        }}
      />
    </span>
  );
}
