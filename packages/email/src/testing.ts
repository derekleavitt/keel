import { type Email, memoryTransport, setEmailTransport } from './index.ts';

/**
 * Capture mail for the duration of a test.
 *
 * Returns the array the transport writes into, so assertions read naturally:
 * `expect(sent[0]?.subject).toBe(...)`.
 */
export function captureEmail(): Email[] {
  const transport = memoryTransport();
  setEmailTransport(transport);
  return transport.sent;
}
