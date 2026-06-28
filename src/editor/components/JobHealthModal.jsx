/**
 * JobHealthModal — an admin-only "System Health" view for our scheduled
 * background jobs, opened from the URL hash:
 *
 *   https://3dstreet.app/#admin/health
 *
 * Each scheduled Cloud Function records a heartbeat to `jobHealth/{jobName}` via
 * the job-health wrapper (public/functions/scheduled/job-health.js). This page
 * reads those docs live and shows a green / yellow / red light per job, the last
 * run time, the run summary, and recent history — so the answer to "is everything
 * running?" is one glance, and the raw JSON is right there to hand to an LLM when
 * something is red.
 *
 * Gating is by the Firebase `admin` custom claim (same claim the trigger*
 * callables check). Firestore rules also restrict `jobHealth` reads to admins, so
 * this is defense-in-depth, not the only guard.
 *
 * Red comes from two places: the job recorded `status: 'red'` (it threw), or the
 * heartbeat is *stale* — lastRunAt is older than 2x its expected interval, which
 * means the schedule itself isn't firing (the failure a log line can't show you).
 */

import { useState, useEffect, useMemo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth } from '@shared/services/firebase';
import Modal from '@shared/components/Modal/Modal.jsx';

const HASH = '#admin/health';

// The jobs we expect to report. Listing them here lets the page flag a job that
// has *never* written a heartbeat (a deploy/wiring problem) instead of silently
// omitting it. label/cadence are display-only; the live doc is source of truth.
const EXPECTED_JOBS = [
  {
    id: 'reconcileGenerationJobs',
    label: 'Generation job reconciler',
    cadence: 'every 10 min'
  },
  { id: 'sendScheduledEmails', label: 'Scheduled emails', cadence: 'daily' },
  {
    id: 'purgeSoftDeletedAssets',
    label: 'Asset GC (purge soft-deleted)',
    cadence: 'weekly'
  },
  {
    id: 'reconcileAssetUsage',
    label: 'Asset usage reconcile',
    cadence: 'weekly'
  },
  {
    id: 'checkAssetUsageHealth',
    label: 'Storage usage health',
    cadence: 'daily'
  },
  {
    id: 'cleanupOrphanedStorage',
    label: 'Orphaned storage cleanup',
    cadence: 'monthly'
  }
];

const COLORS = {
  green: '#16a34a',
  yellow: '#d4a017',
  red: '#dc2626',
  gray: '#9ca3af'
};

function parseHash() {
  return (window.location.hash || '').toLowerCase() === HASH;
}

function toDate(ts) {
  // Firestore Timestamp → Date (tolerate already-Date or {seconds} shapes).
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return null;
}

function timeAgo(date) {
  if (!date) return 'never';
  const ms = Date.now() - date.getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Effective status folds in staleness: a heartbeat older than 2x its expected
// interval means the schedule isn't firing, which is red regardless of the last
// recorded status.
function effectiveStatus(data) {
  if (!data) return { status: 'gray', note: 'No heartbeat reported yet' };
  const lastRun = toDate(data.lastRunAt);
  const interval = data.expectedIntervalMs;
  if (lastRun && interval && Date.now() - lastRun.getTime() > interval * 2) {
    return {
      status: 'red',
      note: `Stale — last ran ${timeAgo(lastRun)} (expected ~every ${Math.round(
        interval / 60000
      )} min)`
    };
  }
  return { status: data.status || 'gray', note: data.message || '' };
}

function StatusDot({ status }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: COLORS[status] || COLORS.gray,
        flex: '0 0 auto'
      }}
    />
  );
}

function JobRow({ job, data }) {
  const [expanded, setExpanded] = useState(false);
  const { status, note } = effectiveStatus(data);
  const lastRun = toDate(data?.lastRunAt);
  const recent = data?.recentRuns || [];

  return (
    <div
      style={{
        border: '1px solid #2a2a2a',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 8,
        background: '#1b1b1b'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer'
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <StatusDot status={status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{job.label}</div>
          <div style={{ fontSize: 12, color: '#9ca3af' }}>
            {job.cadence} · {note || '—'}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>
          {lastRun ? timeAgo(lastRun) : 'never'}
          {typeof data?.durationMs === 'number'
            ? ` · ${Math.round(data.durationMs / 100) / 10}s`
            : ''}
        </div>
        <span style={{ color: '#6b7280', fontSize: 12 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, fontSize: 12 }}>
          {data?.error && (
            <pre
              style={{
                color: '#fca5a5',
                background: '#2a1414',
                padding: 8,
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 180,
                overflow: 'auto'
              }}
            >
              {data.error}
            </pre>
          )}

          <div style={{ color: '#9ca3af', marginBottom: 4 }}>
            <FormattedMessage
              id="jobHealthModal.lastRunSummary"
              defaultMessage="Last run summary"
            />
          </div>
          <pre
            style={{
              background: '#111',
              padding: 8,
              borderRadius: 6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 220,
              overflow: 'auto'
            }}
          >
            {JSON.stringify(data?.summary ?? null, null, 2)}
          </pre>

          {recent.length > 0 && (
            <>
              <div style={{ color: '#9ca3af', margin: '10px 0 4px' }}>
                <FormattedMessage
                  id="jobHealthModal.recentRuns"
                  defaultMessage="Recent runs"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {recent.map((r, i) => (
                  <div
                    key={i}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <StatusDot status={r.status} />
                    <span style={{ color: '#9ca3af', width: 90 }}>
                      {timeAgo(toDate(r.runAt))}
                    </span>
                    <span style={{ color: '#9ca3af' }}>
                      {typeof r.durationMs === 'number'
                        ? `${Math.round(r.durationMs / 100) / 10}s`
                        : ''}
                    </span>
                    <span style={{ color: '#6b7280', flex: 1, minWidth: 0 }}>
                      {r.error || r.message || ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function JobHealthModal() {
  const intl = useIntl();
  const [open, setOpen] = useState(parseHash);
  const [isAdmin, setIsAdmin] = useState(null); // null = checking
  const [docs, setDocs] = useState({}); // jobName -> data
  const [error, setError] = useState(null);

  useEffect(() => {
    const onHashChange = () => setOpen(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Resolve the admin claim whenever the modal opens (re-check on auth change).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const check = async (user) => {
      if (!user) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      try {
        const token = await user.getIdTokenResult();
        if (!cancelled) setIsAdmin(token.claims.admin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    };
    setIsAdmin(null);
    check(auth.currentUser);
    const unsub = auth.onAuthStateChanged(check);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [open]);

  // Live-subscribe to the heartbeat collection once we know the user is admin.
  useEffect(() => {
    if (!open || isAdmin !== true) return;
    const unsub = onSnapshot(
      collection(db, 'jobHealth'),
      (snap) => {
        const next = {};
        snap.forEach((d) => {
          next[d.id] = d.data();
        });
        setDocs(next);
        setError(null);
      },
      (err) => setError(err.message || String(err))
    );
    return () => unsub();
  }, [open, isAdmin]);

  const overall = useMemo(() => {
    const statuses = EXPECTED_JOBS.map(
      (j) => effectiveStatus(docs[j.id]).status
    );
    if (statuses.includes('red')) return 'red';
    if (statuses.includes('yellow')) return 'yellow';
    if (statuses.includes('gray')) return 'gray';
    return 'green';
  }, [docs]);

  const handleClose = () => {
    setOpen(false);
    if (parseHash()) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  };

  if (!open) return null;

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title={intl.formatMessage({
        id: 'jobHealthModal.title',
        defaultMessage: 'System Health'
      })}
    >
      <div style={{ width: 560, maxWidth: '100%', color: '#e5e7eb' }}>
        {isAdmin === null && (
          <p>
            <FormattedMessage
              id="jobHealthModal.checkingAccess"
              defaultMessage="Checking access…"
            />
          </p>
        )}
        {isAdmin === false && (
          <p style={{ color: '#9ca3af' }}>
            <FormattedMessage
              id="jobHealthModal.adminsOnly"
              defaultMessage="Admins only. Sign in with an admin account to view background-job health."
            />
          </p>
        )}
        {isAdmin === true && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14
              }}
            >
              <StatusDot status={overall} />
              <strong>
                {overall === 'green' && (
                  <FormattedMessage
                    id="jobHealthModal.overallGreen"
                    defaultMessage="All background jobs healthy"
                  />
                )}
                {overall === 'yellow' && (
                  <FormattedMessage
                    id="jobHealthModal.overallYellow"
                    defaultMessage="Some jobs ran with issues"
                  />
                )}
                {overall === 'red' && (
                  <FormattedMessage
                    id="jobHealthModal.overallRed"
                    defaultMessage="Attention needed"
                  />
                )}
                {overall === 'gray' && (
                  <FormattedMessage
                    id="jobHealthModal.overallGray"
                    defaultMessage="Awaiting first heartbeats"
                  />
                )}
              </strong>
            </div>

            {error && (
              <p style={{ color: '#fca5a5' }}>
                <FormattedMessage
                  id="jobHealthModal.failedToLoad"
                  defaultMessage="Failed to load: {error}"
                  values={{ error }}
                />
              </p>
            )}

            {EXPECTED_JOBS.map((job) => (
              <JobRow key={job.id} job={job} data={docs[job.id]} />
            ))}

            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 12 }}>
              <FormattedMessage
                id="jobHealthModal.footerNote"
                defaultMessage="Heartbeats are written on each scheduled run. A red row that says “stale” means the schedule isn’t firing. Expand a row to copy its summary/error for diagnosis."
              />
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
