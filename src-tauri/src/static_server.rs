//! # Static File Server
//!
//! A lightweight HTTP server that serves static files from a project directory.
//! Used for previewing plain HTML/CSS/JS projects that don't have a framework
//! dev server (no `npm run dev`).
//!
//! Runs behind the existing preview proxy, which handles navigation tracking
//! script injection and error overlays.

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use lazy_static::lazy_static;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// Body type for static server responses.
type ServerBody = BoxBody<Bytes, hyper::Error>;

/// Convert full bytes into a ServerBody.
fn full_body(data: Bytes) -> ServerBody {
    Full::new(data).map_err(|never| match never {}).boxed()
}

/// MIME type mappings for common static file extensions.
const MIME_TYPES: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("htm", "text/html; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("js", "application/javascript; charset=utf-8"),
    ("mjs", "application/javascript; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("svg", "image/svg+xml"),
    ("ico", "image/x-icon"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
    ("otf", "font/otf"),
    ("eot", "application/vnd.ms-fontobject"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("ogg", "audio/ogg"),
    ("mp3", "audio/mpeg"),
    ("wav", "audio/wav"),
    ("pdf", "application/pdf"),
    ("txt", "text/plain; charset=utf-8"),
    ("xml", "application/xml"),
    ("wasm", "application/wasm"),
    ("map", "application/json"),
];

/// Get the MIME type for a file extension.
fn get_mime_type(extension: &str) -> &'static str {
    let ext_lower = extension.to_lowercase();
    for (ext, mime) in MIME_TYPES {
        if *ext == ext_lower {
            return mime;
        }
    }
    "application/octet-stream"
}

/// A running static server instance.
struct StaticServerInstance {
    port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    _task_handle: JoinHandle<()>,
}

lazy_static! {
    /// Maps window_label -> StaticServerInstance
    static ref STATIC_SERVER_INSTANCES: Mutex<HashMap<String, StaticServerInstance>> =
        Mutex::new(HashMap::new());
}

/// Start a static file server for the given window, serving files from `project_path`.
/// Returns the server's listening port.
pub async fn start_static_server(
    window_label: String,
    project_path: String,
) -> Result<u16, String> {
    // Stop any existing server for this window
    stop_static_server(&window_label);

    let project_root = PathBuf::from(&project_path);
    if !project_root.exists() || !project_root.is_dir() {
        return Err(format!(
            "Project path does not exist or is not a directory: {}",
            project_path
        ));
    }

    // Canonicalize once at startup for path traversal checks
    let canonical_root = dunce::canonicalize(&project_root)
        .map_err(|e| format!("Failed to canonicalize project path: {}", e))?;

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind static server port: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get static server address: {}", e))?
        .port();

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

    let task_handle = tokio::spawn(async move {
        tracing::info!(
            "[StaticServer] Started on port {} serving {}",
            port,
            canonical_root.display()
        );

        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            let root = canonical_root.clone();
                            tokio::spawn(handle_connection(stream, addr, root));
                        }
                        Err(e) => {
                            tracing::error!("[StaticServer] Accept error: {}", e);
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    tracing::info!("[StaticServer] Shutting down on port {}", port);
                    break;
                }
            }
        }
    });

    let instance = StaticServerInstance {
        port,
        shutdown_tx: Some(shutdown_tx),
        _task_handle: task_handle,
    };

    STATIC_SERVER_INSTANCES
        .lock()
        .map_err(|e| format!("Failed to acquire static server lock: {}", e))?
        .insert(window_label.clone(), instance);

    tracing::info!(
        "[StaticServer] Registered for window '{}' on port {}",
        window_label,
        port
    );
    Ok(port)
}

/// Stop the static server for the given window.
pub fn stop_static_server(window_label: &str) {
    if let Ok(mut instances) = STATIC_SERVER_INSTANCES.lock() {
        if let Some(mut instance) = instances.remove(window_label) {
            if let Some(tx) = instance.shutdown_tx.take() {
                let _ = tx.send(());
            }
            tracing::info!(
                "[StaticServer] Stopped server for window '{}' (port {})",
                window_label,
                instance.port
            );
        }
    }
}

/// Stop all running static servers (called during app cleanup).
pub fn stop_all_static_servers() {
    if let Ok(mut instances) = STATIC_SERVER_INSTANCES.lock() {
        for (label, mut instance) in instances.drain() {
            if let Some(tx) = instance.shutdown_tx.take() {
                let _ = tx.send(());
            }
            tracing::info!(
                "[StaticServer] Stopped server for window '{}' (cleanup)",
                label
            );
        }
    }
}

/// Handle a single incoming TCP connection.
async fn handle_connection(stream: tokio::net::TcpStream, addr: SocketAddr, project_root: PathBuf) {
    let io = TokioIo::new(stream);

    let service = service_fn(move |req: Request<Incoming>| {
        let root = project_root.clone();
        async move { handle_request(req, &root).await }
    });

    if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
        tracing::debug!("[StaticServer] Connection error from {}: {}", addr, e);
    }
}

/// Handle a single HTTP request by serving the corresponding file.
async fn handle_request(
    req: Request<Incoming>,
    project_root: &Path,
) -> Result<Response<ServerBody>, hyper::Error> {
    // Strip query params and decode the path
    let uri_path = req.uri().path();

    // Decode percent-encoded characters
    let decoded_path = urlencoding::decode(uri_path).unwrap_or_else(|_| uri_path.into());

    // Resolve the file path with fallbacks
    match resolve_file_path(project_root, &decoded_path) {
        Some(file_path) => serve_file(&file_path).await,
        None => {
            // 404 - File not found
            let body = "<html><body><h1>404 - Not Found</h1></body></html>";
            Ok(Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("Content-Type", "text/html; charset=utf-8")
                .body(full_body(Bytes::from(body)))
                .unwrap())
        }
    }
}

/// Resolve a URL path to a file on disk, trying fallbacks:
/// 1. Exact path (e.g., /styles.css -> styles.css)
/// 2. Path + ".html" (e.g., /about -> about.html)
/// 3. Path + "/index.html" (e.g., /docs -> docs/index.html)
/// 4. /index.html (for root path)
///
/// Returns None if no matching file exists or if path traversal is detected.
fn resolve_file_path(project_root: &Path, url_path: &str) -> Option<PathBuf> {
    // Normalize: strip leading slash, handle root
    let relative = url_path.trim_start_matches('/');

    // Build candidate paths
    let candidates: Vec<PathBuf> = if relative.is_empty() {
        // Root path -> try index.html
        vec![project_root.join("index.html")]
    } else {
        vec![
            // 1. Exact path
            project_root.join(relative),
            // 2. Path + ".html"
            project_root.join(format!("{}.html", relative)),
            // 3. Path + "/index.html"
            project_root.join(relative).join("index.html"),
        ]
    };

    for candidate in candidates {
        if candidate.is_file() {
            // Security: prevent path traversal by verifying the resolved path
            // is within the project root
            if let Ok(canonical) = dunce::canonicalize(&candidate) {
                if canonical.starts_with(project_root) {
                    return Some(canonical);
                } else {
                    tracing::warn!(
                        "[StaticServer] Path traversal blocked: {} -> {}",
                        url_path,
                        canonical.display()
                    );
                }
            }
        }
    }

    None
}

/// Read a file from disk and return it as an HTTP response with the correct MIME type.
async fn serve_file(file_path: &Path) -> Result<Response<ServerBody>, hyper::Error> {
    match tokio::fs::read(file_path).await {
        Ok(contents) => {
            let mime = file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(get_mime_type)
                .unwrap_or("application/octet-stream");

            Ok(Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .header("Cache-Control", "no-cache, no-store, must-revalidate")
                .header("Access-Control-Allow-Origin", "*")
                .body(full_body(Bytes::from(contents)))
                .unwrap())
        }
        Err(e) => {
            tracing::error!(
                "[StaticServer] Failed to read file {}: {}",
                file_path.display(),
                e
            );
            let body = "<html><body><h1>500 - Internal Server Error</h1></body></html>";
            Ok(Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Content-Type", "text/html; charset=utf-8")
                .body(full_body(Bytes::from(body)))
                .unwrap())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_get_mime_type() {
        assert_eq!(get_mime_type("html"), "text/html; charset=utf-8");
        assert_eq!(get_mime_type("css"), "text/css; charset=utf-8");
        assert_eq!(get_mime_type("js"), "application/javascript; charset=utf-8");
        assert_eq!(get_mime_type("png"), "image/png");
        assert_eq!(get_mime_type("unknown"), "application/octet-stream");
        // Case insensitive
        assert_eq!(get_mime_type("HTML"), "text/html; charset=utf-8");
        assert_eq!(get_mime_type("CSS"), "text/css; charset=utf-8");
    }

    #[test]
    fn test_resolve_file_path_root() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("index.html"), "<html></html>").unwrap();

        let canonical_root = dunce::canonicalize(dir.path()).unwrap();
        let result = resolve_file_path(&canonical_root, "/");
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("index.html"));
    }

    #[test]
    fn test_resolve_file_path_exact() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("styles.css"), "body {}").unwrap();

        let canonical_root = dunce::canonicalize(dir.path()).unwrap();
        let result = resolve_file_path(&canonical_root, "/styles.css");
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("styles.css"));
    }

    #[test]
    fn test_resolve_file_path_html_fallback() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("about.html"), "<html></html>").unwrap();

        let canonical_root = dunce::canonicalize(dir.path()).unwrap();
        let result = resolve_file_path(&canonical_root, "/about");
        assert!(result.is_some());
        assert!(result.unwrap().ends_with("about.html"));
    }

    #[test]
    fn test_resolve_file_path_index_fallback() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("docs");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("index.html"), "<html></html>").unwrap();

        let canonical_root = dunce::canonicalize(dir.path()).unwrap();
        let result = resolve_file_path(&canonical_root, "/docs");
        assert!(result.is_some());
        let resolved = result.unwrap();
        assert!(resolved.ends_with("index.html"));
    }

    #[test]
    fn test_resolve_file_path_not_found() {
        let dir = TempDir::new().unwrap();

        let canonical_root = dunce::canonicalize(dir.path()).unwrap();
        let result = resolve_file_path(&canonical_root, "/nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_file_path_traversal_blocked() {
        let dir = TempDir::new().unwrap();
        // Create a file outside the project root
        let parent = dir.path().parent().unwrap();
        let outside_file = parent.join("outside.html");
        // Only test if we can create the file
        if fs::write(&outside_file, "outside").is_ok() {
            let canonical_root = dunce::canonicalize(dir.path()).unwrap();
            let result = resolve_file_path(&canonical_root, "/../outside.html");
            assert!(result.is_none());
            fs::remove_file(&outside_file).ok();
        }
    }
}
