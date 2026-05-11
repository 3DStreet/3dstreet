import { faStop } from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { Button } from '../elements/Button';
import { AwesomeIcon } from '../elements/AwesomeIcon';

function Toolbar() {
  const { isInspectorEnabled, setIsInspectorEnabled } = useStore();

  if (isInspectorEnabled) return null;

  const handleStop = () => {
    // setIsInspectorEnabled(true) already calls play-mode.stop() so
    // play-mode subscribers (drive-mode, future traffic) tear down
    // via the scene event. We deliberately don't re-enable
    // cursor-teleport / look-controls / movement-controls — see
    // play-mode-notes.md (two-click selection bug investigation).
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
