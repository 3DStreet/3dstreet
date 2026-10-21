import { commandsByType } from './commands/index.js';
import { routeCloneEdit } from './detachClone.js';
import { routeTransformLevel } from './groups/groupLevel.js';
import { refuseGuardedTransform } from './transformGuard.js';

// While a tool call runs (withCommandOutcome), the first command it resolves
// records why it was refused or what it levelled, so the AI can be told.
// null: no call running. Otherwise {recorded, value}.
let outcomeSlot = null;

/**
 * Run `execute` with the outcome slot armed, and return {result, outcome}:
 * what `execute` returned, and the {refusal, levelled} of the first command it
 * resolved (null if none). `execute` must be synchronous: a command resolved
 * after it returns is not this call's.
 */
export function withCommandOutcome(execute) {
  outcomeSlot = { recorded: false, value: null };
  try {
    const result = execute();
    return { result, outcome: outcomeSlot.value };
  } finally {
    outcomeSlot = null;
  }
}

/**
 * Work out what a command request will actually run, without running it: the
 * routing (generated clones, then levelling constrained items), the command
 * class for the routed request, and the guard's verdict on it. Inspector.execute is this
 * plus the refusal notice and History; test harnesses call it to run the same
 * pipeline. It neither notifies nor touches History; its one side effect is
 * recording the outcome of the first call while a tool call runs
 * (withCommandOutcome).
 *
 * Returns {Cmd, cmdName, payload, optionalName, callback, refusal, levelled}.
 * `Cmd` is undefined for an unknown command; `refusal` is the reason to show,
 * or null; `levelled` is what a levelling rewrite removed
 * (routeTransformLevel), or null.
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

  // A write that makes an item a constrained kind, or would leave one outside
  // its kind's limits, is rewritten to level it in the same undo step.
  let levelled = null;
  const levelling = routeTransformLevel(cmdName, payload);
  if (levelling) {
    cmdName = levelling.cmdName;
    payload = levelling.payload;
    levelled = levelling.levelled;
    if (optionalName === undefined) optionalName = levelling.name;
  }

  // Looked up after both rewrites, so the class matches what will run.
  const Cmd = commandsByType.get(cmdName);

  // Transform-capability markers are enforced here rather than inside a
  // command, because History pushes a command onto the undo stack BEFORE
  // running it — a command that no-oped itself would leave a dead entry that
  // undo walks through silently.
  const refusal = Cmd ? refuseGuardedTransform(cmdName, payload) : null;

  if (outcomeSlot && !outcomeSlot.recorded) {
    outcomeSlot.value = { refusal, levelled };
    outcomeSlot.recorded = true;
  }

  return { Cmd, cmdName, payload, optionalName, callback, refusal, levelled };
}
