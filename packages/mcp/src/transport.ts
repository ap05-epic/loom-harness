/** A duplex JSON message channel — the MCP transport seam (stdio, in-memory, HTTP…). */
export interface Transport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  close(): void;
}

/**
 * Two linked in-memory transports — for tests and for wiring an MCP server and
 * client in the same process (a sends → b receives, and vice-versa). Messages
 * sent before a handler is registered are buffered, then flushed in order.
 */
export function memoryTransportPair(): [Transport, Transport] {
  let handlerA: ((m: unknown) => void) | undefined;
  let handlerB: ((m: unknown) => void) | undefined;
  const bufA: unknown[] = [];
  const bufB: unknown[] = [];

  const deliverToA = (m: unknown): void => {
    if (handlerA) handlerA(m);
    else bufA.push(m);
  };
  const deliverToB = (m: unknown): void => {
    if (handlerB) handlerB(m);
    else bufB.push(m);
  };

  const a: Transport = {
    send: (m) => deliverToB(m),
    onMessage: (h) => {
      handlerA = h;
      while (bufA.length) h(bufA.shift());
    },
    close: () => {
      handlerA = undefined;
    },
  };
  const b: Transport = {
    send: (m) => deliverToA(m),
    onMessage: (h) => {
      handlerB = h;
      while (bufB.length) h(bufB.shift());
    },
    close: () => {
      handlerB = undefined;
    },
  };
  return [a, b];
}
