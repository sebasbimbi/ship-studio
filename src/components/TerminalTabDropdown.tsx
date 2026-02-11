/**
 * TerminalTabDropdown - dropdown menu for individual terminal tabs.
 *
 * Replaces the X close button with a chevron that opens a menu
 * with tab actions (close tab, and more to come).
 *
 * @module components/TerminalTabDropdown
 */

import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '../hooks/useClickOutside';
import { ChevronIcon, CloseIcon } from './icons';

interface TerminalTabDropdownProps {
  onClose: () => void;
}

export function TerminalTabDropdown({ onClose }: TerminalTabDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setIsOpen(false), []);
  useClickOutside(menuRef, closeMenu, isOpen);

  return (
    <div className="terminal-tab-dropdown-container" ref={menuRef}>
      <span
        className="terminal-tab-chevron"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        <ChevronIcon size={10} />
      </span>

      {isOpen && (
        <div className="terminal-tab-dropdown-menu">
          <button
            className="terminal-tab-dropdown-item danger"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
              onClose();
            }}
          >
            <CloseIcon size={12} />
            <span>Close tab</span>
          </button>
        </div>
      )}
    </div>
  );
}
