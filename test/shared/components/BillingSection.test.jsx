/**
 * Settings > Usage and billing, Personal: opening the Stripe portal. A plan
 * that isn't billed through Stripe (invoiced, or set by staff) says so, and
 * no failure leaves the button spinning.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntlProvider } from 'react-intl';
import { httpsCallable } from 'firebase/functions';
import { AuthContext } from '@shared/contexts';
import { SettingsHostContext } from '@shared/settings/SettingsHost';
import { BillingSection } from '@shared/settings/sections/BillingSection';

async function clickManage(error) {
  httpsCallable.mockReturnValue(() => Promise.reject(error));
  const notify = vi.fn();
  render(
    <IntlProvider locale="en">
      <AuthContext.Provider
        value={{ currentUser: { uid: 'u', plan: 'PRO', isPro: true } }}
      >
        <SettingsHostContext.Provider value={{ notify, onUpgrade: vi.fn() }}>
          <BillingSection orgId={null} />
        </SettingsHostContext.Provider>
      </AuthContext.Provider>
    </IntlProvider>
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Manage subscription' })
  );
  await waitFor(() => expect(notify).toHaveBeenCalled());
  expect(
    screen.getByRole('button', { name: 'Manage subscription' })
  ).toBeEnabled();
  return notify.mock.calls[0];
}

describe('BillingSection: manage subscription', () => {
  it('says when the plan is not billed through Stripe', async () => {
    const error = Object.assign(new Error('x'), {
      details: { reason: 'no-stripe-customer' }
    });
    expect(await clickManage(error)).toEqual([
      "Your plan isn't billed through Stripe. Contact 3DStreet to change it.",
      'error'
    ]);
  });

  it('asks to try again on any other failure', async () => {
    expect((await clickManage(new Error('offline')))[0]).toBe(
      'Could not open the subscription page. Try again.'
    );
  });
});
