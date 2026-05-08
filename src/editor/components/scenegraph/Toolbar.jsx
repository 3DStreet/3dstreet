import useStore from '@/store';
import { Button } from '../elements/Button';

function Toolbar() {
  const { isInspectorEnabled, setIsInspectorEnabled } = useStore();

  if (isInspectorEnabled) return null;

  const handleEdit = () => {
    // Tear down play-mode side effects (player car + Rapier world) but
    // do NOT re-enable cursor-teleport / look-controls / movement-controls
    // afterward — the inspector handles its own input, and re-enabling
    // those leaks click listeners that break first-click-to-select.
    const viewerMode =
      document.getElementById('cameraRig')?.components?.['viewer-mode'];
    if (viewerMode) viewerMode.disableAllModes();
    setIsInspectorEnabled(true);
  };

  return (
    <div id="toolbar" data-inspector="false">
      <div className="flex flex-shrink-0 items-center space-x-2">
        <img
          src="/ui_assets/3D-St-stacked-128.png"
          alt="3DStreet Logo"
          style={{ width: '48px', height: '48px', objectFit: 'contain' }}
        />
        <Button onClick={handleEdit} variant="toolbtn">
          Edit
        </Button>
      </div>
    </div>
  );
}

export default Toolbar;
