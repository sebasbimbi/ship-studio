/**
 * Custom React hooks for common UI patterns.
 *
 * @module hooks/useClickOutside
 */

import { useEffect, RefObject } from 'react';

/**
 * Hook that detects clicks outside a referenced element.
 *
 * Useful for closing dropdowns, modals, and popovers when the user
 * clicks outside of them. The callback is only fired when enabled is true.
 *
 * @example
 * ```tsx
 * const dropdownRef = useRef<HTMLDivElement>(null);
 * const [isOpen, setIsOpen] = useState(false);
 *
 * useClickOutside(dropdownRef, () => setIsOpen(false), isOpen);
 * ```
 *
 * @param ref - Reference to the element to monitor
 * @param callback - Function to call when clicking outside
 * @param enabled - Whether the hook is active (default: true)
 * @param excludeSelector - Optional CSS selector for elements to exclude from outside detection
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  callback: () => void,
  enabled = true,
  excludeSelector?: string
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && !ref.current.contains(target)) {
        // Check if click is on an excluded element
        if (excludeSelector && (target as Element).closest?.(excludeSelector)) {
          return;
        }
        callback();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, callback, enabled, excludeSelector]);
}
