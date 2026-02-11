import { getPluginContext } from '../context';

/** Returns the current project data, or null if no project is open. */
export function useProject() {
  return getPluginContext().project;
}
