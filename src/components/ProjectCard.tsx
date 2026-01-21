import { DashboardProject } from "../lib/project";
import { BranchIcon, ExternalLinkIcon, CodeIcon } from "./icons";

interface ProjectCardProps {
  project: DashboardProject;
  thumbnailData: string | null;
  onSelect: () => void;
  onDelete: () => void;
  onOpenSite?: () => void;
  onOpenIde?: () => void;
}

export function ProjectCard({
  project,
  thumbnailData,
  onSelect,
  onDelete,
  onOpenSite,
  onOpenIde,
}: ProjectCardProps) {
  const hasChanges = project.uncommitted_count && project.uncommitted_count > 0;

  return (
    <div className="project-card">
      <div
        className="project-card-thumbnail"
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {thumbnailData ? (
          <img src={thumbnailData} alt={project.name} />
        ) : (
          <div className="project-card-placeholder">
            <span>No preview</span>
          </div>
        )}
        {/* Hover actions overlay */}
        <div className="project-card-overlay">
          <div className="project-card-quick-actions">
            {project.production_url && onOpenSite && (
              <button
                className="quick-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSite();
                }}
                title="Open live site"
              >
                <ExternalLinkIcon size={16} />
              </button>
            )}
            {onOpenIde && (
              <button
                className="quick-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenIde();
                }}
                title="Open in IDE"
              >
                <CodeIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="project-card-info">
        <div className="project-card-details">
          <span className="project-card-name">{project.name}</span>
          <div className="project-card-meta">
            {project.git_branch && (
              <span className="project-card-branch">
                <BranchIcon />
                {project.git_branch}
              </span>
            )}
            {hasChanges && (
              <span className="project-card-changes">
                {project.uncommitted_count} uncommitted
              </span>
            )}
          </div>
          <div className="project-card-deployment">
            {project.deployment_state ? (
              <>
                <span
                  className={`status-dot status-${project.deployment_state.toLowerCase()}`}
                />
                {project.production_url ? (
                  <span className="project-card-url">
                    {formatUrl(project.production_url)}
                  </span>
                ) : (
                  <span className="project-card-deploy-time">
                    {project.last_deployed}
                  </span>
                )}
              </>
            ) : (
              <span className="project-card-not-deployed">Not deployed</span>
            )}
          </div>
        </div>
        <button
          className="project-card-menu"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete project"
        >
          &bull;&bull;&bull;
        </button>
      </div>
    </div>
  );
}

function formatUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
