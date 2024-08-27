import { EntityUpdateCommand } from './EntityUpdateCommand.js';
import { ComponentAddCommand } from './ComponentAddCommand.js';
import { ComponentRemoveCommand } from './ComponentRemoveCommand.js';
import { EntityCreateCommand } from './EntityCreateCommand.js';
import { EntityRemoveCommand } from './EntityRemoveCommand.js';

export const commandsByType = new Map();
commandsByType.set(EntityUpdateCommand.type, EntityUpdateCommand);
commandsByType.set(ComponentAddCommand.type, ComponentAddCommand);
commandsByType.set(ComponentRemoveCommand.type, ComponentRemoveCommand);
commandsByType.set(EntityCreateCommand.type, EntityCreateCommand);
commandsByType.set(EntityRemoveCommand.type, EntityRemoveCommand);
