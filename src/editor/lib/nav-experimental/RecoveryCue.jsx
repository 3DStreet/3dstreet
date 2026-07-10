import { isExperimentalNav } from './flag.js';
import { useRecoveryCue } from './useRecoveryCue.js';

// Recovery cue (see docs/04-glossary.md "Recovery cue"): transient on-screen
// hint shown when the camera is enclosed (inside solid geometry) or stranded
// well above the surface it could drop to. Prompts the user to press Space.
// This is only the transient flash; the persistent affordance is the context
// view button (KD-21).
//
// The cue is driven entirely by `nav-experimental:recovery-cue` events from
// the controls (show/hide elevation hysteresis lives there — TH-52/TH-53), so
// this component just renders the latest kind.
const MESSAGES = {
  enclosed: 'Press Space to get out',
  drop: 'Press Space to drop down'
};

const cueStyle = {
  position: 'absolute',
  top: '72px',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '6px 14px',
  borderRadius: '6px',
  background: 'rgba(0, 0, 0, 0.6)',
  color: '#fff',
  fontSize: '13px',
  fontFamily: 'sans-serif',
  pointerEvents: 'none',
  zIndex: 100,
  whiteSpace: 'nowrap'
};

export function RecoveryCue() {
  const { cueKind } = useRecoveryCue();
  if (!isExperimentalNav()) return null;
  if (!cueKind || !MESSAGES[cueKind]) return null;
  return <div style={cueStyle}>{MESSAGES[cueKind]}</div>;
}
