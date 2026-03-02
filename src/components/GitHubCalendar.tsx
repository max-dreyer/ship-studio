/**
 * GitHub contribution calendar component.
 *
 * Displays a user's GitHub contribution graph using react-github-calendar.
 * Shows contribution activity to encourage daily engagement.
 * Shows skeleton until auth check confirms status, then real data or hides.
 *
 * @module components/GitHubCalendar
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { GitHubCalendar as GitHubCalendarLib, type Activity } from 'react-github-calendar';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import { EyeOffIcon } from './icons';

interface GitHubCalendarProps {
  /** GitHub username to display contributions for */
  username: string | null | undefined;
  /** Whether GitHub is authenticated */
  isAuthenticated?: boolean;
  /** Whether the auth check has completed */
  isAuthCheckDone?: boolean;
  /** Called when the user clicks the hide button */
  onHide?: () => void;
}

// Custom theme using app colors
const theme = {
  dark: ['#2d2d2d', '#0e4429', '#006d32', '#26a641', '#54e36e'],
};

function formatTooltip(activity: { date: string; count: number }): string {
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

function renderBlock(
  block: React.ReactElement,
  activity: { date: string; count: number; level: number }
) {
  return (
    <g data-tooltip-id="github-calendar-tooltip" data-tooltip-content={formatTooltip(activity)}>
      {block}
    </g>
  );
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
  onHide,
}: GitHubCalendarProps) {
  const currentYear = new Date().getFullYear();
  const [dataLoaded, setDataLoaded] = useState(false);
  const dataLoadedRef = useRef(false);

  // Reset data loaded state when username changes
  useEffect(() => {
    setDataLoaded(false); // eslint-disable-line react-hooks/set-state-in-effect -- intentional: reset loading state when username prop changes
    dataLoadedRef.current = false;
  }, [username]);

  const transformData = useCallback((data: Activity[]) => {
    if (!dataLoadedRef.current) {
      dataLoadedRef.current = true;
      setTimeout(() => setDataLoaded(true), 0);
    }
    return data;
  }, []);

  // Only hide after auth check is DONE and confirmed NOT authenticated
  if (isAuthCheckDone && !isAuthenticated) {
    return null;
  }

  // Show skeleton while waiting for auth check OR waiting for data
  const showSkeleton = !isAuthCheckDone || !username || !dataLoaded;

  return (
    <div className="github-calendar-wrapper">
      {onHide && (
        <button
          className="github-calendar-hide-btn"
          onClick={onHide}
          title="Hide activity calendar"
          aria-label="Hide activity calendar"
        >
          <EyeOffIcon size={14} />
        </button>
      )}
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
            renderBlock={renderBlock}
            transformData={transformData}
          />
        </div>
      )}
      <Tooltip id="github-calendar-tooltip" className="github-calendar-tooltip" />
    </div>
  );
}
