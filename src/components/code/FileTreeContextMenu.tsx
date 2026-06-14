/**
 * Right-click context menu for a file-tree entry in the Code tab.
 *
 * Renders a small fixed-position menu at the cursor and closes on outside
 * click, Escape, scroll, or window blur. Currently exposes a single Delete
 * action (moves the entry to the OS Trash). Kept separate from CodeTab so the
 * open/close lifecycle and the keyboard/pointer dismissal live in one place.
 *
 * @module components/code/FileTreeContextMenu
 */

import { useEffect, useRef } from 'react';
import { TrashIcon } from '../icons';

interface FileTreeContextMenuProps {
  /** Viewport coordinates (clientX/clientY) of the right-click. */
  x: number;
  y: number;
  /** Display name of the right-clicked entry. */
  name: string;
  /** Invoke the delete flow for the entry. */
  onDelete: () => void;
  /** Close the menu without acting. */
  onClose: () => void;
}

export function FileTreeContextMenu({ x, y, name, onDelete, onClose }: FileTreeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on any interaction outside the menu. Pointerdown (not click) closes
  // before a downstream click lands; scroll/blur/Escape cover the rest.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="file-tree-context-menu"
      style={{ top: y, left: x }}
      role="menu"
      aria-label={`Actions for ${name}`}
    >
      <button
        type="button"
        className="file-tree-context-menu-item danger"
        role="menuitem"
        autoFocus
        onClick={onDelete}
      >
        <TrashIcon size={13} />
        <span>Delete</span>
      </button>
    </div>
  );
}
