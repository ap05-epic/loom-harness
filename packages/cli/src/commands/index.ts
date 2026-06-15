import { CommandRegistry } from '../registry.js';
import { doctorCommand } from './lifecycle/doctor.js';
import { statusCommand } from './lifecycle/status.js';
import { updateCommand } from './lifecycle/update.js';
import { dbBackupCommand, dbMigrateCommand } from './lifecycle/db.js';
import { profileShowCommand, profileValidateCommand } from './lifecycle/profile.js';
import { modelsListCommand, modelsTestCommand } from './lifecycle/models.js';
import { initCommand } from './lifecycle/init.js';

/** All command specs that ship today, in registration order. */
export const ALL_COMMANDS = [
  initCommand,
  doctorCommand,
  statusCommand,
  updateCommand,
  dbMigrateCommand,
  dbBackupCommand,
  profileShowCommand,
  profileValidateCommand,
  modelsListCommand,
  modelsTestCommand,
];

export function registerAll(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of ALL_COMMANDS) registry.add(command);
  return registry;
}
