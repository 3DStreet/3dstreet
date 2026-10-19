/* global STREET */
import PropTypes from 'prop-types';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import { Button } from '../elements';
import useStore from '@/store.js';
import {
  convertStreetValues,
  streetmixUserToAPI
} from '../../../tested/streetmix-utils.js';
import {
  getLegacyStreetmixURL,
  getLegacyStreetWidth
} from '../../lib/commands/StreetConvertToManagedCommand.js';

// Notice + "Convert to managed street" CTA on a legacy `street` /
// `streetmix-loader` street (#1720 §4). Conversion re-fetches from Streetmix,
// and about a third of saved legacy streets have since changed width there,
// so the user confirms only when the fetched width differs from the saved one.
const LegacyStreetNotice = ({ entity }) => {
  const intl = useIntl();
  const showConfirm = useStore((state) => state.showConfirm);
  const [busy, setBusy] = useState(false);
  const streetmixURL = getLegacyStreetmixURL(entity);

  const convert = () => {
    AFRAME.INSPECTOR.execute('streetconverttomanaged', { entity });
    posthog.capture('legacy_street_converted', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
  };

  const onConvert = async () => {
    setBusy(true);
    let fetchedWidth;
    try {
      const response = await fetch(streetmixUserToAPI(streetmixURL));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      // The parser lays out the segments' summed width, which can differ
      // from Streetmix's declared street width (under/overfilled streets).
      fetchedWidth = convertStreetValues(body.data.street).segments.reduce(
        (sum, segment) => sum + segment.width,
        0
      );
    } catch (error) {
      console.error('[legacy-street] Streetmix fetch failed', error);
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'legacyStreet.fetchFailed',
          defaultMessage:
            'Could not load this street from Streetmix, so it cannot be converted. It may have been deleted.'
        })
      );
      setBusy(false);
      return;
    }
    setBusy(false);

    const savedWidth = getLegacyStreetWidth(entity);
    if (savedWidth === null || Math.abs(fetchedWidth - savedWidth) < 0.05) {
      convert();
      return;
    }
    const fmt = (m) => intl.formatNumber(m, { maximumFractionDigits: 1 });
    showConfirm({
      title: intl.formatMessage({
        id: 'legacyStreet.changedTitle',
        defaultMessage: 'This street has changed on Streetmix'
      }),
      message: intl.formatMessage(
        {
          id: 'legacyStreet.changedMessage',
          defaultMessage:
            'It was {saved} m wide when you added it and is {fetched} m wide on Streetmix now. Converting loads the latest version from Streetmix. You can undo this.'
        },
        { saved: fmt(savedWidth), fetched: fmt(fetchedWidth) }
      ),
      confirmLabel: intl.formatMessage({
        id: 'legacyStreet.convert',
        defaultMessage: 'Convert to managed street'
      }),
      onConfirm: convert
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        margin: '4px 12px 16px',
        padding: '14px 16px',
        borderRadius: '10px',
        background: 'rgba(119, 77, 238, 0.08)',
        border: '1px solid rgba(119, 77, 238, 0.35)'
      }}
    >
      <div style={{ fontWeight: 600, color: '#fff', fontSize: '14px' }}>
        {intl.formatMessage({
          id: 'legacyStreet.title',
          defaultMessage: 'This is a classic street'
        })}
      </div>
      <div style={{ fontSize: '12px', lineHeight: 1.45, color: '#b8b8b8' }}>
        {streetmixURL
          ? intl.formatMessage({
              id: 'legacyStreet.body',
              defaultMessage:
                'Convert it to a managed street to edit its lanes, widths and objects right here. Converting loads this street from Streetmix; objects you moved or changed inside it will not carry over.'
            })
          : intl.formatMessage({
              id: 'legacyStreet.bodyNoSource',
              defaultMessage:
                'It has no Streetmix link, so it cannot be converted. Import the street again from Streetmix to get a managed street you can edit here.'
            })}
      </div>
      {streetmixURL && (
        <Button
          variant="toolbtn"
          disabled={busy}
          style={{
            width: '100%',
            justifyContent: 'center',
            marginTop: '4px',
            fontSize: '13px',
            padding: '10px 16px',
            background: '#774dee',
            border: 'none',
            color: 'white',
            fontWeight: 600
          }}
          onClick={onConvert}
        >
          {busy
            ? intl.formatMessage({
                id: 'legacyStreet.checking',
                defaultMessage: 'Checking Streetmix…'
              })
            : intl.formatMessage({
                id: 'legacyStreet.convert',
                defaultMessage: 'Convert to managed street'
              })}
        </Button>
      )}
    </div>
  );
};

LegacyStreetNotice.propTypes = {
  entity: PropTypes.object.isRequired
};

export default LegacyStreetNotice;
