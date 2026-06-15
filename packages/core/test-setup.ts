// node:sqlite is used as a zero-native-dependency fallback backend. Node emits a
// one-time ExperimentalWarning when it loads; silence only that specific notice so
// it doesn't masquerade as an application warning in test output. All other
// warnings pass through untouched.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (typeof message === 'string' && message.includes('SQLite is an experimental feature')) {
    return;
  }
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
