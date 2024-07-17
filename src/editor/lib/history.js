import Events from './Events';

export class History {
  constructor(editor) {
    this.editor = editor;
    this.undos = [];
    this.redos = [];
    this.lastCmdTime = Date.now();
    this.idCounter = 0;

    this.historyDisabled = false;

    Events.on('sceneplayingtoggle', (playing) => {
      this.historyDisabled = playing;
    });
  }

  execute(cmd, optionalName) {
    const lastCmd = this.undos[this.undos.length - 1];
    const timeDifference = Date.now() - this.lastCmdTime;

    const isUpdatableCmd =
      lastCmd &&
      lastCmd.updatable &&
      cmd.updatable &&
      lastCmd.entity === cmd.entity &&
      lastCmd.type === cmd.type &&
      lastCmd.component === cmd.component &&
      lastCmd.property === cmd.property;

    if (isUpdatableCmd && timeDifference < 500) {
      lastCmd.update(cmd);
      cmd = lastCmd;
    } else {
      // the command is not updatable and is added as a new part of the history

      this.undos.push(cmd);
      cmd.id = ++this.idCounter;
    }

    cmd.name = optionalName !== undefined ? optionalName : cmd.name;
    cmd.execute();

    this.lastCmdTime = Date.now();

    // clearing all the redo-commands

    this.redos = [];
    Events.emit('historychanged', cmd);
  }

  undo() {
    if (this.historyDisabled) {
      alert('Undo/Redo disabled while scene is playing.');
      return;
    }

    let cmd;

    if (this.undos.length > 0) {
      cmd = this.undos.pop();
    }

    if (cmd !== undefined) {
      cmd.undo();
      this.redos.push(cmd);
      Events.emit('historychanged', cmd);
    }

    return cmd;
  }

  redo() {
    if (this.historyDisabled) {
      alert('Undo/Redo disabled while scene is playing.');
      return;
    }

    let cmd;

    if (this.redos.length > 0) {
      cmd = this.redos.pop();
    }

    if (cmd !== undefined) {
      cmd.execute();
      this.undos.push(cmd);
      Events.emit('historychanged', cmd);
    }

    return cmd;
  }

  clear() {
    this.undos = [];
    this.redos = [];
    this.idCounter = 0;

    Events.emit('historychanged');
  }
}
