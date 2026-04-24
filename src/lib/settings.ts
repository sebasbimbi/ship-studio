/**
 * UI Settings
 *
 * Persisted user preferences for dashboard UI elements.
 *
 * @module lib/settings
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Check if the GitHub contribution calendar is hidden on the dashboard.
 */
export async function getCalendarHidden(): Promise<boolean> {
  try {
    return await invoke<boolean>('get_calendar_hidden');
  } catch {
    return false; // Default to visible
  }
}

/**
 * Set whether the GitHub contribution calendar is hidden (persisted across sessions).
 */
export async function setCalendarHidden(hidden: boolean): Promise<void> {
  try {
    await invoke('set_calendar_hidden', { hidden });
  } catch {
    // Silently fail
  }
}

/**
 * Check if the Slack community CTA is hidden on the dashboard.
 */
export async function getSlackCtaHidden(): Promise<boolean> {
  try {
    return await invoke<boolean>('get_slack_cta_hidden');
  } catch {
    return false;
  }
}

/**
 * Set whether the Slack community CTA is hidden (persisted across sessions).
 */
export async function setSlackCtaHidden(hidden: boolean): Promise<void> {
  try {
    await invoke('set_slack_cta_hidden', { hidden });
  } catch {
    // Silently fail
  }
}

/**
 * Check whether the terminal uses WebGL (GPU-accelerated) rendering. Defaults to true.
 * Users on macOS beta builds or certain GPU drivers may see corrupted glyphs with WebGL
 * and should disable this.
 */
export async function getTerminalGpuEnabled(): Promise<boolean> {
  try {
    return await invoke<boolean>('get_terminal_gpu_enabled');
  } catch {
    return true;
  }
}

/**
 * Set whether the terminal uses WebGL rendering (persisted across sessions).
 * Takes effect for newly opened terminals.
 */
export async function setTerminalGpuEnabled(enabled: boolean): Promise<void> {
  try {
    await invoke('set_terminal_gpu_enabled', { enabled });
  } catch {
    // Silently fail
  }
}
