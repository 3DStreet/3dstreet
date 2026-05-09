import { faStop } from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { Button } from '../elements/Button';
import { AwesomeIcon } from '../elements/AwesomeIcon';

function Toolbar() {
  const { isInspectorEnabled, setIsInspectorEnabled } = useStore();

  if (isInspectorEnabled) return null;

  const handleStop = () => {
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
      <div className="flex w-full items-center justify-center">
        <Button
          onClick={handleStop}
          variant="toolbtn"
          leadingIcon={<AwesomeIcon icon={faStop} size={14} />}
        >
          Stop
        </Button>
      </div>
    </div>
  );
}

export default Toolbar;
