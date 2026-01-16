import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Project {
  name: string;
  path: string;
}

interface ProjectListProps {
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
}

export function ProjectList({ onSelectProject, onCreateProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const projectList = await invoke<Project[]>("list_projects");
        setProjects(projectList);
      } catch (error) {
        console.error("Failed to load projects:", error);
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, []);

  if (loading) {
    return (
      <div className="project-list-loading">
        <div className="spinner" />
        <p>Loading projects...</p>
      </div>
    );
  }

  return (
    <div className="project-list">
      <div className="project-list-header">
        <h1>MarOS</h1>
        <p>Build Next.js sites with Claude Code</p>
      </div>

      <div className="project-list-actions">
        <button className="btn-primary" onClick={onCreateProject}>
          + New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="project-list-empty">
          <p>No projects yet</p>
          <p className="hint">Create your first project to get started</p>
        </div>
      ) : (
        <div className="project-list-items">
          <h2>Your Projects</h2>
          {projects.map((project) => (
            <button
              key={project.path}
              className="project-item"
              onClick={() => onSelectProject(project)}
            >
              <span className="project-name">{project.name}</span>
              <span className="project-path">{project.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
