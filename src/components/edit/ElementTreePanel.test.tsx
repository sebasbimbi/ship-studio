import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ElementTreePanel } from './ElementTreePanel';
import type { ElementTreeNode } from '../../hooks/useElementTree';

// body
//   header (2)
//   div.route-fade (3)
//     h2 (5)
//     span (6)
//   footer (4)
const TREE: ElementTreeNode = {
  id: 1,
  tag: 'body',
  cls: '',
  text: '',
  children: [
    { id: 2, tag: 'header', cls: '', text: '', children: [] },
    {
      id: 3,
      tag: 'div',
      cls: 'route-fade',
      text: '',
      children: [
        { id: 5, tag: 'h2', cls: '', text: '', children: [] },
        { id: 6, tag: 'span', cls: '', text: '', children: [] },
      ],
    },
    { id: 4, tag: 'footer', cls: '', text: '', children: [] },
  ],
};

function setup(selectedId: number | null) {
  const onSelect = vi.fn<(id: number) => void>();
  render(
    <ElementTreePanel
      tree={TREE}
      truncated={false}
      selectedId={selectedId}
      onSelect={onSelect}
      onHover={() => {}}
    />
  );
  return { onSelect };
}

describe('ElementTreePanel keyboard navigation', () => {
  it('ArrowDown selects the next sibling', () => {
    const { onSelect } = setup(3);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('ArrowUp selects the previous sibling', () => {
    const { onSelect } = setup(3);
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('ArrowLeft selects the parent', () => {
    const { onSelect } = setup(3);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('ArrowRight dives into the first child', () => {
    const { onSelect } = setup(3);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(5);
  });

  it('does not wrap past the first sibling', () => {
    const { onSelect } = setup(2); // header is the first child of body
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not wrap past the last sibling', () => {
    const { onSelect } = setup(4); // footer is the last child of body
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing for the root (no parent, no siblings)', () => {
    const { onSelect } = setup(1);
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing when no element is selected', () => {
    const { onSelect } = setup(null);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores arrows while a text field is focused (e.g. the edit panel)', () => {
    const onSelect = vi.fn<(id: number) => void>();
    render(
      <>
        <input data-testid="field" />
        <ElementTreePanel
          tree={TREE}
          truncated={false}
          selectedId={3}
          onSelect={onSelect}
          onHover={() => {}}
        />
      </>
    );
    const field = screen.getByTestId('field');
    field.focus();
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
