/**
 * Staff pages, opened by a URL hash and loaded only then, so they stay out
 * of the main bundle:
 *   #admin/health  System Health (JobHealthModal)
 *   #admin/teams   Teams: terms, contracts, payments, tokens (StaffTeamsModal)
 * Each page checks the `admin` claim; the data behind it is staff-only.
 */
import { lazy, Suspense, useEffect, useState } from 'react';

const PAGES = {
  '#admin/health': lazy(() => import('./JobHealthModal.jsx')),
  '#admin/teams': lazy(() => import('./StaffTeamsModal.jsx'))
};

const pageOf = () => PAGES[(window.location.hash || '').toLowerCase()] || null;

export default function AdminPages() {
  const [Page, setPage] = useState(pageOf);
  useEffect(() => {
    // Kept once loaded: each page follows the hash itself to close.
    const onHashChange = () => setPage((current) => pageOf() || current);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return Page ? (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  ) : null;
}
