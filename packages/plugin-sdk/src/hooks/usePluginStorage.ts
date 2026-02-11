import { getPluginContext } from '../context';

/** Returns the storage proxy for reading/writing plugin-scoped data. */
export function usePluginStorage() {
  return getPluginContext().storage;
}
