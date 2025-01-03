import { Command } from '../command.js';
import { commandsByType } from './index.js';

/**
 * @param editor Editor
 * @param commands
 * @param callback Optional callback to call after all commands are executed,
 *                 get as argument the created entity or null if last command is entityremove.
 * @constructor
 */
export class MultiCommand extends Command {
  constructor(editor, commands, callback = undefined) {
    super(editor);

    this.type = 'multi';
    this.name = 'Multiple changes';
    this.updatable = false;
    this.callback = callback;
    this.commands = commands
      .map((cmdTuple) => {
        const Cmd = commandsByType.get(cmdTuple[0]);
        if (!Cmd) {
          console.error(`Command ${cmdTuple[0]} not found`);
          return null;
        }
        return new Cmd(editor, cmdTuple[1], cmdTuple[2]);
      })
      .filter(Boolean);
  }

  execute() {
    const run = this.commands
      .toReversed()
      .reduce((nextCommandCallback, command) => {
        return (entityIgnored) => {
          return command.execute(nextCommandCallback);
        };
      }, this.callback); // latest callback uses the entity as parameter
    return run();
  }

  undo() {
    const run = this.commands.reduce((nextCommandCallback, command) => {
      return (entityIgnored) => {
        return command.undo(nextCommandCallback);
      };
    }, this.callback); // latest callback uses the entity as parameter
    return run();
  }
}
