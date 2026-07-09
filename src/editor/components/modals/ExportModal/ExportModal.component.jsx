import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import styles from './ExportModal.module.scss';
import { useAuthContext } from '../../../contexts';
import { Button } from '../../elements';
import Modal from '@shared/components/Modal/Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import {
  exportSceneToGLTF,
  exportSceneToJSON,
  exportSceneToDXF,
  exportSceneToPDF,
  generateGlbBlob
} from '@/editor/lib/exportUtils';
import { buildStreetPlanModel } from '@/editor/lib/plan/planModel';
import { getSceneJsonString } from '@/editor/lib/SceneUtils';
import PlanPreviewSvg from './PlanPreviewSvg';

// Format registry for the pill selector. Plain-language labels lead (a city
// planner doesn't know "GLB"); the file extension is demoted to the
// description line and the Download CTA. `surface` is the paywall surface
// key passed to startCheckout for Pro-gated downloads (preview stays free —
// the preview IS the upsell).
const FORMATS = [
  {
    key: 'glb',
    ext: '.glb',
    pro: true,
    beta: false,
    surface: 'export',
    label: (
      <FormattedMessage id="exportModal.format.glb" defaultMessage="3D Model" />
    ),
    description: (
      <FormattedMessage
        id="exportModal.glbDescription"
        defaultMessage="Download this scene as a .glb 3D model file for use in Blender, Unreal, and other 3D tools."
      />
    )
  },
  {
    key: 'dxf',
    ext: '.dxf',
    pro: true,
    beta: true,
    surface: 'export-dxf',
    label: (
      <FormattedMessage id="exportModal.format.dxf" defaultMessage="CAD Plan" />
    ),
    description: (
      <FormattedMessage
        id="exportModal.dxfDescription"
        defaultMessage="Download a 2D plan view of this scene's streets as a .dxf file for use in AutoCAD and other CAD tools."
      />
    )
  },
  {
    key: 'pdf',
    ext: '.pdf',
    pro: true,
    beta: true,
    surface: 'export-pdf',
    label: (
      <FormattedMessage id="exportModal.format.pdf" defaultMessage="PDF Plan" />
    ),
    description: (
      <FormattedMessage
        id="exportModal.pdfDescription"
        defaultMessage="Download a 2D plan view of this scene's streets as a vector .pdf file, ready to print or publish."
      />
    )
  },
  {
    key: 'json',
    ext: '.3dstreet.json',
    pro: false,
    beta: false,
    surface: null,
    label: (
      <FormattedMessage id="exportModal.format.json" defaultMessage="JSON" />
    ),
    description: (
      <FormattedMessage
        id="exportModal.jsonDescription"
        defaultMessage="Download this scene as a .3dstreet.json file to back up your work or import into another 3DStreet account."
      />
    )
  }
];

// Cap the JSON code-view at ~300k chars — scenes with cloud snapshot memory
// can serialize to multiple MB, which would tank the modal's render.
const JSON_PREVIEW_CHAR_LIMIT = 300000;

function ExportModal() {
  const intl = useIntl();
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const startCheckout = useStore((state) => state.startCheckout);
  const { currentUser } = useAuthContext();

  const isPro = currentUser?.isPro;
  const isOpen = modal === 'export';

  const [formatKey, setFormatKey] = useState('glb');
  const [arReady, setArReady] = useState(false);
  const [unitsFeet, setUnitsFeet] = useState(false);

  // On-demand GLB preview — generating a GLB blocks the main thread for
  // seconds on large scenes, so it runs on click, not on selection, and the
  // result is cached (keyed by the arReady flag) until the modal closes.
  const [glbPreview, setGlbPreview] = useState({
    status: 'idle',
    url: null,
    arReady: false
  });
  const glbUrlRef = useRef(null);

  const [jsonPreview, setJsonPreview] = useState({ status: 'idle', text: '' });

  const format = FORMATS.find((f) => f.key === formatKey);
  const isPlanFormat = formatKey === 'dxf' || formatKey === 'pdf';

  const releaseGlbUrl = () => {
    if (glbUrlRef.current) {
      URL.revokeObjectURL(glbUrlRef.current);
      glbUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (isOpen) {
      posthog.capture('export_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    } else {
      // Drop cached previews on close — the scene can change while the
      // modal is away, and the blob URL pins the whole GLB in memory.
      releaseGlbUrl();
      setGlbPreview({ status: 'idle', url: null, arReady: false });
      setJsonPreview({ status: 'idle', text: '' });
    }
  }, [isOpen]);

  // Revoke any lingering blob URL on unmount.
  useEffect(() => releaseGlbUrl, []);

  // DXF/PDF preview — the same geometry pass as the exporters (planModel),
  // cheap enough to rebuild on every selection / units change.
  const planModel = useMemo(() => {
    if (!isOpen || !isPlanFormat) return null;
    try {
      return buildStreetPlanModel({ unitsFeet });
    } catch (error) {
      console.error('Error building plan preview:', error);
      return null;
    }
  }, [isOpen, isPlanFormat, unitsFeet]);

  // JSON preview — serialized lazily the first time the JSON pill is picked.
  useEffect(() => {
    if (!isOpen || formatKey !== 'json' || jsonPreview.status !== 'idle') {
      return;
    }
    let cancelled = false;
    setJsonPreview({ status: 'loading', text: '' });
    getSceneJsonString()
      .then((raw) => {
        if (cancelled) return;
        let pretty = raw;
        try {
          pretty = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          // filterJSONstreet output should always parse; fall back to raw.
        }
        setJsonPreview({
          status: 'ready',
          text:
            pretty.length > JSON_PREVIEW_CHAR_LIMIT
              ? pretty.slice(0, JSON_PREVIEW_CHAR_LIMIT)
              : pretty,
          truncated: pretty.length > JSON_PREVIEW_CHAR_LIMIT
        });
      })
      .catch((error) => {
        console.error('Error serializing scene JSON:', error);
        if (!cancelled) setJsonPreview({ status: 'error', text: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, formatKey, jsonPreview.status]);

  const selectFormat = (key) => {
    setFormatKey(key);
    posthog.capture('export_modal_format_selected', {
      export_type: key,
      scene_id: STREET.utils.getCurrentSceneId()
    });
  };

  const handleGenerateGlbPreview = useCallback(async () => {
    setGlbPreview({ status: 'generating', url: null, arReady });
    posthog.capture('export_modal_preview_generated', {
      export_type: arReady ? 'ar_glb' : 'glb',
      scene_id: STREET.utils.getCurrentSceneId()
    });
    // Let the "Generating…" state paint before the synchronous export work
    // blocks the main thread (same trick as the export indicator).
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const { blob } = await generateGlbBlob(arReady);
      releaseGlbUrl();
      const url = URL.createObjectURL(blob);
      glbUrlRef.current = url;
      setGlbPreview({ status: 'ready', url, arReady });
    } catch (error) {
      console.error('Error generating GLB preview:', error);
      setGlbPreview({ status: 'error', url: null, arReady });
    }
  }, [arReady]);

  const handleDownload = () => {
    posthog.capture('export_modal_export_clicked', {
      export_type: formatKey === 'glb' && arReady ? 'ar_glb' : formatKey,
      scene_id: STREET.utils.getCurrentSceneId()
    });
    if (format.pro && !isPro) {
      startCheckout(format.surface);
      return;
    }
    // Close the modal so the blocking export indicator is visible.
    setModal(null);
    if (formatKey === 'glb') {
      exportSceneToGLTF(intl, arReady);
    } else if (formatKey === 'dxf') {
      exportSceneToDXF(intl, { unitsFeet });
    } else if (formatKey === 'pdf') {
      exportSceneToPDF(intl, { unitsFeet });
    } else {
      exportSceneToJSON();
    }
  };

  // GLB preview cache is only valid for the arReady flavor it was built
  // with; a stale flavor shows the Generate button again.
  const glbPreviewCurrent =
    glbPreview.status !== 'idle' && glbPreview.arReady === arReady
      ? glbPreview
      : { status: 'idle', url: null, arReady };

  const planIsEmpty = isPlanFormat && !planModel?.bounds;

  const renderPreview = () => {
    if (formatKey === 'glb') {
      if (glbPreviewCurrent.status === 'ready') {
        return (
          <iframe
            className={styles.previewIframe}
            title="GLB preview"
            src={`/model-viewer.html?src=${encodeURIComponent(
              glbPreviewCurrent.url
            )}`}
          />
        );
      }
      return (
        <div className={styles.previewEmptyState}>
          {glbPreviewCurrent.status === 'generating' ? (
            <p>
              <FormattedMessage
                id="exportModal.generatingPreview"
                defaultMessage="Generating 3D preview…"
              />
            </p>
          ) : (
            <>
              {glbPreviewCurrent.status === 'error' && (
                <p className={styles.previewError}>
                  <FormattedMessage
                    id="exportModal.previewError"
                    defaultMessage="Could not generate the preview. Please try again."
                  />
                </p>
              )}
              <Button onClick={handleGenerateGlbPreview} variant="toolbtn">
                <FormattedMessage
                  id="exportModal.generatePreview"
                  defaultMessage="Generate 3D preview"
                />
              </Button>
              <p className={styles.previewHint}>
                <FormattedMessage
                  id="exportModal.generatePreviewHint"
                  defaultMessage="Builds the .glb in your browser; this may take a few seconds on large scenes."
                />
              </p>
            </>
          )}
        </div>
      );
    }

    if (isPlanFormat) {
      if (planIsEmpty) {
        return (
          <div className={styles.previewEmptyState}>
            <p>
              <FormattedMessage
                id="exportModal.planEmpty"
                defaultMessage="No street segments to draw yet. Add a street layer to see a plan preview."
              />
            </p>
          </div>
        );
      }
      if (formatKey === 'pdf') {
        // White letter-landscape "page" so the preview reads as the printed
        // artifact; plot palette matches the PDF writer.
        return (
          <div className={styles.pdfPage}>
            <PlanPreviewSvg
              model={planModel}
              palette="plot"
              className={styles.planSvg}
            />
          </div>
        );
      }
      return (
        <div className={styles.dxfCanvas}>
          <PlanPreviewSvg
            model={planModel}
            palette="screen"
            className={styles.planSvg}
          />
        </div>
      );
    }

    // JSON code view — the literal serialized artifact, monospace.
    if (jsonPreview.status === 'ready') {
      return (
        <div className={styles.jsonPreviewWrapper}>
          <pre className={styles.jsonPreview}>{jsonPreview.text}</pre>
          {jsonPreview.truncated && (
            <div className={styles.jsonTruncatedNote}>
              <FormattedMessage
                id="exportModal.jsonTruncated"
                defaultMessage="Preview truncated. The downloaded file contains the full scene."
              />
            </div>
          )}
        </div>
      );
    }
    return (
      <div className={styles.previewEmptyState}>
        <p>
          {jsonPreview.status === 'error' ? (
            <FormattedMessage
              id="exportModal.previewError"
              defaultMessage="Could not generate the preview. Please try again."
            />
          ) : (
            <FormattedMessage
              id="exportModal.serializingScene"
              defaultMessage="Serializing scene…"
            />
          )}
        </p>
      </div>
    );
  };

  return (
    <Modal
      className={styles.exportModalWrapper}
      isOpen={isOpen}
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
        <div className={styles.controlsPanel}>
          <div className={styles.formatPills} role="radiogroup">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={f.key === formatKey}
                className={`${styles.pill} ${
                  f.key === formatKey ? styles.pillActive : ''
                }`}
                onClick={() => selectFormat(f.key)}
              >
                {f.label}
                {f.beta && (
                  <span className={styles.betaChip}>
                    <FormattedMessage
                      id="appMenu.betaBadge"
                      defaultMessage="Beta"
                    />
                  </span>
                )}
                {f.pro && !isPro && (
                  <span className={styles.proChip}>
                    <FormattedMessage
                      id="appMenu.proBadge"
                      defaultMessage="Pro"
                    />
                  </span>
                )}
              </button>
            ))}
          </div>

          <p className={styles.formatDescription}>{format.description}</p>

          {(formatKey === 'glb' || isPlanFormat) && (
            <div className={styles.settingsSection}>
              <div className={styles.settingsLabel}>
                <FormattedMessage
                  id="exportModal.settings"
                  defaultMessage="Settings"
                />
              </div>
              {formatKey === 'glb' && (
                <>
                  <div className={styles.settingPills}>
                    <button
                      type="button"
                      aria-pressed={arReady}
                      className={`${styles.pill} ${
                        arReady ? styles.pillActive : ''
                      }`}
                      onClick={() => setArReady(!arReady)}
                    >
                      <FormattedMessage
                        id="exportModal.arReadyPill"
                        defaultMessage="AR Ready"
                      />
                    </button>
                  </div>
                  <p className={styles.settingHint}>
                    <FormattedMessage
                      id="exportModal.arReadyHint"
                      defaultMessage="Omits people, vehicles and geospatial layers for augmented reality apps."
                    />
                  </p>
                </>
              )}
              {isPlanFormat && (
                <div
                  className={styles.settingPills}
                  role="radiogroup"
                  aria-label={intl.formatMessage({
                    id: 'exportModal.unitsLabel',
                    defaultMessage: 'Units'
                  })}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!unitsFeet}
                    className={`${styles.pill} ${
                      !unitsFeet ? styles.pillActive : ''
                    }`}
                    onClick={() => setUnitsFeet(false)}
                  >
                    <FormattedMessage
                      id="exportModal.unitsMeters"
                      defaultMessage="Meters"
                    />
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={unitsFeet}
                    className={`${styles.pill} ${
                      unitsFeet ? styles.pillActive : ''
                    }`}
                    onClick={() => setUnitsFeet(true)}
                  >
                    <FormattedMessage
                      id="exportModal.unitsFeet"
                      defaultMessage="Feet"
                    />
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.downloadSection}>
            <Button
              onClick={handleDownload}
              variant="filled"
              className={styles.downloadButton}
              disabled={planIsEmpty}
            >
              <FormattedMessage
                id="exportModal.downloadExt"
                defaultMessage="Download {ext}"
                values={{ ext: format.ext }}
              />
            </Button>
            {format.pro && !isPro && (
              <p className={styles.proHint}>
                <FormattedMessage
                  id="exportModal.proDownloadHint"
                  defaultMessage="Preview is free. Downloading requires 3DStreet Pro."
                />
              </p>
            )}
          </div>
        </div>

        <div className={styles.previewPanel}>{renderPreview()}</div>
      </div>
    </Modal>
  );
}

export { ExportModal };
