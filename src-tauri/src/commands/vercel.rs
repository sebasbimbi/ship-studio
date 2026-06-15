//! # Vercel domain lookup
//!
//! Reads the production custom domain for a project so the UI can show the real
//! site address (e.g. `pop.bimbi.co`) instead of nothing. Ship Studio publishes
//! through Vercel's GitHub integration and never knew the deployed domain.
//!
//! Projects deployed that way usually have **no** local `.vercel/project.json`
//! (nobody ran `vercel link`), and they often live under a Vercel **team**
//! rather than the personal scope — so we can't rely on a project id on disk.
//! Instead we match the Vercel project by its linked **GitHub repo**
//! (`owner/name`), searching the personal scope and every team, and read its
//! `targets.production.alias` list.
//!
//! Auth: the app authenticates Vercel through the `vercel` CLI, so we reuse the
//! token that CLI already stored on disk. The token stays in the backend — it is
//! never logged, never returned to the frontend, and only sent to api.vercel.com.

use crate::errors::CommandError;
use crate::utils::validate_project_path;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const VERCEL_API: &str = "https://api.vercel.com";
const VERCEL_TIMEOUT_SECS: u64 = 15;

/// The production domains Vercel knows about for a project.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct VercelDomainInfo {
    /// The production custom domain (e.g. "pop.bimbi.co"), if one exists.
    pub custom_domain: Option<String>,
    /// The system `*.vercel.app` URL Vercel returned, used as a fallback display.
    pub system_url: Option<String>,
}

#[derive(Deserialize)]
struct ProjectLink {
    org: Option<String>,
    repo: Option<String>,
}

#[derive(Deserialize)]
struct ProductionTarget {
    #[serde(default)]
    alias: Vec<String>,
}

#[derive(Deserialize)]
struct ProjectTargets {
    production: Option<ProductionTarget>,
}

#[derive(Deserialize)]
struct VercelProject {
    link: Option<ProjectLink>,
    targets: Option<ProjectTargets>,
}

#[derive(Deserialize)]
struct ProjectsResponse {
    projects: Vec<VercelProject>,
}

#[derive(Deserialize)]
struct Team {
    id: String,
}

#[derive(Deserialize)]
struct TeamsResponse {
    teams: Vec<Team>,
}

fn is_system_domain(host: &str) -> bool {
    host.ends_with(".vercel.app")
}

/// Pick the production custom domain (and the system `*.vercel.app` fallback)
/// from a project's alias list. Pure filtering — never constructs a host.
///
/// Among several custom domains, prefer a non-`www.` host, then the shortest,
/// then alphabetical — a deterministic "canonical" pick (e.g. `src.mx` over
/// `www.src.org.mx`). The system url is the first `*.vercel.app` alias.
fn select_from_aliases(aliases: &[String]) -> VercelDomainInfo {
    let system_url = aliases
        .iter()
        .find(|a| is_system_domain(a))
        .map(|a| a.to_string());

    let mut customs: Vec<&String> = aliases.iter().filter(|a| !is_system_domain(a)).collect();
    customs.sort_by(|a, b| {
        a.starts_with("www.")
            .cmp(&b.starts_with("www."))
            .then_with(|| a.len().cmp(&b.len()))
            .then_with(|| a.as_str().cmp(b.as_str()))
    });

    VercelDomainInfo {
        custom_domain: customs.first().map(|s| s.to_string()),
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

/// GET a Vercel API path and parse JSON. Returns `None` on timeout, transport
/// error, non-2xx, or parse failure — the domain lookup is best-effort.
async fn get_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Option<T> {
    let req = client.get(url).bearer_auth(token).send();
    let resp = tokio::time::timeout(Duration::from_secs(VERCEL_TIMEOUT_SECS), req)
        .await
        .ok()?
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<T>().await.ok()
}

/// Find the project linked to `owner/repo` in one scope (personal when `team_id`
/// is `None`) and return its production aliases.
async fn aliases_in_scope(
    client: &reqwest::Client,
    token: &str,
    team_id: Option<&str>,
    owner: &str,
    repo: &str,
) -> Option<Vec<String>> {
    let mut url = format!("{VERCEL_API}/v9/projects?limit=100");
    if let Some(team) = team_id {
        url.push_str("&teamId=");
        url.push_str(team);
    }
    let list: ProjectsResponse = get_json(client, &url, token).await?;
    list.projects.into_iter().find_map(|p| {
        let link = p.link?;
        if link.org.as_deref() == Some(owner) && link.repo.as_deref() == Some(repo) {
            Some(
                p.targets
                    .and_then(|t| t.production)
                    .map(|pr| pr.alias)
                    .unwrap_or_default(),
            )
        } else {
            None
        }
    })
}

/// Fetch the production custom domain for a project, matched by its GitHub repo.
///
/// `github_repo` is the `owner/name` Ship Studio already resolved from the git
/// remote. Returns `Ok(None)` (never an error) when there's no repo, the Vercel
/// CLI isn't authenticated, no Vercel project is linked to that repo, or there's
/// no domain to report — so callers show the affordance only when a real value
/// exists. Never constructs a host.
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path, repo = ?github_repo))]
pub async fn get_vercel_production_domain(
    project_path: String,
    github_repo: Option<String>,
) -> Result<Option<VercelDomainInfo>, CommandError> {
    let _ = validate_project_path(&project_path)?;

    let Some(repo) = github_repo.filter(|r| !r.trim().is_empty()) else {
        return Ok(None);
    };
    let Some((owner, name)) = repo.split_once('/') else {
        return Ok(None);
    };
    let name = name.trim_end_matches(".git");

    let Some(token) = read_vercel_token().await else {
        return Ok(None); // Vercel CLI not authenticated
    };

    let client = reqwest::Client::new();

    // Personal scope first, then each team — stop at the first matching project.
    let mut aliases = aliases_in_scope(&client, &token, None, owner, name).await;
    if aliases.is_none() {
        let teams_url = format!("{VERCEL_API}/v2/teams?limit=100");
        if let Some(teams) = get_json::<TeamsResponse>(&client, &teams_url, &token).await {
            for team in teams.teams {
                if let Some(found) =
                    aliases_in_scope(&client, &token, Some(&team.id), owner, name).await
                {
                    aliases = Some(found);
                    break;
                }
            }
        }
    }

    let Some(aliases) = aliases else {
        return Ok(None); // no Vercel project linked to this repo in any scope
    };

    let info = select_from_aliases(&aliases);
    if info.custom_domain.is_none() && info.system_url.is_none() {
        return Ok(None);
    }
    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aliases(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_custom_domain_over_system() {
        // Real `pop` project aliases.
        let info = select_from_aliases(&aliases(&[
            "pop.bimbi.co",
            "pop-sandy-five.vercel.app",
            "pop-bimbi-digital.vercel.app",
            "pop-git-main-bimbi-digital.vercel.app",
        ]));
        assert_eq!(info.custom_domain.as_deref(), Some("pop.bimbi.co"));
        assert_eq!(
            info.system_url.as_deref(),
            Some("pop-sandy-five.vercel.app")
        );
    }

    #[test]
    fn picks_shortest_non_www_among_many() {
        // Real `src-mx` project aliases.
        let info = select_from_aliases(&aliases(&[
            "www.src.org.mx",
            "src-mx.vercel.app",
            "src-mx-bimbi-digital.vercel.app",
            "src.mx",
            "src.org.mx",
            "www.src.mx",
            "statisticalresearch.org",
            "www.statisticalresearch.org",
        ]));
        assert_eq!(info.custom_domain.as_deref(), Some("src.mx"));
        assert_eq!(info.system_url.as_deref(), Some("src-mx.vercel.app"));
    }

    #[test]
    fn no_custom_domain_falls_back_to_system() {
        let info = select_from_aliases(&aliases(&[
            "creatormatch-v2.vercel.app",
            "creatormatch-v2-bimbi-digital.vercel.app",
        ]));
        assert_eq!(info.custom_domain, None);
        assert_eq!(
            info.system_url.as_deref(),
            Some("creatormatch-v2.vercel.app")
        );
    }

    #[test]
    fn falls_back_to_www_when_no_apex() {
        let info = select_from_aliases(&aliases(&["www.example.com", "x.vercel.app"]));
        assert_eq!(info.custom_domain.as_deref(), Some("www.example.com"));
    }

    #[test]
    fn empty_yields_nothing() {
        assert_eq!(select_from_aliases(&[]), VercelDomainInfo::default());
    }
}
