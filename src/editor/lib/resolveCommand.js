import { commandsByType } from './commands/index.js';
import { routeCloneEdit } from './detachClone.js';
import { refuseGuardedTransform } from './transformGuard.js';

/**
 * Work out what a command request will actually run, without running it: the
 * routing Inspector.execute applies, the command class for the routed request,
 * and the guard's verdict on it. Pure apart from what the routers read; it
 * neither notifies nor touches History, so tests can drive the same pipeline.
 *
 * Returns {Cmd, cmdName, payload, optionalName, callback, refusal}. `Cmd` is
 * undefined for an unknown command; `refusal` is the reason to show, or null.
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

  // Looked up after routing, so the class matches what will run.
  const Cmd = commandsByType.get(cmdName);

  // Transform-capability markers are enforced here rather than inside a
  // command, because History pushes a command onto the undo stack BEFORE
  // running it — a command that no-oped itself would leave a dead entry that
  // undo walks through silently.
  const refusal = Cmd ? refuseGuardedTransform(cmdName, payload) : null;

  return { Cmd, cmdName, payload, optionalName, callback, refusal };
}
