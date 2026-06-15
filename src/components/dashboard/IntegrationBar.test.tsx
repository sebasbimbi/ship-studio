/**
 * Tests for IntegrationBar — the actionable dashboard integrations card.
 *
 * Covers the per-row action gating:
 *   - not-installed tool        → Install button
 *   - not-authenticated account → Connect button
 *   - ready account             → kebab with Reconnect + Disconnect (no Install/Connect)
 *   - ready coding-agent binary → kebab with Update + Uninstall
 *   - ready system tool         → no action affordance
 * plus a couple of behaviors (Disconnect invokes logout; Connect opens a terminal).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { SetupItem } from '../../lib/setup';

const invokeResults = new Map<string, { value?: unknown; error?: Error }>();
const invokeCalls: Array<{ cmd: string; args?: unknown }> = [];

function mockInvoke(cmd: string, value: unknown) {
  invokeResults.set(cmd, { value });
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: unknown) => {
    invokeCalls.push({ cmd, args });
    const result = invokeResults.get(cmd);
    if (result?.error) return Promise.reject(result.error);
    if (result) return Promise.resolve(result.value);
    return Promise.resolve(undefined);
  }),
}));

// Avoid pulling xterm / tauri-pty into jsdom.
vi.mock('../setup/OnboardingTerminal', () => ({
  OnboardingTerminal: () => <div data-testid="mock-terminal" />,
}));

vi.mock('../icons', () => ({
  CheckIcon: () => <span data-testid="check-icon" />,
  WarningIcon: () => <span data-testid="warning-icon" />,
  ChevronIcon: () => <span data-testid="chevron-icon" />,
  ClaudeIcon: () => <span data-testid="claude-icon" />,
  GitHubIcon: () => <span data-testid="github-icon" />,
}));

import { IntegrationBar } from './IntegrationBar';

function item(overrides: Partial<SetupItem> & Pick<SetupItem, 'id'>): SetupItem {
  return {
    friendlyName: overrides.id,
    status: 'ready',
    ...overrides,
  } as SetupItem;
}

function setItems(items: SetupItem[]) {
  mockInvoke('get_full_setup_status', {
    allReady: false,
    items,
    optionalAuths: { githubAuthenticated: false },
    detectedAgents: [],
  });
}

async function renderExpanded(items: SetupItem[]) {
  setItems(items);
  render(<IntegrationBar />);
  // expand the card so the rows render
  await waitFor(() => screen.getByText('Integrations'));
  fireEvent.click(screen.getByRole('button', { name: /integrations/i }));
}

beforeEach(() => {
  invokeResults.clear();
  invokeCalls.length = 0;
});

describe('IntegrationBar action gating', () => {
  it('shows Install for a not-installed tool and Connect for a not-authenticated account', async () => {
    await renderExpanded([
      item({ id: 'gh', friendlyName: 'GitHub connector', status: 'not_installed' }),
      item({ id: 'vercel_auth', friendlyName: 'Vercel Account', status: 'not_authenticated' }),
    ]);
    await waitFor(() => screen.getByText('GitHub connector'));
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('offers no action affordance for a ready system tool', async () => {
    await renderExpanded([
      item({ id: 'homebrew', friendlyName: 'Package Manager', status: 'ready', version: '6.0.1' }),
    ]);
    await waitFor(() => screen.getByText('Package Manager'));
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
  });

  it('shows Reconnect + Disconnect in a ready account kebab, and Disconnect logs out', async () => {
    await renderExpanded([
      item({ id: 'gh_auth', friendlyName: 'GitHub Account', status: 'ready', username: 'octocat' }),
    ]);
    await waitFor(() => screen.getByText('GitHub Account'));
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /More actions for GitHub Account/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Reconnect' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(invokeCalls.some((c) => c.cmd === 'logout_github')).toBe(true);
    });
  });

  it('shows Update + Uninstall in a ready coding-agent kebab', async () => {
    await renderExpanded([
      item({ id: 'claude', friendlyName: 'Claude Code', status: 'ready', version: '2.1.0' }),
    ]);
    await waitFor(() => screen.getByText('Claude Code'));
    fireEvent.click(screen.getByRole('button', { name: /More actions for Claude Code/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Update' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Uninstall' })).toBeTruthy();
  });

  it('opens a terminal when connecting an agent account', async () => {
    await renderExpanded([
      item({ id: 'codex_auth', friendlyName: 'Codex Account', status: 'not_authenticated' }),
    ]);
    await waitFor(() => screen.getByText('Codex Account'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByTestId('mock-terminal')).toBeTruthy());
  });
});
