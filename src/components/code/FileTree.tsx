/**
 * Recursive file tree component for the code browser.
 *
 * Renders a tree of directories and files with expand/collapse,
 * selection highlighting, and sorted display (directories first).
 *
 * When a `dnd` controller is supplied, items become draggable for in-tree
 * MOVE: a folder row highlights as the drop target and the dragged row dims.
 * Without `dnd` the tree is purely presentational (read-only browser).
 */

import type { FileTreeNode } from '../../lib/code';
import type { TreeDnd } from '../../hooks/useTreeDnd';
import { ChevronRightIcon, FileIcon, FolderIcon } from '../icons';

interface FileTreeProps {
  nodes: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  /** Optional drag-and-drop controller (enables in-tree move). */
  dnd?: TreeDnd;
  level?: number;
}

export function FileTree({
  nodes,
  expandedPaths,
  selectedFilePath,
  onToggleDirectory,
  onSelectFile,
  dnd,
  level = 0,
}: FileTreeProps) {
  return (
    <div className="file-tree-nodes" role={level === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          expandedPaths={expandedPaths}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
          dnd={dnd}
          level={level}
        />
      ))}
    </div>
  );
}

interface FileTreeItemProps {
  node: FileTreeNode;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  dnd?: TreeDnd;
  level: number;
}

function FileTreeItem({
  node,
  expandedPaths,
  selectedFilePath,
  onToggleDirectory,
  onSelectFile,
  dnd,
  level,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = node.path === selectedFilePath;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggleDirectory(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  // A folder row is the drop target when it is the effective destination; the
  // dragged row dims while in flight.
  const isDropTarget = !!dnd && node.isDirectory && dnd.dropTargetDir === node.path;
  const isDragging = dnd?.draggingPath === node.path;

  const className = [
    'file-tree-item',
    isSelected ? 'selected' : '',
    isDropTarget ? 'drop-target' : '',
    isDragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <button
        className={className}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={handleClick}
        title={node.path}
        role="treeitem"
        aria-expanded={node.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
        aria-grabbed={dnd ? isDragging : undefined}
        draggable={!!dnd}
        onDragStart={dnd ? (e) => dnd.onItemDragStart(e, node) : undefined}
        onDragOver={dnd ? (e) => dnd.onItemDragOver(e, node) : undefined}
        onDrop={dnd ? (e) => dnd.onItemDrop(e, node) : undefined}
        onDragEnd={dnd ? dnd.onItemDragEnd : undefined}
      >
        {node.isDirectory && (
          <span className={`file-tree-chevron ${isExpanded ? 'expanded' : ''}`}>
            <ChevronRightIcon size={12} />
          </span>
        )}
        <span className="file-tree-icon">
          {node.isDirectory ? <FolderIcon size={14} /> : <FileIcon size={14} />}
        </span>
        <span className="file-tree-name">{node.name}</span>
      </button>
      {node.isDirectory && isExpanded && node.children.length > 0 && (
        <FileTree
          nodes={node.children}
          expandedPaths={expandedPaths}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
          dnd={dnd}
          level={level + 1}
        />
      )}
    </>
  );
}
