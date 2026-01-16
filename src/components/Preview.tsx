import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type Breakpoint = "desktop" | "tablet" | "mobile";

interface PageInfo {
  route: string;
  file_path: string;
}

const BREAKPOINTS: Record<Breakpoint, { width: string; label: string }> = {
  desktop: { width: "100%", label: "Desktop" },
  tablet: { width: "768px", label: "Tablet" },
  mobile: { width: "375px", label: "Mobile" },
};

// SVG icons for breakpoints
const BreakpointIcon = ({ type }: { type: Breakpoint }) => {
  if (type === "desktop") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
  if (type === "tablet") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <line x1="12" y1="18" x2="12" y2="18" strokeLinecap="round" />
    </svg>
  );
};

interface PreviewProps {
  port?: number;
  projectPath: string;
}

export function Preview({ port = 3000, projectPath }: PreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [serverReady, setServerReady] = useState(false);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("desktop");
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [currentPage, setCurrentPage] = useState("/");
  const [showPageDropdown, setShowPageDropdown] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const baseUrl = `http://localhost:${port}`;
  const currentUrl = `${baseUrl}${currentPage === "/" ? "" : currentPage}`;

  // Load pages
  const loadPages = async () => {
    try {
      const pageList = await invoke<PageInfo[]>("list_pages", { projectPath });
      setPages(pageList);
    } catch (error) {
      console.error("Failed to load pages:", error);
    }
  };

  // Load pages on mount and periodically
  useEffect(() => {
    loadPages();
    const interval = setInterval(loadPages, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [projectPath]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowPageDropdown(false);
        setPageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (showPageDropdown && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showPageDropdown]);

  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    setServerReady(false);

    // Poll until the dev server is ready
    const checkServer = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        await fetch(baseUrl, {
          mode: "no-cors",
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        setIsLoading(false);
        setHasError(false);
        setServerReady(true);
      } catch {
        if (retryCount < 60) {
          // Retry for up to 60 seconds
          setTimeout(() => setRetryCount((c) => c + 1), 1000);
        } else {
          setIsLoading(false);
          setHasError(true);
        }
      }
    };

    checkServer();
  }, [baseUrl, retryCount]);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = currentUrl + "?t=" + Date.now();
    }
  };

  const handlePageSelect = (route: string) => {
    setCurrentPage(route);
    setShowPageDropdown(false);
    setPageSearch("");
    // Update iframe
    if (iframeRef.current && serverReady) {
      const newUrl = `${baseUrl}${route === "/" ? "" : route}`;
      iframeRef.current.src = newUrl;
    }
  };

  const filteredPages = pages.filter(page =>
    page.route.toLowerCase().includes(pageSearch.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="preview-loading">
        <div className="spinner" />
        <p>Starting dev server...</p>
        <p className="hint">Waiting for localhost:{port}</p>
        <p className="hint" style={{ marginTop: 8, fontSize: 11 }}>
          {retryCount > 0 && `Attempt ${retryCount}/60`}
        </p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="preview-error">
        <p>Could not connect to dev server</p>
        <p className="hint">Ask Claude to run: npm run dev</p>
        <button onClick={() => setRetryCount(0)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="preview-container">
      <div className="preview-toolbar">
        {/* Page Switcher */}
        <div className="page-switcher" ref={dropdownRef}>
          <button
            className="page-switcher-btn"
            onClick={() => setShowPageDropdown(!showPageDropdown)}
          >
            <span className="page-route">{currentPage}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showPageDropdown && (
            <div className="page-dropdown">
              <input
                ref={searchInputRef}
                type="text"
                className="page-search"
                placeholder="Search pages..."
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredPages.length > 0) {
                    handlePageSelect(filteredPages[0].route);
                  }
                  if (e.key === "Escape") {
                    setShowPageDropdown(false);
                    setPageSearch("");
                  }
                }}
              />
              <div className="page-list">
                {filteredPages.length === 0 ? (
                  <div className="page-list-empty">No pages found</div>
                ) : (
                  filteredPages.map((page) => (
                    <button
                      key={page.route}
                      className={`page-item ${page.route === currentPage ? "active" : ""}`}
                      onClick={() => handlePageSelect(page.route)}
                    >
                      {page.route}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="preview-breakpoints">
          {(Object.keys(BREAKPOINTS) as Breakpoint[]).map((bp) => (
            <button
              key={bp}
              className={`breakpoint-btn ${breakpoint === bp ? "active" : ""}`}
              onClick={() => setBreakpoint(bp)}
              title={BREAKPOINTS[bp].label}
            >
              <BreakpointIcon type={bp} />
            </button>
          ))}
        </div>
        <button
          className="preview-refresh"
          onClick={handleRefresh}
          title="Refresh preview"
        >
          ↻
        </button>
      </div>
      <div className="preview-viewport">
        <iframe
          ref={iframeRef}
          src={serverReady ? currentUrl : "about:blank"}
          className="preview-iframe"
          style={{
            width: BREAKPOINTS[breakpoint].width,
            maxWidth: "100%"
          }}
          title="Preview"
        />
      </div>
    </div>
  );
}
