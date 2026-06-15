/**
 * Vercel project domain lookup.
 *
 * Ship Studio publishes via Vercel's GitHub integration and only ever knew the
 * git push — never the deployed domain. This reads the production custom domain
 * Vercel actually has configured so the UI can show the real site address.
 *
 * @module lib/vercel
 */

import { invoke } from '@tauri-apps/api/core';

/** Production domains Vercel reports for a linked project (snake_case from Rust). */
export interface VercelDomainInfo {
  /** Verified production custom domain (e.g. "pop.bimbi.co"), or null. */
  custom_domain: string | null;
  /** System `*.vercel.app` URL, used as a fallback display, or null. */
  system_url: string | null;
}

/**
 * Fetch a linked project's production custom domain. Returns null when the
 * project isn't linked to Vercel, the CLI isn't authenticated, or there's no
 * domain to report — never a constructed URL.
 */
export async function getVercelProductionDomain(
  projectPath: string
): Promise<VercelDomainInfo | null> {
  return invoke<VercelDomainInfo | null>('get_vercel_production_domain', { projectPath });
}

/** The single address to show/open: the custom domain if any, else the system url. */
export function liveSiteHost(domain: VercelDomainInfo | null): string | null {
  return domain?.custom_domain ?? domain?.system_url ?? null;
}
