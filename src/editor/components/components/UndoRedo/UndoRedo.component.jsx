import { useEffect, useState } from 'react';
import { faRotateLeft, faRotateRight } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import { AwesomeIcon } from '../AwesomeIcon';
import { Button } from '../Button';
import Events from '../../../lib/Events';

export const UndoRedo = () => {
  const [undoDisabled, setUndoDisabled] = useState(
    AFRAME.INSPECTOR.history.undos.length === 0
  );
  const [redoDisabled, setRedoDisabled] = useState(
    AFRAME.INSPECTOR.history.redos.length === 0
  );
  const handleUndoClick = () => {
    AFRAME.INSPECTOR.undo();
    posthog.capture('undo_clicked');
  };

  const handleRedoClick = () => {
    AFRAME.INSPECTOR.redo();
    posthog.capture('redo_clicked');
  };

  useEffect(() => {
    const listener = () => {
      setUndoDisabled(AFRAME.INSPECTOR.history.undos.length === 0);
      setRedoDisabled(AFRAME.INSPECTOR.history.redos.length === 0);
    };
    Events.on('historychanged', listener);
    return () => {
      Events.off('historychanged', listener);
    };
  }, []);

  return (
    <>
      <Button
        variant="toolbtn"
        className="min-w-[105px]"
        onClick={handleUndoClick}
        leadingIcon={<AwesomeIcon icon={faRotateLeft} />}
        disabled={undoDisabled}
      >
        <div>Undo</div>
      </Button>
      <Button
        variant="toolbtn"
        className="min-w-[105px]"
        onClick={handleRedoClick}
        leadingIcon={<AwesomeIcon icon={faRotateRight} />}
        disabled={redoDisabled}
      >
        <div>Redo</div>
      </Button>
    </>
  );
};
