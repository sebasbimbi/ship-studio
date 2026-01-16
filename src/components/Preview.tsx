import { useState, useEffect, useRef } from "react";

interface PreviewProps {
  port?: number;
}

export function Preview({ port = 3000 }: PreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [serverReady, setServerReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const url = `http://localhost:${port}`;

  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
    setServerReady(false);

    // Poll until the dev server is ready
    const checkServer = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        await fetch(url, {
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
  }, [url, retryCount]);

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = url + "?t=" + Date.now();
    }
  };

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
        <span className="preview-url">{url}</span>
        <button
          className="preview-refresh"
          onClick={handleRefresh}
          title="Refresh preview"
        >
          ↻
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={serverReady ? url : "about:blank"}
        className="preview-iframe"
        title="Preview"
      />
    </div>
  );
}
