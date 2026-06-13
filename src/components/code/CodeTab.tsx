/**
 * Code browser tab container component.
 *
 * Combines a file tree sidebar with a syntax-highlighted code viewer.
 * Includes a draggable divider for resizing the two panes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFileTree } from '../../hooks/useFileTree';
import { useTreeDnd } from '../../hooks/useTreeDnd';
import { FileTree } from './FileTree';
import { CodeViewer } from './CodeViewer';
import { ConflictPromptModal } from './ConflictPromptModal';
import { Spinner } from '../primitives/Spinner';
import { Button } from '../primitives/Button';
import { ResetIcon, SearchIcon } from '../icons';
import {
  moveProjectEntry,
  type ConflictResolution,
  type FileTreeNode,
  fileExtensionForAnalytics,
} from '../../lib/code';
import { asCommandError, formatCommandError } from '../../lib/errors';
import { useOptionalToast } from '../../contexts/ToastContext';
import { trackEvent, trackSearch } from '../../lib/analytics';

/** Extensions whose moves can break source-level imports/references. */
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'vue',
  'svelte',
  'astro',
  'rs',
  'py',
  'rb',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'cs',
  'php',
  'css',
  'scss',
]);

const baseName = (p: string): string => p.split('/').pop() ?? p;
const isCodeFile = (p: string): boolean => CODE_EXTENSIONS.has(fileExtensionForAnalytics(p));

interface CodeTabProps {
  projectPath: string;
  onSendToAgent?: (text: string) => void;
  /** Jump-to-code target: open this file and highlight/scroll to the line. */
  revealTarget?: { file: string; line: number } | null;
}

export function CodeTab({ projectPath, onSendToAgent, revealTarget }: CodeTabProps) {
  const {
    tree,
    expandedPaths,
    selectedFilePath,
    fileContent,
    isLoadingTree,
    isLoadingFile,
    treeError,
    fileError,
    toggleDirectory,
    expandDir,
    selectFile: selectFileRaw,
    refreshTree: refreshTreeRaw,
  } = useFileTree(projectPath);

  const selectFile = useCallback(
    (path: string) => {
      void trackEvent('code_file_opened', {
        file_extension: fileExtensionForAnalytics(path),
      });
      selectFileRaw(path);
    },
    [selectFileRaw]
  );

  const refreshTree = useCallback(() => {
    void trackEvent('code_tree_refreshed');
    refreshTreeRaw();
  }, [refreshTreeRaw]);

  // Jump-to-code: open the targeted file. The line is forwarded to CodeViewer
  // (which scrolls + highlights it) independently, so re-targeting the same file
  // still reveals the new line even though selectFile early-returns.
  useEffect(() => {
    if (revealTarget) selectFileRaw(revealTarget.file);
  }, [revealTarget, selectFileRaw]);

  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const filteredTree = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tree;

    function filterNodes(nodes: FileTreeNode[]): FileTreeNode[] {
      const result: FileTreeNode[] = [];
      for (const node of nodes) {
        if (node.isDirectory) {
          const filteredChildren = filterNodes(node.children);
          if (filteredChildren.length > 0) {
            result.push({ ...node, children: filteredChildren });
          }
        } else if (node.name.toLowerCase().includes(query)) {
          result.push(node);
        }
      }
      return result;
    }

    return filterNodes(tree);
  }, [tree, searchQuery]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    let rafId: number | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!isDragging.current || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        setSidebarWidth(Math.max(150, Math.min(newWidth, 500)));
      });
    };

    const handleMouseUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // ---- In-tree move (drag-and-drop) ----
  const toast = useOptionalToast();
  const [conflict, setConflict] = useState<{ from: string; toDir: string; name: string } | null>(
    null
  );

  const performMove = useCallback(
    async (from: string, toDir: string, resolution: ConflictResolution) => {
      try {
        const newRel = await moveProjectEntry(projectPath, from, toDir, resolution);
        refreshTreeRaw();
        expandDir(toDir);
        // Keep the viewer in sync when the open file — or a folder containing it
        // — is what moved; otherwise it would point at a now-dead path.
        if (selectedFilePath === from) {
          selectFileRaw(newRel);
        } else if (selectedFilePath?.startsWith(`${from}/`)) {
          selectFileRaw(`${newRel}${selectedFilePath.slice(from.length)}`);
        }
        void trackEvent('code_entry_moved');
        // Always confirm the move; append the may-break-imports caveat (don't
        // auto-fix) only for code files whose references could now be stale.
        const movedName = baseName(newRel);
        toast.showToast(
          isCodeFile(newRel)
            ? `Moved ${movedName}. If it's imported elsewhere, update those paths or ask your agent.`
            : `Moved ${movedName} to ${baseName(toDir) || 'project root'}.`,
          isCodeFile(newRel) ? 'info' : 'success'
        );
      } catch (e) {
        const err = asCommandError(e);
        if (err.type === 'Validation' && err.field === 'destination') {
          setConflict({ from, toDir, name: baseName(from) });
        } else {
          toast.showToast(formatCommandError(err), 'error');
        }
      }
    },
    [projectPath, refreshTreeRaw, expandDir, selectedFilePath, selectFileRaw, toast]
  );

  const handleTreeMove = useCallback(
    (from: string, toDir: string) => void performMove(from, toDir, 'error'),
    [performMove]
  );

  // In-tree drag is disabled while a search filter is active: the filtered view
  // hides siblings, so the drop target would be ambiguous.
  const dnd = useTreeDnd({ onMove: handleTreeMove, enabled: !searchQuery.trim() });

  return (
    <div className="code-tab" ref={containerRef}>
      <div className="code-tab-sidebar" style={{ width: sidebarWidth }}>
        <div className="code-tab-sidebar-header">
          <span className="code-tab-sidebar-title">Files</span>
          <button className="code-tab-refresh-btn" onClick={refreshTree} title="Refresh file tree">
            <ResetIcon size={12} />
          </button>
        </div>
        <div className="code-tab-search">
          <SearchIcon size={12} />
          <input
            className="code-tab-search-input"
            type="text"
            placeholder="Search files..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              trackSearch('code_files', e.target.value);
            }}
          />
        </div>
        <div
          className={`code-tab-sidebar-content${dnd.dropTargetDir === '' ? ' root-drop-target' : ''}`}
          onDragOver={dnd.onRootDragOver}
          onDrop={dnd.onRootDrop}
        >
          {isLoadingTree ? (
            <div className="code-tab-sidebar-loading">
              <Spinner size="sm" style={{ color: 'var(--accent)' }} />
            </div>
          ) : treeError ? (
            <div className="code-tab-sidebar-error">
              <span>Failed to load files</span>
              <Button variant="secondary" size="sm" onClick={refreshTree}>
                Retry
              </Button>
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="code-tab-sidebar-empty">
              {searchQuery.trim() ? 'No matching files' : 'No files found'}
            </div>
          ) : (
            <FileTree
              nodes={filteredTree}
              expandedPaths={expandedPaths}
              selectedFilePath={selectedFilePath}
              onToggleDirectory={toggleDirectory}
              onSelectFile={selectFile}
              dnd={searchQuery.trim() ? undefined : dnd}
            />
          )}
        </div>
      </div>
      <div className="code-tab-divider" onMouseDown={handleMouseDown} />
      <div className="code-tab-viewer">
        <CodeViewer
          projectPath={projectPath}
          filePath={selectedFilePath}
          fileContent={fileContent}
          isLoading={isLoadingFile}
          error={fileError}
          onSendToAgent={onSendToAgent}
          revealLine={revealTarget?.line}
        />
      </div>
      <ConflictPromptModal
        isOpen={!!conflict}
        name={conflict?.name ?? ''}
        // Root drops pass undefined → the modal reads "this folder" (no fake label).
        targetLabel={conflict && conflict.toDir ? baseName(conflict.toDir) : undefined}
        // Single in-tree move: applyToAll is intentionally unused (remaining=0).
        onResolve={(choice) => {
          const c = conflict;
          setConflict(null);
          if (c && choice !== 'skip') void performMove(c.from, c.toDir, choice);
        }}
        onClose={() => setConflict(null)}
      />
    </div>
  );
}
