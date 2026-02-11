import { getPluginContext } from '../context';

/** Returns the showToast function for displaying notifications. */
export function useToast() {
  return getPluginContext().actions.showToast;
}
