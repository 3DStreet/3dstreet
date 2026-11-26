/**
 * StaffTeamsModal: the staff page for teams (docs/orgs.md#staff-page),
 * opened from the URL hash:
 *
 *   https://3dstreet.app/#admin/teams
 *
 * Lists every team with its terms, contract and wallet, and lets staff create
 * a team, change its terms (plan, seats or site license, storage, domains,
 * status), its contract (billing, price, paid-through, contacts, notes) and
 * its token budget, add tokens and record payments. Every change goes through
 * a staff-only callable (orgCreate, orgUpdate, orgUpdateContract,
 * orgUpdateWallet, orgRecordPayment); the admin claim check here only hides
 * the page. Staff-only, so its text is English and not in the i18n catalogs.
 */

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@shared/services/firebase';
import Modal from '@shared/components/Modal/Modal.jsx';
import { Button } from '@shared/components/Button';

const HASH = '#admin/teams';
const isOpenHash = () => (window.location.hash || '').toLowerCase() === HASH;
const call = async (name, data) =>
  (await httpsCallable(functions, name)(data)).data;

const S = {
  page: { width: 860, maxWidth: '100%', color: '#e5e7eb', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: 16 },
  th: {
    textAlign: 'left',
    color: '#9ca3af',
    fontWeight: 500,
    padding: '4px 6px',
    borderBottom: '1px solid #333'
  },
  td: { padding: '6px', borderBottom: '1px solid #262626' },
  card: {
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    background: '#1b1b1b'
  },
  h: { fontSize: 14, fontWeight: 600, margin: '0 0 8px' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
    gap: 8,
    marginBottom: 8
  },
  label: { display: 'flex', flexDirection: 'column', gap: 2, color: '#9ca3af' },
  input: {
    background: '#111',
    color: '#e5e7eb',
    border: '1px solid #333',
    borderRadius: 4,
    padding: '4px 6px'
  },
  muted: { color: '#9ca3af' },
  error: { color: '#fca5a5' },
  ok: { color: '#86efac' }
};

// Dates travel as ms; inputs use YYYY-MM-DD (UTC).
const toDay = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
const fromDay = (day) => (day ? Date.parse(`${day}T00:00:00Z`) : null);
const money = (cents, currency = 'usd') =>
  `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${currency.toUpperCase()}`;
const toCents = (text) => Math.round(Number(text) * 100);
const domainsOf = (text) =>
  text
    .split(/[\s,;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
// An empty field is "not set": null.
const numberOrNull = (text) => (text === '' ? null : Number(text));

function Field({ label, children }) {
  return (
    <label style={S.label}>
      {label}
      {children}
    </label>
  );
}

function Input({ value, onChange, type = 'text' }) {
  const checkbox = type === 'checkbox';
  return (
    <input
      style={S.input}
      type={type}
      {...(checkbox ? { checked: !!value } : { value: value ?? '' })}
      onChange={(e) => onChange(checkbox ? e.target.checked : e.target.value)}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      style={S.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** A card with a form: runs `onSave`, then reports and reloads. */
function Section({ title, onSave, saveLabel = 'Save', reload, children }) {
  const [state, setState] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await onSave();
      setState({ ok: 'Saved.' });
      await reload();
    } catch (error) {
      setState({ error: error.message || String(error) });
    }
  };
  return (
    <form style={S.card} onSubmit={submit}>
      <h3 style={S.h}>{title}</h3>
      {children}
      <Button type="submit" disabled={state?.busy}>
        {saveLabel}
      </Button>{' '}
      {state?.ok && <span style={S.ok}>{state.ok}</span>}
      {state?.error && <span style={S.error}>{state.error}</span>}
    </form>
  );
}

function TermsSection({ team, reload }) {
  const [terms, setTerms] = useState({
    name: team.name,
    plan: team.plan,
    license: team.siteLicense ? 'site license' : 'seats',
    seats: team.seats ?? '',
    storageLimitGb: team.storageLimitGb ?? '',
    domains: (team.domains || []).join(', '),
    status: team.status
  });
  const set = (key) => (value) => setTerms((t) => ({ ...t, [key]: value }));
  const save = () => {
    const next = {
      name: terms.name,
      plan: terms.plan,
      siteLicense: terms.license === 'site license',
      seats: numberOrNull(terms.seats),
      storageLimitGb: numberOrNull(terms.storageLimitGb),
      domains: domainsOf(terms.domains),
      status: terms.status
    };
    const before = {
      name: team.name,
      plan: team.plan,
      siteLicense: !!team.siteLicense,
      seats: team.seats ?? null,
      storageLimitGb: team.storageLimitGb ?? null,
      domains: team.domains || [],
      status: team.status
    };
    // Only what changed: the server checks the combination.
    const patch = Object.fromEntries(
      Object.entries(next).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])
      )
    );
    // Going back to seats needs a count; a site license keeps its old one.
    if (next.siteLicense && patch.seats === null) delete patch.seats;
    if (!Object.keys(patch).length) return Promise.resolve();
    return call('orgUpdate', { orgId: team.orgId, patch });
  };
  return (
    <Section title="Terms" onSave={save} reload={reload}>
      <div style={S.grid}>
        <Field label="Name">
          <Input value={terms.name} onChange={set('name')} />
        </Field>
        <Field label="Plan">
          <Select
            value={terms.plan}
            onChange={set('plan')}
            options={['PRO', 'MAX']}
          />
        </Field>
        <Field label="License">
          <Select
            value={terms.license}
            onChange={set('license')}
            options={['seats', 'site license']}
          />
        </Field>
        {terms.license === 'seats' && (
          <Field label="Seats">
            <Input type="number" value={terms.seats} onChange={set('seats')} />
          </Field>
        )}
        <Field label="Storage limit, GB (empty = per seat)">
          <Input
            type="number"
            value={terms.storageLimitGb}
            onChange={set('storageLimitGb')}
          />
        </Field>
        <Field label="Domains (join automatically)">
          <Input value={terms.domains} onChange={set('domains')} />
        </Field>
        <Field label="Status">
          <Select
            value={terms.status}
            onChange={set('status')}
            options={['active', 'suspended']}
          />
        </Field>
      </div>
      {terms.license === 'site license' && !team.siteLicense && (
        <p style={S.muted}>
          A site license needs a storage limit and its own token budget (set it
          under Tokens first).
        </p>
      )}
    </Section>
  );
}

function ContractSection({ team, reload }) {
  const c = team.contract || {};
  const [form, setForm] = useState({
    billingSource: c.billingSource || 'invoice',
    price: c.price ? String(c.price.amount / 100) : '',
    currency: c.price?.currency || 'usd',
    interval: c.price?.interval || 'year',
    paidThrough: toDay(c.paidThrough),
    autoRenew: c.autoRenew ?? false,
    contactName: c.billingContact?.name || '',
    contactEmail: c.billingContact?.email || '',
    invoiceReference: c.invoiceReference || '',
    notes: c.notes || ''
  });
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const save = () =>
    call('orgUpdateContract', {
      orgId: team.orgId,
      patch: {
        billingSource: form.billingSource,
        price:
          form.price === ''
            ? null
            : {
                amount: toCents(form.price),
                currency: form.currency.trim().toLowerCase(),
                interval: form.interval
              },
        paidThrough: fromDay(form.paidThrough),
        autoRenew: form.autoRenew,
        billingContact: form.contactEmail.trim()
          ? { name: form.contactName, email: form.contactEmail }
          : null,
        invoiceReference: form.invoiceReference || null,
        notes: form.notes || null
      }
    });
  return (
    <Section title="Contract" onSave={save} reload={reload}>
      <div style={S.grid}>
        <Field label="Billing">
          <Select
            value={form.billingSource}
            onChange={set('billingSource')}
            options={['invoice', 'stripe', 'comp']}
          />
        </Field>
        <Field label="Agreed price (empty = published)">
          <Input type="number" value={form.price} onChange={set('price')} />
        </Field>
        <Field label="Currency">
          <Input value={form.currency} onChange={set('currency')} />
        </Field>
        <Field label="Per">
          <Select
            value={form.interval}
            onChange={set('interval')}
            options={['year', 'month']}
          />
        </Field>
        <Field label="Paid through">
          <Input
            type="date"
            value={form.paidThrough}
            onChange={set('paidThrough')}
          />
        </Field>
        <Field label="Auto-renew">
          <Input
            type="checkbox"
            value={form.autoRenew}
            onChange={set('autoRenew')}
          />
        </Field>
        <Field label="Billing contact name">
          <Input value={form.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Billing contact email">
          <Input value={form.contactEmail} onChange={set('contactEmail')} />
        </Field>
        <Field label="Invoice / PO reference">
          <Input
            value={form.invoiceReference}
            onChange={set('invoiceReference')}
          />
        </Field>
      </div>
      <Field label="Notes (staff only)">
        <textarea
          style={{ ...S.input, minHeight: 50, marginBottom: 8 }}
          value={form.notes}
          onChange={(e) => set('notes')(e.target.value)}
        />
      </Field>
    </Section>
  );
}

function TokensSection({ team, reload }) {
  const w = team.wallet || {};
  const [budget, setBudget] = useState(String(w.monthlyTokenBudget ?? ''));
  const [addTokens, setAddTokens] = useState('');
  const save = () =>
    call('orgUpdateWallet', {
      orgId: team.orgId,
      monthlyTokenBudget:
        budget === '' || Number(budget) === w.monthlyTokenBudget
          ? null
          : Number(budget),
      addTokens: addTokens === '' ? null : Number(addTokens)
    }).then(() => setAddTokens(''));
  const resetBudget = async () => {
    await call('orgUpdateWallet', {
      orgId: team.orgId,
      monthlyTokenBudget: 'default'
    });
    await reload();
  };
  return (
    <Section title="Tokens" onSave={save} reload={reload}>
      <p style={S.muted}>
        Balance {w.genToken ?? 0}. Budget {w.monthlyTokenBudget ?? 0}/month
        {w.customBudget ? ' (custom)' : ' (follows plan and seats)'}. Limit per
        member:{' '}
        {w.memberMonthlyCap == null ? 'none' : `${w.memberMonthlyCap}/month`}{' '}
        (set by the team&apos;s owners).
      </p>
      <div style={S.grid}>
        <Field label="Monthly budget">
          <Input type="number" value={budget} onChange={setBudget} />
        </Field>
        <Field label="Add tokens now">
          <Input type="number" value={addTokens} onChange={setAddTokens} />
        </Field>
      </div>
      {w.customBudget && !team.siteLicense && (
        <p>
          <Button type="button" variant="toolbtn" onClick={resetBudget}>
            Budget back to plan and seats
          </Button>
        </p>
      )}
    </Section>
  );
}

function PaymentSection({ team, reload }) {
  const currency = team.contract?.price?.currency || 'usd';
  const [form, setForm] = useState(() => ({
    amount: '',
    paidAt: toDay(Date.now()),
    paidThrough: '',
    reference: ''
  }));
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const save = () =>
    call('orgRecordPayment', {
      orgId: team.orgId,
      payment: {
        amount: toCents(form.amount),
        currency,
        paidAt: fromDay(form.paidAt),
        paidThrough: fromDay(form.paidThrough),
        reference: form.reference || null
      }
    });
  return (
    <Section
      title="Record a payment"
      saveLabel="Record payment"
      onSave={save}
      reload={reload}
    >
      <p style={S.muted}>
        Extends paid-through (never shortens it) and reactivates a suspended
        team.
      </p>
      <div style={S.grid}>
        <Field label={`Amount (${currency.toUpperCase()})`}>
          <Input type="number" value={form.amount} onChange={set('amount')} />
        </Field>
        <Field label="Paid on">
          <Input type="date" value={form.paidAt} onChange={set('paidAt')} />
        </Field>
        <Field label="Covers through">
          <Input
            type="date"
            value={form.paidThrough}
            onChange={set('paidThrough')}
          />
        </Field>
        <Field label="Reference">
          <Input value={form.reference} onChange={set('reference')} />
        </Field>
      </div>
      {team.payments?.length > 0 && (
        <table style={S.table}>
          <tbody>
            {team.payments.map((p) => (
              <tr key={p.id}>
                <td style={S.td}>{toDay(p.paidAt)}</td>
                <td style={S.td}>{money(p.amount, p.currency)}</td>
                <td style={S.td}>through {toDay(p.paidThrough)}</td>
                <td style={S.td}>{p.reference || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function CreateTeam({ onCreated }) {
  const [form, setForm] = useState({
    name: '',
    plan: 'PRO',
    license: 'seats',
    seats: '5',
    monthlyTokenBudget: '',
    storageLimitGb: '',
    ownerEmail: '',
    domains: ''
  });
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const site = form.license === 'site license';
  const save = async () => {
    const result = await call('orgCreate', {
      name: form.name,
      plan: form.plan,
      ownerEmail: form.ownerEmail,
      domains: domainsOf(form.domains),
      siteLicense: site,
      seats: site ? null : Number(form.seats),
      monthlyTokenBudget: numberOrNull(form.monthlyTokenBudget),
      storageLimitGb: numberOrNull(form.storageLimitGb)
    });
    onCreated(result.orgId);
  };
  return (
    <Section
      title="New team"
      saveLabel="Create team"
      onSave={save}
      reload={async () => {}}
    >
      <div style={S.grid}>
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Owner email (invited if no account)">
          <Input value={form.ownerEmail} onChange={set('ownerEmail')} />
        </Field>
        <Field label="Plan">
          <Select
            value={form.plan}
            onChange={set('plan')}
            options={['PRO', 'MAX']}
          />
        </Field>
        <Field label="License">
          <Select
            value={form.license}
            onChange={set('license')}
            options={['seats', 'site license']}
          />
        </Field>
        {!site && (
          <Field label="Seats">
            <Input type="number" value={form.seats} onChange={set('seats')} />
          </Field>
        )}
        <Field
          label={`Monthly token budget${site ? '' : ' (empty = per seat)'}`}
        >
          <Input
            type="number"
            value={form.monthlyTokenBudget}
            onChange={set('monthlyTokenBudget')}
          />
        </Field>
        <Field label={`Storage limit, GB${site ? '' : ' (empty = per seat)'}`}>
          <Input
            type="number"
            value={form.storageLimitGb}
            onChange={set('storageLimitGb')}
          />
        </Field>
        <Field label="Domains (join automatically)">
          <Input value={form.domains} onChange={set('domains')} />
        </Field>
      </div>
    </Section>
  );
}

export default function StaffTeamsModal() {
  const [open, setOpen] = useState(isOpenHash);
  const [isAdmin, setIsAdmin] = useState(null); // null = checking
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // orgId, or 'new'

  useEffect(() => {
    const onHashChange = () => setOpen(isOpenHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setIsAdmin(null);
    return auth.onAuthStateChanged(async (user) => {
      const token = await user?.getIdTokenResult().catch(() => null);
      setIsAdmin(token?.claims.admin === true);
    });
  }, [open]);

  const load = useCallback(async () => {
    try {
      setTeams((await call('orgListTeams', {})).teams);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (open && isAdmin) load();
  }, [open, isAdmin, load]);

  const close = () => {
    setOpen(false);
    if (isOpenHash()) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  };

  if (!open) return null;
  const team = teams?.find((t) => t.orgId === selected);

  return (
    <Modal isOpen={open} onClose={close} title="Teams (staff)">
      <div style={S.page}>
        {isAdmin === null && <p>Checking access…</p>}
        {isAdmin === false && (
          <p style={S.muted}>Staff only. Sign in with an admin account.</p>
        )}
        {isAdmin && (
          <>
            {error && <p style={S.error}>{error}</p>}
            {!teams && !error && <p>Loading…</p>}
            {teams && (
              <table style={S.table}>
                <thead>
                  <tr>
                    {[
                      'Team',
                      'Plan',
                      'License',
                      'Members',
                      'Status',
                      'Billing',
                      'Paid through'
                    ].map((h) => (
                      <th key={h} style={S.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr
                      key={t.orgId}
                      onClick={() => setSelected(t.orgId)}
                      style={{
                        cursor: 'pointer',
                        background: t.orgId === selected ? '#262a33' : undefined
                      }}
                    >
                      <td style={S.td}>{t.name}</td>
                      <td style={S.td}>{t.plan}</td>
                      <td style={S.td}>
                        {t.siteLicense ? 'site' : `${t.seats} seats`}
                      </td>
                      <td style={S.td}>{t.memberCount}</td>
                      <td
                        style={{
                          ...S.td,
                          ...(t.status !== 'active' ? S.error : {})
                        }}
                      >
                        {t.status}
                      </td>
                      <td style={S.td}>{t.contract?.billingSource || '—'}</td>
                      <td style={S.td}>
                        {toDay(t.contract?.paidThrough) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p>
              <Button variant="toolbtn" onClick={() => setSelected('new')}>
                New team
              </Button>
            </p>
            {selected === 'new' && (
              <CreateTeam
                onCreated={async (orgId) => {
                  await load();
                  setSelected(orgId);
                }}
              />
            )}
            {/* Keyed so another team's forms start from its values. */}
            {team && (
              <div key={team.orgId}>
                <p style={S.muted}>
                  {team.orgId} · created {toDay(team.createdAt)}
                </p>
                <TermsSection team={team} reload={load} />
                <ContractSection team={team} reload={load} />
                <TokensSection team={team} reload={load} />
                <PaymentSection team={team} reload={load} />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
