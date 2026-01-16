import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface CreateProjectProps {
  onComplete: (projectPath: string) => void;
  onCancel: () => void;
}

const TEMPLATE_REPO = "https://github.com/julianmemberstack/maros-boilerplate-next-1";

export function CreateProject({ onComplete, onCancel }: CreateProjectProps) {
  const [projectName, setProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!isCreating || !termRef.current) return;

    const term = new XTerm({
      cursorBlink: false,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      disableStdin: true,
      theme: {
        background: "#1a1a2e",
        foreground: "#eaeaea",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();
    xtermRef.current = term;

    return () => {
      term.dispose();
    };
  }, [isCreating]);

  const writeLine = (text: string) => {
    xtermRef.current?.write(text + "\r\n");
  };

  const waitForPtyExit = async (targetId: number): Promise<number | null> => {
    return new Promise((resolve, reject) => {
      let unlisten: UnlistenFn | null = null;

      listen<{ id: number; code: number | null }>("pty-exit", (event) => {
        if (event.payload.id === targetId) {
          unlisten?.();
          if (event.payload.code === 0 || event.payload.code === null) {
            resolve(event.payload.code);
          } else {
            reject(new Error(`Process exited with code ${event.payload.code}`));
          }
        }
      }).then((fn) => {
        unlisten = fn;
      });
    });
  };

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError("Please enter a project name");
      return;
    }

    const safeName = projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!safeName) {
      setError("Invalid project name");
      return;
    }

    setIsCreating(true);
    setError(null);

    let unlistenOutput: UnlistenFn | null = null;

    try {
      // Ensure Marketingstack directory exists
      const marketingstackDir = await invoke<string>("ensure_marketingstack_dir");
      const projectPath = `${marketingstackDir}/${safeName}`;

      writeLine(`Creating project: ${safeName}`);
      writeLine(`Location: ${projectPath}`);
      writeLine("");

      // Clone template
      writeLine("Cloning template...");

      unlistenOutput = await listen<{ id: number; data: string }>(
        "pty-output",
        (event) => {
          xtermRef.current?.write(event.payload.data);
        }
      );

      const cloneId = await invoke<number>("spawn_pty", {
        cwd: marketingstackDir,
        command: "git",
        args: ["clone", TEMPLATE_REPO, safeName],
        rows: 10,
        cols: 80,
      });

      await waitForPtyExit(cloneId);

      // Remove .git folder so project starts fresh (not connected to template repo)
      writeLine("");
      writeLine("Initializing project...");
      const rmGitId = await invoke<number>("spawn_pty", {
        cwd: projectPath,
        command: "rm",
        args: ["-rf", ".git"],
        rows: 10,
        cols: 80,
      });

      await waitForPtyExit(rmGitId);

      writeLine("");
      writeLine("Installing dependencies...");

      // Install dependencies
      const installId = await invoke<number>("spawn_pty", {
        cwd: projectPath,
        command: "npm",
        args: ["install"],
        rows: 10,
        cols: 80,
      });

      await waitForPtyExit(installId);

      writeLine("");
      writeLine("\x1b[32mProject created successfully!\x1b[0m");

      // Small delay before opening
      await new Promise((r) => setTimeout(r, 1000));
      onComplete(projectPath);
    } catch (err) {
      writeLine("");
      writeLine(`\x1b[31mError: ${err}\x1b[0m`);
      setError(String(err));
    } finally {
      if (unlistenOutput) {
        unlistenOutput();
      }
    }
  };

  if (isCreating) {
    return (
      <div className="create-project creating">
        <h2>Creating Project...</h2>
        <div ref={termRef} className="create-terminal" />
        {error && (
          <div className="create-error">
            <p>{error}</p>
            <button onClick={onCancel}>Back</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="create-project">
      <h2>New Project</h2>
      <p>Create a new Next.js site with Claude Code</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <label>
          Project Name
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="my-awesome-site"
            autoFocus
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="create-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Create Project
          </button>
        </div>
      </form>
    </div>
  );
}
