/**
 * @param editor pointer to main editor object used to initialize
 *        each command object with a reference to the editor
 * @constructor
 */

export class Command {
  constructor(editor) {
    this.id = -1;
    this.updatable = false;
    this.type = '';
    this.name = '';
    this.editor = editor;
  }
}
