import { useAssetLoadSummary } from './useAssetLoadTracker';

/**
 * Ambient scene-wide load state behind the left panel's title row (#2009):
 * while any 3D model or texture is still downloading, a faint fill grows
 * from the left with overall progress and a sheen moves across it; when the
 * last load settles the layer fades out. No text, no counts. Streaming
 * layers are not part of it.
 *
 * Always mounted so the fade-out is a plain CSS transition; the host row
 * gets `position: relative` and isolates its stacking context in
 * scenegraph.scss so the layer paints behind the title and save button.
 */
const PanelLoadSheen = () => {
  const summary = useAssetLoadSummary();
  const loading = summary.pending > 0;
  return (
    <span
      className={'panelLoadSheen' + (loading ? ' is-loading' : '')}
      style={{ '--load-progress': `${Math.round(summary.progress * 100)}%` }}
      aria-hidden="true"
    />
  );
};

export default PanelLoadSheen;
