import { useState, useEffect } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import styles from './ExportModal.module.scss';
import { useAuthContext } from '../../../contexts';
import { Button, Checkbox } from '../../elements';
import Modal from '@shared/components/Modal/Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import {
  exportSceneToGLTF,
  exportSceneToJSON,
  exportSceneToDXF
} from '@/editor/lib/exportUtils';

function ExportModal() {
  const intl = useIntl();
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const startCheckout = useStore((state) => state.startCheckout);
  const { currentUser } = useAuthContext();
  const [arReady, setArReady] = useState(false);

  const isPro = currentUser?.isPro;

  useEffect(() => {
    if (modal === 'export') {
      posthog.capture('export_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
  }, [modal]);

  const handleGLBExport = () => {
    posthog.capture('export_modal_export_clicked', {
      export_type: arReady ? 'ar_glb' : 'glb',
      scene_id: STREET.utils.getCurrentSceneId()
    });
    if (!isPro) {
      startCheckout('export');
      return;
    }
    // Close the modal so the blocking export indicator is visible.
    setModal(null);
    exportSceneToGLTF(intl, arReady);
  };

  const handleJSONExport = () => {
    posthog.capture('export_modal_export_clicked', {
      export_type: 'json',
      scene_id: STREET.utils.getCurrentSceneId()
    });
    setModal(null);
    exportSceneToJSON();
  };

  const handleDXFExport = () => {
    posthog.capture('export_modal_export_clicked', {
      export_type: 'dxf',
      scene_id: STREET.utils.getCurrentSceneId()
    });
    if (!isPro) {
      // Dedicated surface so the paywall shows DXF/CAD copy, not GLB.
      startCheckout('export-dxf');
      return;
    }
    // Close the modal so the blocking export indicator is visible.
    setModal(null);
    exportSceneToDXF(intl);
  };

  return (
    <Modal
      className={styles.exportModalWrapper}
      isOpen={modal === 'export'}
      onClose={() => setModal(null)}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">
            <FormattedMessage
              id="exportModal.title"
              defaultMessage="Export Scene"
            />
          </div>
        </div>
      }
    >
      <div className={styles.wrapper}>
        <div className={styles.formatCard}>
          <div className={styles.formatInfo}>
            <h3 className={styles.formatTitle}>
              <FormattedMessage
                id="exportModal.glbTitle"
                defaultMessage="GLB 3D Model"
              />
              {!isPro && (
                <span className="pro-badge">
                  <FormattedMessage
                    id="appMenu.proBadge"
                    defaultMessage="Pro"
                  />
                </span>
              )}
            </h3>
            <p className={styles.formatDescription}>
              <FormattedMessage
                id="exportModal.glbDescription"
                defaultMessage="Download this scene as a .glb 3D model file for use in Blender, Unreal, and other 3D tools."
              />
            </p>
            <Checkbox
              id="export-ar-ready"
              isChecked={arReady}
              onChange={setArReady}
              label={intl.formatMessage({
                id: 'exportModal.arReadyLabel',
                defaultMessage:
                  'AR Ready: omit people, vehicles and geospatial layers for augmented reality apps'
              })}
            />
          </div>
          <Button onClick={handleGLBExport} variant="filled">
            <FormattedMessage
              id="exportModal.download"
              defaultMessage="Download"
            />
          </Button>
        </div>

        <div className={styles.formatCard}>
          <div className={styles.formatInfo}>
            <h3 className={styles.formatTitle}>.3dstreet.json</h3>
            <p className={styles.formatDescription}>
              <FormattedMessage
                id="exportModal.jsonDescription"
                defaultMessage="Download this scene as a .3dstreet.json file to back up your work or import into another 3DStreet account."
              />
            </p>
          </div>
          <Button onClick={handleJSONExport} variant="toolbtn">
            <FormattedMessage
              id="exportModal.download"
              defaultMessage="Download"
            />
          </Button>
        </div>

        <div className={styles.formatCard}>
          <div className={styles.formatInfo}>
            <h3 className={styles.formatTitle}>
              <FormattedMessage
                id="exportModal.dxfTitle"
                defaultMessage="DXF Plan View"
              />
              <span className="beta-badge">
                <FormattedMessage
                  id="appMenu.betaBadge"
                  defaultMessage="Beta"
                />
              </span>
              {!isPro && (
                <span className="pro-badge">
                  <FormattedMessage
                    id="appMenu.proBadge"
                    defaultMessage="Pro"
                  />
                </span>
              )}
            </h3>
            <p className={styles.formatDescription}>
              <FormattedMessage
                id="exportModal.dxfDescription"
                defaultMessage="Download a 2D plan view of this scene's streets as a .dxf file for use in AutoCAD and other CAD tools."
              />
            </p>
          </div>
          <Button onClick={handleDXFExport} variant="toolbtn">
            <FormattedMessage
              id="exportModal.download"
              defaultMessage="Download"
            />
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export { ExportModal };
