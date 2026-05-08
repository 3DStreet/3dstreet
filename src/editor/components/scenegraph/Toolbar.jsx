import useStore from '@/store';
import { Button } from '../elements/Button';

function Toolbar() {
  const { isInspectorEnabled, setIsInspectorEnabled } = useStore();

  if (isInspectorEnabled) return null;

  const handleEdit = () => {
    // Tear down play-mode side effects (player car + physics world) by
    // resetting the cameraRig viewer-mode preset before reopening the
    // inspector. 'locomotion' is the no-op fallback (just A-Frame's
    // built-in movement-controls / look-controls).
    const cameraRig = document.getElementById('cameraRig');
    if (cameraRig) {
      cameraRig.setAttribute('viewer-mode', 'preset', 'locomotion');
    }
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
