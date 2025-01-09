import { ComponentAddCommand } from './ComponentAddCommand.js';
import { ComponentRemoveCommand } from './ComponentRemoveCommand.js';
import { EntityCloneCommand } from './EntityCloneCommand.js';
import { EntityCreateCommand } from './EntityCreateCommand.js';
import { EntityRemoveCommand } from './EntityRemoveCommand.js';
import { EntityUpdateCommand } from './EntityUpdateCommand.js';
import { MultiCommand } from './MultiCommand.js';

export const commandsByType = new Map();
commandsByType.set('componentadd', ComponentAddCommand);
commandsByType.set('componentremove', ComponentRemoveCommand);
commandsByType.set('entityclone', EntityCloneCommand);
commandsByType.set('entitycreate', EntityCreateCommand);
commandsByType.set('entityremove', EntityRemoveCommand);
commandsByType.set('entityupdate', EntityUpdateCommand);
commandsByType.set('multi', MultiCommand);
