import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CssEditorPanel } from './CssEditorPanel';
import type { CssSelection } from '../../hooks/useCssEditor';

// jsdom has no CSS.supports — stub it so the value-validation path is exercised.
beforeAll(() => {
  if (typeof CSS === 'undefined') {
    (globalThis as unknown as { CSS: unknown }).CSS = {};
  }
  (CSS as unknown as { supports: (p: string, v: string) => boolean }).supports = (
    _p: string,
    v: string
  ) => v.trim() !== '' && !v.includes('@@');
});

const sig = (className: string) => ({ className, tagName: 'div', ancestorClasses: [] });

function renderPanel(
  selection: CssSelection | null,
  overrides: Partial<Parameters<typeof CssEditorPanel>[0]> = {}
) {
  const props = {
    selection,
    authoredSheets: ['src/styles/main.css'],
    saving: false,
    onPreview: vi.fn(),
    onSave: vi.fn(),
    onCreateRule: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<CssEditorPanel {...props} />);
  return props;
}

describe('CssEditorPanel', () => {
  it('shows the empty state before a selection', () => {
    renderPanel(null);
    expect(screen.getByText(/click an element to edit its styles/i)).toBeInTheDocument();
  });

  it('renders a resolved rule’s declarations and the selector', () => {
    const selection: CssSelection = {
      signature: sig('hero-title'),
      resolution: {
        status: 'resolved',
        file: 'src/styles/main.css',
        selector: '.hero-title',
        line: 4,
        media_min_px: null,
        declarations: [
          { property: 'color', value: 'red', important: false },
          { property: 'padding', value: '24px', important: false },
        ],
      },
      instanceCount: 1,
    };
    renderPanel(selection);
    expect(screen.getByText('.hero-title')).toBeInTheDocument();
    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByDisplayValue('24px')).toBeInTheDocument();
  });

  it('saves an edited declaration value on Enter', () => {
    const onSave = vi.fn();
    const selection: CssSelection = {
      signature: sig('hero-title'),
      resolution: {
        status: 'resolved',
        file: 'src/styles/main.css',
        selector: '.hero-title',
        line: 4,
        media_min_px: null,
        declarations: [{ property: 'color', value: 'red', important: false }],
      },
      instanceCount: 1,
    };
    renderPanel(selection, { onSave });
    const input = screen.getByDisplayValue('red');
    fireEvent.change(input, { target: { value: 'blue' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('color', 'blue');
  });

  it('offers to create a rule when none is found', () => {
    const onCreateRule = vi.fn();
    const selection: CssSelection = {
      signature: sig('hero'),
      resolution: { status: 'not_found', selector: '.hero' },
      instanceCount: 1,
    };
    renderPanel(selection, { onCreateRule });
    fireEvent.click(screen.getByRole('button', { name: /create \.hero/i }));
    expect(onCreateRule).toHaveBeenCalledWith('src/styles/main.css', '.hero', []);
  });

  it('shows read-only guidance for a multiply-defined class', () => {
    const selection: CssSelection = {
      signature: sig('hero'),
      resolution: {
        status: 'multiple',
        selector: '.hero',
        locations: [
          { file: 'a.css', line: 1, column: 1 },
          { file: 'b.css', line: 2, column: 1 },
        ],
      },
      instanceCount: 1,
    };
    renderPanel(selection);
    expect(screen.getByText(/isn't safe to edit automatically/i)).toBeInTheDocument();
    expect(screen.getByText('a.css:1')).toBeInTheDocument();
  });
});
