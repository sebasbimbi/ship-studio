/**
 * GitHub contribution calendar component.
 *
 * Displays a user's GitHub contribution graph using react-github-calendar.
 * Shows contribution activity to encourage daily engagement.
 * Shows skeleton until auth check confirms status, then real data or hides.
 *
 * @module components/GitHubCalendar
 */

import { useState, useEffect } from 'react';
import { GitHubCalendar as GitHubCalendarLib } from 'react-github-calendar';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';

interface Activity {
  date: string;
  count: number;
  level: number;
}

interface GitHubCalendarProps {
  /** GitHub username to display contributions for */
  username: string | null | undefined;
  /** Whether GitHub is authenticated */
  isAuthenticated?: boolean;
  /** Whether the auth check has completed */
  isAuthCheckDone?: boolean;
}

// Custom theme using app colors
const theme = {
  dark: ['#2d2d2d', '#0e4429', '#006d32', '#26a641', '#54e36e'],
};

function formatTooltip(activity: Activity): string {
  const date = new Date(activity.date);
  const formatted = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (activity.count === 0) {
    return `No contributions on ${formatted}`;
  }

  const s = activity.count === 1 ? '' : 's';
  return `${activity.count} contribution${s} on ${formatted}`;
}

function CalendarSkeleton() {
  return (
    <div className="github-calendar-skeleton">
      <div className="github-calendar-skeleton-grid">
        {Array.from({ length: 371 }).map((_, i) => (
          <div key={i} className="github-calendar-skeleton-block" />
        ))}
      </div>
    </div>
  );
}

export function GitHubCalendar({
  username,
  isAuthenticated,
  isAuthCheckDone,
}: GitHubCalendarProps) {
  const currentYear = new Date().getFullYear();
  const [dataLoaded, setDataLoaded] = useState(false);

  // Reset data loaded state when username changes
  useEffect(() => {
    setDataLoaded(false);
  }, [username]);

  // Only hide after auth check is DONE and confirmed NOT authenticated
  if (isAuthCheckDone && !isAuthenticated) {
    return null;
  }

  // Show skeleton while waiting for auth check OR waiting for data
  const showSkeleton = !isAuthCheckDone || !username || !dataLoaded;

  return (
    <div className="github-calendar-wrapper">
      {showSkeleton && <CalendarSkeleton />}
      {username && (
        <div style={{ display: dataLoaded ? 'block' : 'none' }}>
          <GitHubCalendarLib
            username={username}
            colorScheme="dark"
            theme={theme}
            blockSize={12}
            blockMargin={4}
            blockRadius={3}
            fontSize={12}
            showColorLegend={false}
            showTotalCount={false}
            year={currentYear}
            renderBlock={(block, activity) => (
              <g
                data-tooltip-id="github-calendar-tooltip"
                data-tooltip-content={formatTooltip(activity)}
              >
                {block}
              </g>
            )}
            transformData={(data) => {
              // Called when data is loaded
              setTimeout(() => setDataLoaded(true), 0);
              return data;
            }}
          />
        </div>
      )}
      <Tooltip id="github-calendar-tooltip" className="github-calendar-tooltip" />
    </div>
  );
}
