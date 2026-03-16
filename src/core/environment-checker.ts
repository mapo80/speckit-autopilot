import { spawnSync } from "child_process";
import { parseStackSections } from "./tech-stack-commands.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvCheckResult {
  tool: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installHint: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDef {
  tool: string;
  /** Keywords in tech-stack.md that trigger this requirement */
  triggers: string[];
  installHint: string;
  /** Command + args to retrieve version string */
  versionArgs: string[];
}

const TOOL_DEFS: ToolDef[] = [
  {
    tool: "dotnet",
    triggers: ["C#", ".NET", "ASP.NET", "dotnet"],
    installHint: process.platform === "win32"
      ? "winget install Microsoft.DotNet.SDK.10"
      : "brew install dotnet  or  https://dotnet.microsoft.com/download",
    versionArgs: ["--version"],
  },
  {
    tool: "flutter",
    triggers: ["Flutter", "Dart"],
    installHint: "https://flutter.dev/docs/get-started/install",
    versionArgs: ["--version"],
  },
  {
    tool: "node",
    triggers: ["React", "Node", "TypeScript", "JavaScript", "Vue", "Angular", "Next.js", "Vite"],
    installHint: process.platform === "win32"
      ? "winget install OpenJS.NodeJS  or  https://nodejs.org"
      : "brew install node  or  https://nodejs.org",
    versionArgs: ["--version"],
  },
  {
    tool: "python3",
    triggers: ["Python", "FastAPI", "Django", "Flask"],
    installHint: process.platform === "win32"
      ? "winget install Python.Python.3  or  https://python.org"
      : "brew install python  or  https://python.org",
    versionArgs: ["--version"],
  },
  {
    tool: "go",
    triggers: ["Go ", "Golang", "go.mod"],
    installHint: process.platform === "win32"
      ? "winget install GoLang.Go  or  https://go.dev/dl/"
      : "brew install go  or  https://go.dev/dl/",
    versionArgs: ["version"],
  },
  {
    tool: "cargo",
    triggers: ["Rust", "Cargo"],
    installHint: "https://rustup.rs",
    versionArgs: ["--version"],
  },
  {
    tool: "mvn",
    triggers: ["Java", "Spring", "Maven"],
    installHint: process.platform === "win32"
      ? "winget install Apache.Maven  or  https://maven.apache.org"
      : "brew install maven  or  https://maven.apache.org",
    versionArgs: ["--version"],
  },
  {
    tool: "gradle",
    triggers: ["Gradle", "Kotlin"],
    installHint: process.platform === "win32"
      ? "winget install Gradle.Gradle  or  https://gradle.org"
      : "brew install gradle  or  https://gradle.org",
    versionArgs: ["--version"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRequired(allSectionText: string, triggers: string[]): boolean {
  const lower = allSectionText.toLowerCase();
  return triggers.some((t) => lower.includes(t.toLowerCase()));
}

function checkInstalled(tool: string, versionArgs: string[]): { installed: boolean; version?: string } {
  // First: which/where
  const which = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [tool],
    { encoding: "utf8", shell: false }
  );
  if (which.status !== 0) return { installed: false };

  // Then: version (best-effort, not required)
  const ver = spawnSync(tool, versionArgs, {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  const version = (ver.stdout ?? ver.stderr ?? "").trim().split("\n")[0] || undefined;
  return { installed: true, version };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Check which tools required by the project's tech stack are installed.
 *
 * Pass the content of `docs/tech-stack.md`.  Returns one entry per required
 * tool with `installed: true/false`.  Tools not mentioned in the tech-stack
 * are omitted entirely.
 *
 * Never throws — all errors are surfaced via `installed: false`.
 */
export function checkEnvironment(techStackContent: string): EnvCheckResult[] {
  const sections = parseStackSections(techStackContent);
  const allText = [techStackContent, ...Object.values(sections)].join("\n");

  const results: EnvCheckResult[] = [];

  for (const def of TOOL_DEFS) {
    const required = isRequired(allText, def.triggers);
    if (!required) continue;

    let installed = false;
    let version: string | undefined;
    try {
      const r = checkInstalled(def.tool, def.versionArgs);
      installed = r.installed;
      version = r.version;
    } catch {
      installed = false;
    }

    results.push({
      tool: def.tool,
      required: true,
      installed,
      version,
      installHint: def.installHint,
    });
  }

  return results;
}
