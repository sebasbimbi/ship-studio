import { getPluginContext } from '../context';

/** Returns theme data (CSS variable values) for consistent styling. */
export function useTheme() {
  return getPluginContext().theme;
}
