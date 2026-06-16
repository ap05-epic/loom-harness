# @loom/test-kit

Test helpers for the harness. A dev-only package — never imported by production code.

## What it provides

- **`MockLlmServer`** — an in-process, OpenAI-compatible chat-completions server you script ahead of time:
  - `enqueueText(text)`, `enqueueToolCall(name, args)`, `enqueueError(status, message)` (each with an optional `{ repeat: true }` to loop)
  - records every request it received (`server.requests`) so a test can assert what the driver sent
  - `start()` returns a `baseUrl`; `stop()` closes it

## Example

```ts
import { MockLlmServer } from '@loom/test-kit';

const server = new MockLlmServer();
const { baseUrl } = await server.start();
server.enqueueToolCall('lookup', { id: 1 });
server.enqueueText('done');
// ...point an OpenAiDriver at baseUrl, run an AgentRunner loop, assert...
await server.stop();
```

This is what lets the entire agent stack be tested without a real endpoint, and (with recorded transcripts) makes pipeline runs reproducible in CI.
