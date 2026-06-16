import { CommandRegistry } from '../registry.js';
import { doctorCommand } from './lifecycle/doctor.js';
import { statusCommand } from './lifecycle/status.js';
import { updateCommand } from './lifecycle/update.js';
import { dbBackupCommand, dbMigrateCommand } from './lifecycle/db.js';
import { profileShowCommand, profileValidateCommand } from './lifecycle/profile.js';
import { modelsListCommand, modelsTestCommand } from './lifecycle/models.js';
import { initCommand } from './lifecycle/init.js';
import { evalCommand } from './pipeline/eval.js';
import { mapCommand } from './pipeline/map.js';
import { crawlCommand } from './pipeline/crawl.js';
import { runCommand, resumeCommand } from './pipeline/run.js';
import { wpListCommand, wpShowCommand } from './work/wp.js';
import { gatesListCommand, gatesApproveCommand, gatesRejectCommand } from './work/gates.js';
import { questionsListCommand, questionsAnswerCommand } from './work/questions.js';
import { logsCommand } from './observe/logs.js';
import { watchCommand } from './observe/watch.js';
import { uiCommand } from './observe/ui.js';
import { reportCommand } from './observe/report.js';
import {
  atlasRepomapCommand,
  atlasSliceCommand,
  atlasFindCommand,
  atlasSummarizeCommand,
  atlasVerifyDocsCommand,
} from './knowledge/atlas.js';
import { mcpListCommand } from './knowledge/mcp.js';
import {
  skillsListCommand,
  skillsShowCommand,
  skillsNewCommand,
  skillsExportCommand,
  skillsImportCommand,
} from './knowledge/skills.js';
import { projectListCommand, projectCurrentCommand, projectUseCommand } from './project/project.js';

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
  mapCommand,
  crawlCommand,
  evalCommand,
  runCommand,
  resumeCommand,
  wpListCommand,
  wpShowCommand,
  gatesListCommand,
  gatesApproveCommand,
  gatesRejectCommand,
  questionsListCommand,
  questionsAnswerCommand,
  logsCommand,
  watchCommand,
  uiCommand,
  reportCommand,
  atlasRepomapCommand,
  atlasSliceCommand,
  atlasFindCommand,
  atlasSummarizeCommand,
  atlasVerifyDocsCommand,
  mcpListCommand,
  skillsListCommand,
  skillsShowCommand,
  skillsNewCommand,
  skillsExportCommand,
  skillsImportCommand,
  projectListCommand,
  projectCurrentCommand,
  projectUseCommand,
];

export function registerAll(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of ALL_COMMANDS) registry.add(command);
  return registry;
}
