import { memoryDriver, setStorageDriver } from './index.ts';

/** Swap in an in-memory driver for the duration of a test. */
export function captureStorage() {
  const driver = memoryDriver();
  setStorageDriver(driver);
  return driver;
}
