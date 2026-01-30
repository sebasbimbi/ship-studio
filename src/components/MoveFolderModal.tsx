/**
 * MoveFolderModal component for moving a project to a folder.
 *
 * Displays a list of available folders and an option to remove from folder.
 *
 * @module components/MoveFolderModal
 */

import { useState, useEffect } from 'react';
import { FolderInfo, listFolders } from '../lib/folders';
import { FolderIcon, CheckIcon } from './icons';

/** Props for the MoveFolderModal component */
interface MoveFolderModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Callback when a folder is selected */
  onSelect: (folderId: string | null) => Promise<void>;
  /** Project name to display */
  projectName: string;
  /** Current folder ID (if project is in a folder) */
  currentFolderId: string | null;
}

export function MoveFolderModal({
  isOpen,
  onClose,
  onSelect,
  projectName,
  currentFolderId,
}: MoveFolderModalProps) {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);

  // Load folders when modal opens
  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      listFolders()
        .then(setFolders)
        .catch((err) => console.error('Failed to load folders:', err))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

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

  const handleSelect = async (folderId: string | null) => {
    if (selecting) return;

    setSelecting(true);
    try {
      await onSelect(folderId);
      onClose();
    } catch (err) {
      console.error('Failed to move project:', err);
    } finally {
      setSelecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal move-folder-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Move to Folder</h3>
        <p className="modal-subtitle">
          Move <strong>{projectName}</strong> to:
        </p>

        {loading ? (
          <div className="move-folder-loading">
            <div className="spinner" />
          </div>
        ) : (
          <div className="move-folder-list">
            {/* No Folder option */}
            <button
              className={`move-folder-item ${currentFolderId === null ? 'active' : ''}`}
              onClick={() => void handleSelect(null)}
              disabled={selecting || currentFolderId === null}
            >
              <span className="move-folder-item-name">No Folder (Root)</span>
              {currentFolderId === null && <CheckIcon size={16} />}
            </button>

            {/* Folder options */}
            {folders.map((folder) => (
              <button
                key={folder.id}
                className={`move-folder-item ${currentFolderId === folder.id ? 'active' : ''}`}
                onClick={() => void handleSelect(folder.id)}
                disabled={selecting || currentFolderId === folder.id}
              >
                <FolderIcon size={16} />
                <span className="move-folder-item-name">{folder.name}</span>
                <span className="move-folder-item-count">
                  {folder.project_count} {folder.project_count === 1 ? 'project' : 'projects'}
                </span>
                {currentFolderId === folder.id && <CheckIcon size={16} />}
              </button>
            ))}

            {folders.length === 0 && (
              <p className="move-folder-empty">No folders yet. Create a folder first.</p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={selecting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
