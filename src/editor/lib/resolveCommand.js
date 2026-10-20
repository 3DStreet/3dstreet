import { commandsByType } from './commands/index.js';
import { routeCloneEdit } from './detachClone.js';
import { routeGroupLevel } from './groups/groupLevel.js';
import { refuseGuardedTransform } from './transformGuard.js';

// The outcome of the first command resolved while a tool call is armed (see
// beginCommandOutcome), so the AI can be told why it was refused or what was
// levelled. Nothing is recorded outside an armed call.
let outcomeArmed = false;
let outcomeRecorded = false;
let outcome = null;

/**
 * Arm the outcome slot for one tool call. The next resolveCommand records
 * {refusal, levelled}; commands it causes in turn cannot overwrite it.
 */
export function beginCommandOutcome() {
  outcome = null;
  outcomeArmed = true;
  outcomeRecorded = false;
}

/** The armed call's outcome, or null; disarms the slot. */
export function takeCommandOutcome() {
  const taken = outcome;
  outcome = null;
  outcomeArmed = false;
  outcomeRecorded = false;
  return taken;
}

/**
 * Work out what a command request will actually run, without running it: the
 * routing Inspector.execute applies, the command class for the routed request,
 * and the guard's verdict on it. Pure apart from what the routers read; it
 * neither notifies nor touches History, so tests can drive the same pipeline.
 *
 * Returns {Cmd, cmdName, payload, optionalName, callback, refusal, levelled}.
 * `Cmd` is undefined for an unknown command; `refusal` is the reason to show,
 * or null; `levelled` is what a group-making write removed (routeGroupLevel),
 * or null.
 */
export function resolveCommand(cmdName, payload, optionalName, callback) {
  // A generated street clone is an editable object whose first edit
  // detaches it (#2011): re-route the edit here, before the command is
  // built, so every door behaves the same.
  const routed = routeCloneEdit(cmdName, payload);
  if (routed) {
    // A caller's label names the command it asked for ("Move"); once the
    // edit has become a detach, the detach's own name is the true one.
    if (routed.cmdName !== cmdName) optionalName = undefined;
    cmdName = routed.cmdName;
    payload = routed.payload;
    // A batch that folded to one member carries that member's callback.
    if (routed.callback && !callback) callback = routed.callback;
  }

  // A write that leaves a user group tilted or scaled is rewritten to level
  // it in the same undo step.
  let levelled = null;
  const levelling = routeGroupLevel(cmdName, payload);
  if (levelling) {
    cmdName = levelling.cmdName;
    payload = levelling.payload;
    levelled = levelling.levelled;
  }

  // Looked up after both rewrites, so the class matches what will run.
  const Cmd = commandsByType.get(cmdName);

  // Transform-capability markers are enforced here rather than inside a
  // command, because History pushes a command onto the undo stack BEFORE
  // running it — a command that no-oped itself would leave a dead entry that
  // undo walks through silently.
  const refusal = Cmd ? refuseGuardedTransform(cmdName, payload) : null;

  if (outcomeArmed && !outcomeRecorded) {
    outcome = { refusal, levelled };
    outcomeRecorded = true;
  }

  return { Cmd, cmdName, payload, optionalName, callback, refusal, levelled };
}
