import PropTypes from 'prop-types';
import { FormattedMessage, useIntl } from 'react-intl';
import StreetCrossSectionStrip from './StreetCrossSectionStrip';
import { getEntityDisplayName } from '../../lib/entity';

/**
 * Header for a generated street clone (#2011): the same visual language as
 * the segment panel. The street's cross-section strip shows which segment
 * placed the clone (that segment's bar is highlighted; a click selects it,
 * "Edit street" selects the street), a footnote names the segment with an
 * "Edit clone settings" pill, and Detach sits beside it as the explicit
 * action, with "Detach all" (#2036) for every clone of the same generator.
 * Everything below is a normal object panel: a clone carries no
 * no-transform marker, and any edit (a transform field, the model dropdown,
 * a gizmo drag, Delete) detaches it through routeCloneEdit.
 */
const CloneSidebarHeader = ({ entity }) => {
  const intl = useIntl();
  const segmentEl = entity.parentElement;
  return (
    <div className="segment-panel clone-panel">
      <StreetCrossSectionStrip entity={segmentEl} />
      <div className="clone-origin">
        <span className="cross-section-summary">
          <FormattedMessage
            id="sidebar.placedBy"
            defaultMessage="Placed by {segment}"
            values={{ segment: getEntityDisplayName(segmentEl) }}
          />
        </span>
        <span className="clone-origin-actions">
          <button
            type="button"
            className="cross-section-edit-street"
            onClick={() => AFRAME.INSPECTOR.selectEntity(segmentEl)}
          >
            <FormattedMessage
              id="sidebar.editCloneSettings"
              defaultMessage="Edit clone settings"
            />
          </button>
          <button
            type="button"
            className="cross-section-edit-street"
            title={intl.formatMessage({
              id: 'sidebar.detachCloneTitle',
              defaultMessage:
                'Make this one object editable on its own: it leaves the generator and becomes a plain model you can move, rotate, duplicate or delete. Dragging it in the viewport does the same.'
            })}
            onClick={() => AFRAME.INSPECTOR.execute('detachclone', { entity })}
          >
            <FormattedMessage
              id="sidebar.detachClone"
              defaultMessage="Detach"
            />
          </button>
          <button
            type="button"
            className="cross-section-edit-street"
            title={intl.formatMessage({
              id: 'sidebar.detachAllClonesTitle',
              defaultMessage:
                'Make every object this generator places editable on its own: each becomes a plain model you can move, rotate, duplicate or delete, and the generator is removed. Undo puts them back.'
            })}
            onClick={() =>
              AFRAME.INSPECTOR.execute('detachallclones', {
                entity: segmentEl,
                component: entity.getAttribute('data-parent-component')
              })
            }
          >
            <FormattedMessage
              id="sidebar.detachAllClones"
              defaultMessage="Detach all"
            />
          </button>
        </span>
      </div>
      <p className="clone-hint">
        <FormattedMessage
          id="sidebar.cloneEditHint"
          defaultMessage="Editing this object detaches it from the generator. Undo puts it back."
        />
      </p>
    </div>
  );
};

CloneSidebarHeader.propTypes = {
  entity: PropTypes.object.isRequired
};

export default CloneSidebarHeader;
