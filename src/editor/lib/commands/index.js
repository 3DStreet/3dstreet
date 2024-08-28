import { EntityUpdateCommand } from './EntityUpdateCommand.js';
import { ComponentAddCommand } from './ComponentAddCommand.js';
import { ComponentRemoveCommand } from './ComponentRemoveCommand.js';
import { EntityCreateCommand } from './EntityCreateCommand.js';
import { EntityRemoveCommand } from './EntityRemoveCommand.js';

export const commandsByType = new Map();
commandsByType.set('entityupdate', EntityUpdateCommand);
commandsByType.set('componentadd', ComponentAddCommand);
commandsByType.set('componentremove', ComponentRemoveCommand);
commandsByType.set('entitycreate', EntityCreateCommand);
commandsByType.set('entityremove', EntityRemoveCommand);
