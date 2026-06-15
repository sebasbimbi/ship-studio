//! # Vercel domain lookup
//!
//! Reads the production custom domain for a Vercel-linked project so the UI can
//! show the real site address (e.g. `pop.bimbi.co`) instead of nothing. Ship
//! Studio publishes via Vercel's GitHub integration and never knew the deployed
//! domain; this asks Vercel for it.
//!
//! Auth: the app authenticates Vercel through the `vercel` CLI, so we reuse the
//! token that CLI already stored on disk rather than adding a separate token
//! flow. The token stays in the backend — it is never logged, never returned to
//! the frontend, and only ever sent to api.vercel.com.

use crate::errors::CommandError;
use crate::utils::validate_project_path;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const VERCEL_API: &str = "https://api.vercel.com";
const VERCEL_TIMEOUT_SECS: u64 = 15;

/// The production domains Vercel knows about for a linked project.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct VercelDomainInfo {
    /// The verified production custom domain (e.g. "pop.bimbi.co"), if one exists.
    pub custom_domain: Option<String>,
    /// The system `*.vercel.app` URL Vercel returned, used as a fallback display.
    pub system_url: Option<String>,
}

/// `.vercel/project.json` link written by `vercel link` / `vercel`.
#[derive(Deserialize)]
struct VercelProjectLink {
    #[serde(rename = "projectId")]
    project_id: String,
    #[serde(rename = "orgId")]
    org_id: Option<String>,
}

/// One entry from `GET /v9/projects/{id}/domains`.
#[derive(Deserialize, Debug)]
struct DomainEntry {
    name: String,
    #[serde(rename = "apexName")]
    apex_name: Option<String>,
    #[serde(default)]
    verified: bool,
    #[serde(default)]
    redirect: Option<String>,
}

#[derive(Deserialize)]
struct DomainsResponse {
    domains: Vec<DomainEntry>,
}

fn is_system_domain(d: &DomainEntry) -> bool {
    d.apex_name.as_deref() == Some("vercel.app") || d.name.ends_with(".vercel.app")
}

/// Pick the production custom domain (and the system `*.vercel.app` fallback) from
/// the domains Vercel returned. Pure filtering — never constructs a URL.
///
/// Preference: a verified, non-redirect custom domain; among several, the apex
/// (name == apexName), then a `www.` host, else the first one Vercel listed. The
/// system url is the first `*.vercel.app` entry.
fn select_production_domain(domains: &[DomainEntry]) -> VercelDomainInfo {
    let system_url = domains
        .iter()
        .find(|d| is_system_domain(d))
        .map(|d| d.name.clone());

    let pick = |verified_only: bool| -> Option<String> {
        let mut pool: Vec<&DomainEntry> = domains
            .iter()
            .filter(|d| {
                !is_system_domain(d) && d.redirect.is_none() && (!verified_only || d.verified)
            })
            .collect();
        // Stable sort by preference (apex < www < other) keeps Vercel's order on ties.
        pool.sort_by_key(|d| {
            if d.apex_name.as_deref() == Some(d.name.as_str()) {
                0
            } else if d.name.starts_with("www.") {
                1
            } else {
                2
            }
        });
        pool.first().map(|d| d.name.clone())
    };

    VercelDomainInfo {
        custom_domain: pick(true).or_else(|| pick(false)),
        system_url,
    }
}

async fn read_vercel_token() -> Option<String> {
    let path = dirs::data_dir()?.join("com.vercel.cli").join("auth.json");
    let raw = tokio::fs::read_to_string(&path).await.ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("token")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

/// Fetch the production custom domain for a Vercel-linked project.
///
/// Returns `Ok(None)` (never an error) when the project isn't linked to Vercel,
/// the CLI isn't authenticated, or Vercel has no domain to report — so callers
/// show the affordance only when a real value exists. Never constructs a URL.
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path))]
pub async fn get_vercel_production_domain(
    project_path: String,
) -> Result<Option<VercelDomainInfo>, CommandError> {
    let path = validate_project_path(&project_path)?;

    let link_path = path.join(".vercel").join("project.json");
    let Ok(link_raw) = tokio::fs::read_to_string(&link_path).await else {
        return Ok(None); // not linked to Vercel
    };
    let link: VercelProjectLink = serde_json::from_str(&link_raw)
        .map_err(|e| format!("Failed to parse .vercel/project.json: {e}"))?;

    let Some(token) = read_vercel_token().await else {
        return Ok(None); // Vercel CLI not authenticated
    };

    let mut url = format!(
        "{VERCEL_API}/v9/projects/{}/domains?production=true",
        link.project_id
    );
    if let Some(team) = link.org_id.as_deref() {
        if team.starts_with("team_") {
            url.push_str("&teamId=");
            url.push_str(team);
        }
    }

    let client = reqwest::Client::new();
    let request = client.get(&url).bearer_auth(&token).send();
    let resp = match tokio::time::timeout(Duration::from_secs(VERCEL_TIMEOUT_SECS), request).await {
        Ok(Ok(resp)) => resp,
        Ok(Err(e)) => return Err(format!("Vercel API request failed: {e}").into()),
        Err(_) => {
            return Err(CommandError::Timeout {
                cmd: "vercel domains".to_string(),
                secs: VERCEL_TIMEOUT_SECS,
            })
        }
    };

    // Token expired / project not found / no access — treat as "no domain", not an error.
    if !resp.status().is_success() {
        return Ok(None);
    }

    let data: DomainsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Vercel domains response: {e}"))?;

    let info = select_production_domain(&data.domains);
    if info.custom_domain.is_none() && info.system_url.is_none() {
        return Ok(None);
    }
    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, apex: &str, verified: bool, redirect: Option<&str>) -> DomainEntry {
        DomainEntry {
            name: name.to_string(),
            apex_name: Some(apex.to_string()),
            verified,
            redirect: redirect.map(|s| s.to_string()),
        }
    }

    #[test]
    fn picks_verified_custom_domain_over_system() {
        // Real shape from the `pop` project.
        let domains = vec![
            entry("pop.bimbi.co", "bimbi.co", true, None),
            entry("pop-sandy-five.vercel.app", "vercel.app", true, None),
        ];
        let info = select_production_domain(&domains);
        assert_eq!(info.custom_domain.as_deref(), Some("pop.bimbi.co"));
        assert_eq!(
            info.system_url.as_deref(),
            Some("pop-sandy-five.vercel.app")
        );
    }

    #[test]
    fn no_custom_domain_falls_back_to_system_only() {
        // Real shape from `creatormatch-v2` (only vercel.app entries).
        let domains = vec![entry(
            "creatormatch-v2.vercel.app",
            "vercel.app",
            true,
            None,
        )];
        let info = select_production_domain(&domains);
        assert_eq!(info.custom_domain, None);
        assert_eq!(
            info.system_url.as_deref(),
            Some("creatormatch-v2.vercel.app")
        );
    }

    #[test]
    fn ignores_redirect_domains() {
        let domains = vec![
            entry(
                "redirect.example.com",
                "example.com",
                true,
                Some("https://example.com"),
            ),
            entry("app.vercel.app", "vercel.app", true, None),
        ];
        let info = select_production_domain(&domains);
        assert_eq!(
            info.custom_domain, None,
            "a redirect host is not the canonical domain"
        );
        assert_eq!(info.system_url.as_deref(), Some("app.vercel.app"));
    }

    #[test]
    fn prefers_apex_then_www_among_multiple() {
        let domains = vec![
            entry(
                "statisticalresearch.org",
                "statisticalresearch.org",
                true,
                None,
            ),
            entry("www.src.org.mx", "src.org.mx", true, None),
            entry("src.mx", "src.mx", true, None),
        ];
        // src.mx and statisticalresearch.org are both apex; stable order keeps the first apex.
        let info = select_production_domain(&domains);
        assert_eq!(
            info.custom_domain.as_deref(),
            Some("statisticalresearch.org")
        );
    }

    #[test]
    fn uses_unverified_custom_domain_only_when_no_verified_exists() {
        let domains = vec![entry("pending.example.com", "example.com", false, None)];
        let info = select_production_domain(&domains);
        assert_eq!(info.custom_domain.as_deref(), Some("pending.example.com"));
    }

    #[test]
    fn empty_domains_yields_nothing() {
        let info = select_production_domain(&[]);
        assert_eq!(info, VercelDomainInfo::default());
    }
}
