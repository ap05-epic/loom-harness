export {
  defineTool,
  ToolRegistry,
  ToolBlockedError,
  namespacedToolName,
  scopeTools,
  type Tool,
  type ToolResult,
} from './tools.js';
export { HookBus, type Hook, type HookEvent, type HookDecision, type EmitResult } from './hooks.js';
export { protectedPathsHook } from './protected-paths.js';
export {
  createPolicy,
  decidePermission,
  permissionHook,
  type PermissionMode,
  type PermissionPolicy,
  type PermissionDecision,
  type PermissionAnswer,
  type PermissionRequest,
  type PermissionPrompt,
  type ToolRisk,
} from './permissions.js';
