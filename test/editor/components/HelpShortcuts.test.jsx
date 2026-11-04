import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { Shortcuts } from '@/editor/components/modals/ModalHelp/components/Shortcuts';

vi.mock('@/editor/lib/nav-experimental/flag.js', () => ({
  isWasdNav: () => false
}));
vi.mock(
  '@/editor/components/modals/ModalHelp/components/DocumentationButton',
  () => ({ DocumentationButton: () => null })
);

function rowKeys() {
  const view = render(
    <IntlProvider locale="en">
      <Shortcuts />
    </IntlProvider>
  );
  return [...view.container.querySelectorAll('li')].map((row) => ({
    keys: [...row.querySelectorAll('kbd')].map((kbd) => kbd.textContent),
    text: row.textContent
  }));
}

describe('help window shortcuts', () => {
  it('lists m as the one key that cycles the move tools', () => {
    const rows = rowKeys();
    const cycle = rows.find((row) => row.keys.join() === 'm');
    expect(cycle?.text).toContain('Cycle move tools');
  });

  it('lists no t, w or e key', () => {
    const singleKeys = rowKeys()
      .filter((row) => row.keys.length === 1)
      .map((row) => row.keys[0]);
    for (const letter of ['t', 'w', 'e']) {
      expect(singleKeys).not.toContain(letter);
    }
  });
});
