import { describe, expect, it } from 'vitest';
import { migrateImplicitStreetAlign } from '../../src/tested/migrate-street-align.js';

const street = (align) => ({
  id: 's',
  components: {
    'managed-street': 'length: 60',
    ...(align === undefined ? {} : { 'street-align': align })
  }
});

describe('migrateImplicitStreetAlign', () => {
  it('stamps the legacy start alignment on a street saved as ""', () => {
    const data = [street('')];
    expect(migrateImplicitStreetAlign(data)).toBe(1);
    expect(data[0].components['street-align']).toBe('length: start');
  });

  it('stamps start when street-align is missing entirely', () => {
    const data = [street(undefined)];
    migrateImplicitStreetAlign(data);
    expect(data[0].components['street-align']).toBe('length: start');
  });

  it('keeps an explicit width and adds the legacy length', () => {
    const data = [street('width: left')];
    migrateImplicitStreetAlign(data);
    expect(data[0].components['street-align']).toBe(
      'width: left; length: start'
    );
  });

  it('leaves an explicit length alone (post-flip files, any value)', () => {
    for (const v of ['length: middle', 'length: end', 'length: start']) {
      const data = [street(v)];
      expect(migrateImplicitStreetAlign(data)).toBe(0);
      expect(data[0].components['street-align']).toBe(v);
    }
  });

  it('handles object-form street-align and preserves the form', () => {
    const data = [street({ width: 'right' })];
    migrateImplicitStreetAlign(data);
    expect(data[0].components['street-align']).toEqual({
      width: 'right',
      length: 'start'
    });
  });

  it('walks nested children and ignores non-street entities', () => {
    const data = [
      {
        id: 'layer',
        components: { position: '0 0 0', 'street-align': '' },
        children: [street(''), { components: { shape: '' } }]
      }
    ];
    expect(migrateImplicitStreetAlign(data)).toBe(1);
    expect(data[0].components['street-align']).toBe('');
    expect(data[0].children[0].components['street-align']).toBe(
      'length: start'
    );
  });

  it('is idempotent', () => {
    const data = [street('')];
    migrateImplicitStreetAlign(data);
    expect(migrateImplicitStreetAlign(data)).toBe(0);
  });
});
