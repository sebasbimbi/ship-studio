/**
 * Tests for PublishBranchDropdown's Vercel live-domain surface.
 *   - liveSiteHost picks custom domain → system url → null
 *   - on the main branch, the fetched custom domain renders and opens on click
 *   - on a feature branch, no domain is fetched or shown (production only)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { liveSiteHost } from '../../lib/vercel';
import { mockInvokeResponse } from '../../test/setup';

// @tauri-apps/api/core and @tauri-apps/plugin-opener are mocked centrally in
// src/test/setup.ts; openUrl is a vi.fn() we read back via vi.mocked below.
const openUrlMock = vi.mocked(openUrl);

import { PublishBranchDropdown } from './PublishBranchDropdown';

const baseProps = {
  currentBranch: 'main',
  projectGithubStatus: {
    status: 'connected' as const,
    github_repo: 'user/repo',
    github_url: 'https://github.com/user/repo',
  },
  projectPath: '/p',
  hasChangesToSync: true,
  onStatusChange: vi.fn(),
  isPublishing: false,
  setIsPublishing: vi.fn(),
};

// The centralized IPC + opener mocks are cleared between tests by the global
// beforeEach/afterEach in src/test/setup.ts.
beforeEach(() => {
  openUrlMock.mockClear();
});

describe('liveSiteHost', () => {
  it('prefers the custom domain, falls back to the system url, else null', () => {
    expect(
      liveSiteHost({
        custom_domain: 'pop.bimbi.co',
        system_url: 'x.vercel.app',
        production_url: 'https://pop.bimbi.co',
      })
    ).toBe('pop.bimbi.co');
    expect(
      liveSiteHost({
        custom_domain: null,
        system_url: 'x.vercel.app',
        production_url: 'https://x.vercel.app',
      })
    ).toBe('x.vercel.app');
    expect(
      liveSiteHost({ custom_domain: null, system_url: null, production_url: null })
    ).toBeNull();
    expect(liveSiteHost(null)).toBeNull();
  });
});

describe('PublishBranchDropdown live domain', () => {
  it('shows the Vercel custom domain on the main branch and opens it on click', async () => {
    mockInvokeResponse('get_vercel_production_domain', {
      custom_domain: 'pop.bimbi.co',
      system_url: 'pop-sandy-five.vercel.app',
      production_url: 'https://pop.bimbi.co',
    });
    render(<PublishBranchDropdown {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Publish/ }));

    const link = await screen.findByRole('button', { name: /pop\.bimbi\.co/ });
    fireEvent.click(link);
    expect(openUrlMock).toHaveBeenCalledWith('https://pop.bimbi.co');
  });

  it('does not show a domain on a feature branch', async () => {
    mockInvokeResponse('get_vercel_production_domain', {
      custom_domain: 'pop.bimbi.co',
      system_url: null,
      production_url: 'https://pop.bimbi.co',
    });
    render(<PublishBranchDropdown {...baseProps} currentBranch="feature/x" />);
    fireEvent.click(screen.getByRole('button', { name: /Sync/ }));

    await waitFor(() => screen.getByText(/Sync your changes/));
    expect(screen.queryByText('pop.bimbi.co')).toBeNull();
  });
});
