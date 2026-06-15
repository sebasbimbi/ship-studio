/**
 * Element tree panel — a read-only, Webflow-style navigator for the preview.
 *
 * Shows the rendered DOM as a collapsible tree; clicking a row selects the
 * element through the same path as clicking it on the canvas, so the visual
 * editor panel picks it up. No editing or renaming here by design.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRightIcon } from '../icons';
import type { ElementTreeNode } from '../../hooks/useElementTree';

interface Props {
  tree: ElementTreeNode | null;
  truncated: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
}

/** Rows at depth < this start expanded so the tree isn't a single chevron. */
const AUTO_EXPAND_DEPTH = 3;

/** Map of node id → ancestor id chain, for auto-expanding to a selection. */
function buildAncestors(root: ElementTreeNode): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const walk = (node: ElementTreeNode, chain: number[]) => {
    out.set(node.id, chain);
    const next = [...chain, node.id];
    for (const child of node.children) walk(child, next);
  };
  walk(root, []);
  return out;
}

function RowLabel({ node }: { node: ElementTreeNode }) {
  const firstClass = node.cls.split(/\s+/)[0] ?? '';
  return (
    <>
      <span className="ss-tree-tag">{node.tag}</span>
      {firstClass && <span className="ss-tree-class">.{firstClass}</span>}
      {node.text && <span className="ss-tree-text">{node.text}</span>}
    </>
  );
}

export function ElementTreePanel({ tree, truncated, selectedId, onSelect, onHover }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);

  const ancestors = useMemo(() => (tree ? buildAncestors(tree) : null), [tree]);

  // Flat lookups for keyboard navigation: each node by id, and each node's
  // parent id (null for the root). Rebuilt only when the tree snapshot changes.
  const navIndex = useMemo(() => {
    const nodeById = new Map<number, ElementTreeNode>();
    const parentById = new Map<number, number | null>();
    if (tree) {
      const walk = (node: ElementTreeNode, parent: number | null) => {
        nodeById.set(node.id, node);
        parentById.set(node.id, parent);
        for (const child of node.children) walk(child, node.id);
      };
      walk(tree, null);
    }
    return { nodeById, parentById };
  }, [tree]);

  // Selecting on the canvas should reveal the row: expand its ancestor chain
  // (presence in `collapsed` is depth-inverted — see collapsedState). Done as
  // a render-time state adjustment (the sanctioned "derive from prop change"
  // pattern) rather than an effect, so there's no cascading re-render.
  const [revealedFor, setRevealedFor] = useState<number | null>(null);
  if (selectedId !== revealedFor) {
    setRevealedFor(selectedId);
    const chain = selectedId != null ? ancestors?.get(selectedId) : undefined;
    if (chain) {
      let changed = false;
      const next = new Set(collapsed);
      chain.forEach((id, depth) => {
        const wantPresence = depth >= AUTO_EXPAND_DEPTH; // presence = expanded there
        if (wantPresence && !next.has(id)) {
          next.add(id);
          changed = true;
        } else if (!wantPresence && next.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      if (changed) setCollapsed(next);
    }
  }

  // Scroll the selected row into view once it exists in the DOM.
  useEffect(() => {
    if (selectedId == null) return;
    const raf = requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector(`[data-tree-id="${selectedId}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

  // Arrow-key navigation from the selected element: Up/Down move between
  // siblings (no wrap), Left selects the parent, Right dives into the first
  // child. `onSelect` runs the same path as a click, so the canvas + edit panel
  // follow and the target row auto-reveals + scrolls into view. The listener is
  // document-level (the tree rows aren't focusable), but it never steals arrows
  // from a focused text field or arrow-driven control in the edit panel.
  useEffect(() => {
    const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    const onKeyDown = (e: KeyboardEvent) => {
      if (selectedId == null || !NAV_KEYS.includes(e.key)) return;

      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      const role = el?.getAttribute('role');
      if (
        role &&
        ['combobox', 'listbox', 'menu', 'menuitem', 'slider', 'spinbutton', 'textbox'].includes(
          role
        )
      ) {
        return;
      }

      const parentId = navIndex.parentById.get(selectedId) ?? null;

      if (e.key === 'ArrowRight') {
        const first = navIndex.nodeById.get(selectedId)?.children[0];
        if (first) {
          e.preventDefault();
          onSelect(first.id);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (parentId != null) {
          e.preventDefault();
          onSelect(parentId);
        }
        return;
      }

      // Up/Down: previous/next sibling. Root has no siblings; ends don't wrap.
      if (parentId == null) return;
      const siblings = navIndex.nodeById.get(parentId)?.children ?? [];
      const idx = siblings.findIndex((s) => s.id === selectedId);
      if (idx === -1) return;
      const target = siblings[e.key === 'ArrowUp' ? idx - 1 : idx + 1];
      if (target) {
        e.preventDefault();
        onSelect(target.id);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedId, navIndex, onSelect]);

  const toggle = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Presence in `collapsed` flips the depth-based default: shallow nodes
  // default open (presence = collapsed), deep nodes default closed
  // (presence = expanded).
  const collapsedState = (id: number, depth: number) =>
    depth < AUTO_EXPAND_DEPTH ? collapsed.has(id) : !collapsed.has(id);

  const renderNode = (node: ElementTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    // Collapsed = explicitly collapsed, or deep and never explicitly expanded.
    // The `collapsed` set tracks explicit toggles both ways via presence.
    const isCollapsed = hasChildren && collapsedState(node.id, depth);
    return (
      <div key={node.id}>
        <div
          className={`ss-tree-row${node.id === selectedId ? ' selected' : ''}`}
          style={{ paddingLeft: depth * 14 + 6 }}
          data-tree-id={node.id}
          onClick={() => onSelect(node.id)}
          onMouseEnter={() => onHover(node.id)}
          onMouseLeave={() => onHover(null)}
        >
          {hasChildren ? (
            <button
              type="button"
              className={`ss-tree-chevron${isCollapsed ? '' : ' open'}`}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
              title={isCollapsed ? 'Expand' : 'Collapse'}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronRightIcon size={10} />
            </button>
          ) : (
            <span className="ss-tree-chevron-spacer" />
          )}
          <RowLabel node={node} />
        </div>
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="ss-tree-panel" data-testid="element-tree-panel">
      <div className="ss-tree-panel__header">
        <span className="ss-tree-panel__title">Elements</span>
      </div>
      <div className="ss-tree-panel__body" ref={bodyRef} onMouseLeave={() => onHover(null)}>
        {tree ? renderNode(tree, 0) : <div className="ss-tree-panel__empty">Loading elements…</div>}
        {truncated && (
          <div className="ss-tree-panel__note">
            Large page — showing the first part of the tree.
          </div>
        )}
      </div>
    </div>
  );
}
