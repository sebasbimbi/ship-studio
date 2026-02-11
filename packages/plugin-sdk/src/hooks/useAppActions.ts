import { getPluginContext } from '../context';

/** Returns the app actions proxy (showToast, refreshGitStatus, etc). */
export function useAppActions() {
  return getPluginContext().actions;
}
