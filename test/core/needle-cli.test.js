/* global describe, it */

/**
 * needle-uploader's parsing of the needle-cloud CLI (pinned 2.7.0). The
 * worker's correctness hinges on reading the served URL and content id out
 * of the CLI's output, so the shapes it accepts are pinned here.
 */

const assert = require('assert');
const cli = require('../../needle-uploader/needle-cli.js');

const WORLD_URL =
  'https://cloud.needle.tools/-/assets/Zp9qu81CtVaR-1CtVaR-world/file';

describe('needle-cli parseEditContentId', () => {
  it('reads the content id from the optimize success line', () => {
    const out =
      '✔ Your asset has finished optimizing: done\n' +
      '✔ Asset successfully optimized: https://cloud.needle.tools/edit/Zp9qu81CtVaR (To download optimized files, use the --outdir option)\n';
    assert.strictEqual(cli.parseEditContentId(out), 'Zp9qu81CtVaR');
  });

  it('returns null when there is no edit URL', () => {
    assert.strictEqual(
      cli.parseEditContentId('✖ Optimization failed: bad'),
      null
    );
    assert.strictEqual(cli.parseEditContentId(''), null);
    assert.strictEqual(cli.parseEditContentId(undefined), null);
  });
});

describe('needle-cli parseListJson', () => {
  it('finds the JSON array after the spinner line', () => {
    const out =
      '✔ Found 1 of 1 items\n' +
      JSON.stringify(
        [{ identifier: 'abc', title: 'asset1', url: WORLD_URL }],
        null,
        2
      ) +
      '\n';
    const items = cli.parseListJson(out);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].identifier, 'abc');
  });

  it('returns [] for no array, malformed JSON or a non-array', () => {
    assert.deepStrictEqual(cli.parseListJson('✖ No content found'), []);
    assert.deepStrictEqual(cli.parseListJson('[{ broken'), []);
    assert.deepStrictEqual(cli.parseListJson('{"a":[1]}'), []);
    assert.deepStrictEqual(cli.parseListJson(null), []);
  });
});

describe('needle-cli pickListing', () => {
  const items = [
    {
      identifier: 'idA',
      title: 'asset1',
      url: 'https://cloud.needle.tools/a',
      created_at: '2026-09-01T00:00:00Z'
    },
    {
      identifier: 'idB',
      title: 'asset10',
      url: 'https://cloud.needle.tools/b',
      created_at: '2026-09-02T00:00:00Z'
    },
    {
      identifier: 'idC',
      title: 'asset1',
      url: 'https://cloud.needle.tools/c',
      created_at: '2026-09-03T00:00:00Z'
    }
  ];

  it('prefers the identifier parsed from the CLI output', () => {
    assert.strictEqual(
      cli.pickListing(items, { contentId: 'idB', name: 'asset1' }).identifier,
      'idB'
    );
  });

  it('falls back to an exact title match, newest first on duplicates', () => {
    assert.strictEqual(
      cli.pickListing(items, { contentId: null, name: 'asset1' }).identifier,
      'idC'
    );
    // --search is a substring match; 'asset1' must not pick 'asset10'.
    assert.strictEqual(
      cli.pickListing([items[1]], { contentId: null, name: 'asset1' }),
      null
    );
  });

  it('returns null for an empty listing', () => {
    assert.strictEqual(cli.pickListing([], { name: 'x' }), null);
    assert.strictEqual(cli.pickListing(undefined, { name: 'x' }), null);
  });
});

describe('needle-cli servedUrlOf', () => {
  it('accepts an https URL and rejects anything else', () => {
    assert.strictEqual(cli.servedUrlOf({ url: WORLD_URL }), WORLD_URL);
    assert.strictEqual(cli.servedUrlOf({ url: ` ${WORLD_URL} ` }), WORLD_URL);
    assert.strictEqual(cli.servedUrlOf({ url: 'http://x' }), null);
    assert.strictEqual(cli.servedUrlOf({}), null);
    assert.strictEqual(cli.servedUrlOf(null), null);
  });
});

describe('needle-cli argument builders', () => {
  it('optimize passes token, team, progressive, usecase and name explicitly', () => {
    assert.deepStrictEqual(
      cli.optimizeArgs({
        file: '/tmp/a.glb',
        token: 'T',
        team: 'team1',
        name: 'asset1'
      }),
      [
        'optimize',
        '/tmp/a.glb',
        '--token',
        'T',
        '--team',
        'team1',
        '--progressive',
        'true',
        '--usecase',
        'world',
        '--name',
        'asset1'
      ]
    );
    // Team is optional (the token's default team applies).
    assert.ok(
      !cli.optimizeArgs({ file: 'f', token: 'T', name: 'n' }).includes('--team')
    );
  });

  it('list filters to 3d assets, searches by name and asks for JSON', () => {
    const args = cli.listArgs({ token: 'T', search: 'asset1' });
    assert.deepStrictEqual(args.slice(0, 1), ['list']);
    assert.ok(
      args.includes('--type') && args[args.indexOf('--type') + 1] === '3d-asset'
    );
    assert.ok(args[args.indexOf('--search') + 1] === 'asset1');
    assert.ok(args[args.indexOf('--output') + 1] === 'json');
  });

  it('delete takes the identifier first', () => {
    assert.deepStrictEqual(
      cli.deleteArgs({ token: 'T', team: 't', identifier: 'idA' }),
      ['delete', 'idA', '--token', 'T', '--team', 't']
    );
  });

  it('redact strips the token from logs', () => {
    assert.strictEqual(
      cli.redact('--token SECRET ok SECRET', 'SECRET'),
      '--token [redacted] ok [redacted]'
    );
    assert.strictEqual(cli.redact('x', ''), 'x');
  });
});
