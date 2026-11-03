/* global describe, it */

/**
 * Private geo data sources (docs/geo-sources.md): who may read a source, how
 * source docs are checked, and how Airtable / Sheets data becomes rows.
 */

const assert = require('assert');
const {
  isValidSourceId,
  canReadSource,
  sourceProblem,
  publicSourceInfo,
  airtableRowsFromRecords,
  airtableListUrl,
  sheetRowsFromValues,
  guessFormat
} = require('../../public/functions/geo-sources-utils.js');

const auth = (email, verified = true, uid = 'u1') => ({
  uid,
  token: { email, email_verified: verified }
});

describe('isValidSourceId', () => {
  it('takes short slugs and refuses paths', () => {
    assert.ok(isValidSourceId('block-party_2026'));
    assert.ok(!isValidSourceId(''));
    assert.ok(!isValidSourceId('a/b'));
    assert.ok(!isValidSourceId('../x'));
    assert.ok(!isValidSourceId(42));
    assert.ok(!isValidSourceId('x'.repeat(65)));
  });
});

describe('canReadSource', () => {
  const src = {
    allowedEmails: ['John@Example.org'],
    allowedDomains: ['sfgov.org'],
    allowedUids: ['uid-9']
  };
  it('grants by email, case-insensitively', () => {
    assert.ok(canReadSource(src, auth('john@example.org')));
  });
  it('grants by domain, exactly (no lookalike subdomains)', () => {
    assert.ok(canReadSource(src, auth('ann@sfgov.org')));
    assert.ok(!canReadSource(src, auth('ann@evil-sfgov.org')));
    assert.ok(!canReadSource(src, auth('ann@sfgov.org.evil.com')));
  });
  it('needs a verified email for email and domain grants', () => {
    assert.ok(!canReadSource(src, auth('john@example.org', false)));
    assert.ok(!canReadSource(src, auth('ann@sfgov.org', false)));
  });
  it('grants by uid without an email', () => {
    assert.ok(canReadSource(src, { uid: 'uid-9', token: {} }));
  });
  it('refuses everyone else, the signed-out, and disabled sources', () => {
    assert.ok(!canReadSource(src, auth('someone@else.com')));
    assert.ok(!canReadSource(src, null));
    assert.ok(!canReadSource({ ...src, enabled: false }, auth('john@example.org')));
    assert.ok(!canReadSource({}, auth('john@example.org')));
    assert.ok(!canReadSource(null, auth('john@example.org')));
  });
});

describe('sourceProblem', () => {
  it('accepts well-formed sources', () => {
    assert.strictEqual(sourceProblem({ kind: 'airtable', base: 'appzHWTq3Hzmr12vY', table: 'tblAbc' }), '');
    assert.strictEqual(sourceProblem({ kind: 'gsheet', sheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz' }), '');
    assert.strictEqual(sourceProblem({ kind: 'url', url: 'https://example.org/a.csv' }), '');
  });
  it('names what is wrong', () => {
    assert.match(sourceProblem({ kind: 'ftp' }), /unknown kind/);
    assert.match(sourceProblem({ kind: 'airtable', base: 'nope', table: 't' }), /base/);
    assert.match(sourceProblem({ kind: 'airtable', base: 'appzHWTq3Hzmr12vY' }), /table/);
    assert.match(sourceProblem({ kind: 'gsheet', sheetId: 'x' }), /sheetId/);
    assert.match(sourceProblem({ kind: 'url', url: 'http://example.org/a.csv' }), /https/);
    assert.match(sourceProblem({ kind: 'url', url: 'not a url' }), /not a URL/);
  });
});

describe('publicSourceInfo', () => {
  it('shows the name and description only', () => {
    const info = publicSourceInfo('bp', {
      name: 'Block Party',
      description: 'Airtable',
      base: 'appzHWTq3Hzmr12vY',
      allowedEmails: ['a@b.c']
    });
    assert.deepStrictEqual(info, { id: 'bp', name: 'Block Party', description: 'Airtable' });
    assert.deepStrictEqual(publicSourceInfo('bp', {}), { id: 'bp', name: 'bp' });
  });
});

describe('airtableRowsFromRecords', () => {
  const records = [
    {
      id: 'rec1',
      fields: {
        name: 'Valencia block party',
        district: 9,
        tags: ['music', 'food'],
        Organizer: { id: 'usr1', email: 'x@y.z', name: 'X' },
        Photos: [{ url: 'https://dl.airtable.com/a.jpg', filename: 'a.jpg' }],
        'Contact Email': 'x@y.z',
        Phone: '555',
        status: { name: 'Approved' }
      }
    }
  ];
  it('flattens cells and drops contact fields and files', () => {
    assert.deepStrictEqual(airtableRowsFromRecords(records), [
      { name: 'Valencia block party', district: 9, tags: 'music, food', status: 'Approved', _airtable_id: 'rec1' }
    ]);
  });
  it('keeps a contact field the source lists explicitly', () => {
    const [row] = airtableRowsFromRecords(records, ['Phone']);
    assert.strictEqual(row.Phone, '555');
    assert.ok(!('Contact Email' in row));
  });
});

describe('airtableListUrl', () => {
  it('builds the page URL with view, fields and offset', () => {
    const u = new URL(
      airtableListUrl({ base: 'appzHWTq3Hzmr12vY', table: 'Blocks 2026', view: 'viwX', fields: ['name', 'cnn'] }, 'itr1')
    );
    assert.strictEqual(u.pathname, '/v0/appzHWTq3Hzmr12vY/Blocks%202026');
    assert.strictEqual(u.searchParams.get('view'), 'viwX');
    assert.deepStrictEqual(u.searchParams.getAll('fields[]'), ['name', 'cnn']);
    assert.strictEqual(u.searchParams.get('offset'), 'itr1');
  });
});

describe('sheetRowsFromValues', () => {
  it('uses the first row as headers, pads short rows, skips blank rows', () => {
    const rows = sheetRowsFromValues([
      ['name', '', 'name'],
      ['a', '1'],
      ['', '', ''],
      ['b', '2', 'B']
    ]);
    assert.deepStrictEqual(rows, [
      { name: 'a', 'Column 2': '1', 'name (2)': '' },
      { name: 'b', 'Column 2': '2', 'name (2)': 'B' }
    ]);
    assert.deepStrictEqual(sheetRowsFromValues(undefined), []);
  });
});

describe('guessFormat', () => {
  it('prefers the content type, then sniffs', () => {
    assert.strictEqual(guessFormat('application/geo+json', 'a,b'), 'json');
    assert.strictEqual(guessFormat('text/csv; charset=utf-8', '{"a":1}'), 'csv');
    assert.strictEqual(guessFormat('', ' [{"a":1}]'), 'json');
    assert.strictEqual(guessFormat(null, 'a,b\n1,2'), 'csv');
  });
});
