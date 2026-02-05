/**
 * Checklist of all setup items with their current status.
 *
 * Handles the display and action delegation for each item,
 * respecting dependencies and blocked states.
 *
 * Brew-installed packages (node, git, gh, vercel) that need installing
 * are collapsed into a single combined row for a cleaner UX.
 */

import { SetupItem } from './SetupItem';
import {
  SetupItem as SetupItemType,
  SETUP_ITEM_ORDER,
  OPTIONAL_ITEMS,
  SETUP_FRIENDLY_NAMES,
  BREW_PACKAGES,
  getBlockingDependencies,
} from '../../lib/setup';

interface SetupChecklistProps {
  items: SetupItemType[];
  /** Called when user clicks an action button */
  onItemAction: (itemId: string) => void;
  /** Called when user clicks skip for an optional item */
  onItemSkip?: (itemId: string) => void;
  /** ID of item currently being processed */
  activeItemId?: string | null;
  /** Whether a terminal is currently active */
  terminalActive?: boolean;
}

/**
 * Join names with commas and "&" for the last item.
 * e.g., ["GitHub CLI", "Vercel CLI"] → "GitHub CLI & Vercel CLI"
 * e.g., ["Node.js", "Git", "Vercel CLI"] → "Node.js, Git & Vercel CLI"
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function SetupChecklist({
  items,
  onItemAction,
  onItemSkip,
  activeItemId,
  terminalActive,
}: SetupChecklistProps) {
  // Sort items according to display order
  const sortedItems = [...items].sort((a, b) => {
    const aIndex = SETUP_ITEM_ORDER.indexOf(a.id);
    const bIndex = SETUP_ITEM_ORDER.indexOf(b.id);
    return aIndex - bIndex;
  });

  // Disable all buttons if any action is in progress or terminal is active
  const isAnyActionInProgress = activeItemId !== null || terminalActive === true;

  // Separate brew items into ready vs missing
  const readyBrewItems = sortedItems.filter(
    (item) => BREW_PACKAGES.has(item.id) && item.status === 'ready'
  );
  const missingBrewItems = sortedItems.filter(
    (item) => BREW_PACKAGES.has(item.id) && item.status !== 'ready'
  );
  const nonBrewItems = sortedItems.filter((item) => !BREW_PACKAGES.has(item.id));

  // Check if missing brew items are blocked (homebrew not installed)
  const brewItemsBlocked = missingBrewItems.some((item) => {
    const blockedBy = getBlockingDependencies(item.id, items);
    return blockedBy.length > 0;
  });

  // Determine combined row status
  const getCombinedStatus = (): SetupItemType['status'] => {
    if (brewItemsBlocked) return 'blocked';
    if (missingBrewItems.some((i) => i.status === 'in_progress')) return 'in_progress';
    if (missingBrewItems.some((i) => i.status === 'error')) return 'error';
    return 'not_installed';
  };

  // Get error message from any errored brew item
  const getCombinedError = (): string | undefined => {
    const errored = missingBrewItems.find((i) => i.status === 'error');
    return errored?.errorMessage;
  };

  // Build the combined virtual item for missing brew packages
  const combinedBrewItem: SetupItemType | null =
    missingBrewItems.length >= 2
      ? {
          id: missingBrewItems[0].id, // Use first item's ID to trigger batch install
          friendlyName: joinNames(
            missingBrewItems.map((i) => SETUP_FRIENDLY_NAMES[i.id] || i.friendlyName)
          ),
          status: getCombinedStatus(),
          errorMessage: getCombinedError(),
        }
      : null;

  // Build the final render list maintaining order:
  // 1. Homebrew (non-brew item, but first)
  // 2. Ready brew items (with checkmarks)
  // 3. Combined missing brew row OR single missing brew item
  // 4. Auth and other non-brew items
  const renderItems: Array<{
    item: SetupItemType;
    isCombined: boolean;
  }> = [];

  // Add homebrew first (it's a non-brew item that should come first)
  const homebrewItem = nonBrewItems.find((i) => i.id === 'homebrew');
  if (homebrewItem) {
    renderItems.push({ item: homebrewItem, isCombined: false });
  }

  // Add ready brew items individually
  for (const item of readyBrewItems) {
    renderItems.push({ item, isCombined: false });
  }

  // Add combined row or single missing brew item
  if (combinedBrewItem) {
    renderItems.push({ item: combinedBrewItem, isCombined: true });
  } else if (missingBrewItems.length === 1) {
    renderItems.push({ item: missingBrewItems[0], isCombined: false });
  }

  // Add remaining non-brew items (except homebrew which was already added)
  for (const item of nonBrewItems) {
    if (item.id === 'homebrew') continue;
    renderItems.push({ item, isCombined: false });
  }

  return (
    <div className="setup-checklist">
      {renderItems.map(({ item, isCombined }) => {
        const blockedBy = isCombined
          ? brewItemsBlocked
            ? [SETUP_FRIENDLY_NAMES['homebrew'] || 'Package Manager']
            : []
          : getBlockingDependencies(item.id, items);
        const isBlocked = blockedBy.length > 0 && item.status !== 'ready';
        const isOptional = OPTIONAL_ITEMS.has(item.id);

        // Override status to blocked if dependencies aren't ready
        const displayItem: SetupItemType = isBlocked ? { ...item, status: 'blocked' } : item;

        // For combined row, check if any of the brew items is the active item
        const isActive = isCombined
          ? missingBrewItems.some((i) => activeItemId === i.id)
          : activeItemId === item.id;

        return (
          <SetupItem
            key={isCombined ? 'brew-combined' : item.id}
            item={displayItem}
            blockedBy={blockedBy}
            onAction={() => onItemAction(item.id)}
            onSkip={isOptional && onItemSkip ? () => onItemSkip(item.id) : undefined}
            isActionInProgress={isActive}
            isAnyActionInProgress={isAnyActionInProgress}
            isOptional={isOptional}
          />
        );
      })}
    </div>
  );
}
