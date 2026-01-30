/**
 * NewFolderModal component for creating new folders.
 *
 * Provides a simple form with folder name input and create/cancel buttons.
 *
 * @module components/NewFolderModal
 */

import { useState, useRef, useEffect } from 'react';

/** Props for the NewFolderModal component */
interface NewFolderModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when folder is created (receives folder name) */
  onCreate: (name: string) => Promise<void>;
  /** Initial name value (for rename mode) */
  initialName?: string;
  /** Title for the modal */
  title?: string;
  /** Button label */
  buttonLabel?: string;
}

export function NewFolderModal({
  isOpen,
  onClose,
  onCreate,
  initialName = '',
  title = 'New Folder',
  buttonLabel = 'Create',
}: NewFolderModalProps) {
  const [name, setName] = useState(initialName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setError(null);
      setLoading(false);
      // Focus input after a short delay to ensure modal is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialName]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Folder name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onCreate(trimmedName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="form-group">
            <label htmlFor="folder-name">Folder name</label>
            <input
              ref={inputRef}
              id="folder-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Projects"
              disabled={loading}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading || !name.trim()}>
              {loading ? 'Creating...' : buttonLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
