/* global describe, it */

import assert from 'assert';
import TEMPLATES from '../../public/functions/email/templates.js';
import emailLocale from '../../public/functions/email/locale.js';

const { EMAIL_LOCALES, DEFAULT_EMAIL_LOCALE, normalizeEmailLocale } =
  emailLocale;

// Signature line per locale — every rendered body must carry exactly its own
// locale's chrome, which also catches a copy entry accidentally left in
// English (the whole-template fallback would show the en signature).
const TEAM_SIGNATURE = {
  en: 'The 3DStreet Team',
  es: 'El equipo de 3DStreet',
  'pt-BR': 'A equipe do 3DStreet',
  fr: "L'équipe 3DStreet"
};

// Every lifecycle template must accept (userName, data, locale). planTier
// exercises the one data-dependent template (postUpgradeWelcome).
const DATA = { planTier: 'MAX' };

describe('lifecycle email templates (localization)', function () {
  describe('locale matching (normalizeEmailLocale)', function () {
    it('passes through supported codes and defaults unknowns to en', function () {
      for (const code of EMAIL_LOCALES) {
        assert.strictEqual(normalizeEmailLocale(code), code);
      }
      assert.strictEqual(normalizeEmailLocale(undefined), 'en');
      assert.strictEqual(normalizeEmailLocale(null), 'en');
      assert.strictEqual(normalizeEmailLocale(''), 'en');
      assert.strictEqual(normalizeEmailLocale('de-DE'), 'en');
      assert.strictEqual(normalizeEmailLocale('ja'), 'en');
    });

    it('is region-insensitive, preferring pt-BR for any pt-*', function () {
      assert.strictEqual(normalizeEmailLocale('es-MX'), 'es');
      assert.strictEqual(normalizeEmailLocale('es-419'), 'es');
      assert.strictEqual(normalizeEmailLocale('pt'), 'pt-BR');
      assert.strictEqual(normalizeEmailLocale('pt-PT'), 'pt-BR');
      assert.strictEqual(normalizeEmailLocale('fr-CA'), 'fr');
      assert.strictEqual(normalizeEmailLocale('en-GB'), 'en');
    });
  });

  for (const [name, template] of Object.entries(TEMPLATES)) {
    describe(name, function () {
      for (const locale of EMAIL_LOCALES) {
        it(`renders complete, correctly-localized output in ${locale}`, function () {
          const subject = template.getSubject('Kieran', DATA, locale);
          const html = template.getHtmlBody('Kieran', DATA, locale);
          const text = template.getTextBody('Kieran', DATA, locale);

          assert.ok(subject && subject.length > 5, 'subject');
          assert.ok(html.includes('<!DOCTYPE html>'), 'html doc');
          assert.ok(html.includes(`lang="${locale}"`), 'html lang attribute');
          assert.ok(text && text.length > 50, 'text body');

          // Locale-correct chrome in both bodies.
          assert.ok(html.includes(TEAM_SIGNATURE[locale]), 'html signature');
          assert.ok(text.includes(TEAM_SIGNATURE[locale]), 'text signature');
          for (const [other, sig] of Object.entries(TEAM_SIGNATURE)) {
            if (other !== locale && sig !== TEAM_SIGNATURE[locale]) {
              assert.ok(!text.includes(sig), `no ${other} signature leak`);
            }
          }

          // Personalized greeting, and no interpolation accidents.
          assert.ok(html.includes('Kieran'), 'greeting name in html');
          for (const body of [subject, html, text]) {
            assert.ok(!body.includes('null'), 'no "null" leaked');
            assert.ok(!body.includes('undefined'), 'no "undefined" leaked');
            assert.ok(
              !body.includes('[object Object]'),
              'no object interpolation'
            );
          }

          // CTA links must survive translation with the right utm_content.
          assert.ok(
            html.includes('https://3dstreet.app/?utm_source=email') &&
              html.includes('utm_content=cta_button'),
            'html CTA link'
          );
          assert.ok(
            text.includes('https://3dstreet.app/?utm_source=email') &&
              text.includes('utm_content=cta_link'),
            'text CTA link'
          );
        });
      }

      it('actually differs between en and each translation', function () {
        const en = template.getSubject('Kieran', DATA, 'en');
        for (const locale of EMAIL_LOCALES.filter((l) => l !== 'en')) {
          const localized = template.getSubject('Kieran', DATA, locale);
          assert.notStrictEqual(
            localized,
            en,
            `subject translated (${locale})`
          );
        }
      });

      it('falls back to English for unknown or missing locale', function () {
        const en = template.getSubject('Kieran', DATA, 'en');
        assert.strictEqual(template.getSubject('Kieran', DATA, 'tlh'), en);
        assert.strictEqual(template.getSubject('Kieran', DATA, undefined), en);
      });

      it('handles a missing display name with a neutral localized greeting', function () {
        for (const locale of EMAIL_LOCALES) {
          const html = template.getHtmlBody(null, DATA, locale);
          const text = template.getTextBody(null, DATA, locale);
          assert.ok(!html.includes('null'), `html no "null" (${locale})`);
          assert.ok(!text.includes('null'), `text no "null" (${locale})`);
        }
        assert.ok(
          template.getHtmlBody(null, DATA, 'en').includes('Hi there,'),
          'en neutral greeting'
        );
        assert.ok(
          template.getHtmlBody(null, DATA, 'es').includes('¡Hola!'),
          'es neutral greeting'
        );
      });
    });
  }

  describe('postUpgradeWelcome plan tiers', function () {
    for (const locale of EMAIL_LOCALES) {
      it(`names the purchased tier in ${locale}`, function () {
        const max = TEMPLATES.postUpgradeWelcome.getSubject(
          'K',
          { planTier: 'MAX' },
          locale
        );
        const pro = TEMPLATES.postUpgradeWelcome.getSubject(
          'K',
          { planTier: 'PRO' },
          locale
        );
        assert.ok(max.includes('Max'), 'Max in subject');
        assert.ok(pro.includes('Pro'), 'Pro in subject');
      });
    }
  });

  it('keeps the sweep template-selection markers in the en subjects', function () {
    // scheduledEmails.js dry-run output and the emulator tests key off these.
    assert.ok(
      TEMPLATES.geoTokenExhaustion
        .getSubject(null, {}, DEFAULT_EMAIL_LOCALE)
        .includes('geo tokens')
    );
    assert.ok(
      TEMPLATES.genTokenExhaustion
        .getSubject(null, {}, DEFAULT_EMAIL_LOCALE)
        .includes('AI tokens')
    );
  });
});
