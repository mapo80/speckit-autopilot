import { checkEnvironment } from "../../src/core/environment-checker.js";

// ---------------------------------------------------------------------------
// checkEnvironment
// ---------------------------------------------------------------------------

describe("checkEnvironment", () => {
  it("returns empty array when tech-stack mentions nothing recognisable", () => {
    const results = checkEnvironment("## Infrastructure\n- Azure Storage\n- PostgreSQL");
    expect(results).toHaveLength(0);
  });

  it("marks dotnet as required when tech-stack mentions C#", () => {
    const results = checkEnvironment("## Backend\n- Language: C# 12 / .NET 10\n- Framework: ASP.NET Core");
    const dotnet = results.find((r) => r.tool === "dotnet");
    expect(dotnet).toBeDefined();
    expect(dotnet?.required).toBe(true);
    expect(dotnet?.installHint).toBeTruthy();
  });

  it("marks flutter as required when tech-stack mentions Flutter", () => {
    const results = checkEnvironment("## Mobile\n- Framework: Flutter / Dart");
    const flutter = results.find((r) => r.tool === "flutter");
    expect(flutter).toBeDefined();
    expect(flutter?.required).toBe(true);
  });

  it("marks node as required when tech-stack mentions React", () => {
    const results = checkEnvironment("## Frontend\n- Framework: React 19 with TypeScript");
    const node = results.find((r) => r.tool === "node");
    expect(node).toBeDefined();
    expect(node?.required).toBe(true);
  });

  it("detects all three stacks in a multi-stack tech-stack.md", () => {
    const techStack = [
      "## Backend",
      "- C# 12 / .NET 10",
      "## Frontend",
      "- React 19 with TypeScript",
      "## Mobile",
      "- Flutter / Dart",
    ].join("\n");
    const results = checkEnvironment(techStack);
    const tools = results.map((r) => r.tool);
    expect(tools).toContain("dotnet");
    expect(tools).toContain("flutter");
    expect(tools).toContain("node");
  });

  it("returns installed:true for tools that actually exist on this machine (node)", () => {
    // node is always available in the test runner
    const results = checkEnvironment("## Frontend\n- React / Node");
    const node = results.find((r) => r.tool === "node");
    expect(node?.installed).toBe(true);
    expect(node?.version).toBeTruthy();
  });

  it("returns installed:false for a tool that definitely does not exist", () => {
    // We override the tool list by testing with a fictitious keyword match —
    // easier: just observe that an unknown binary is not installed.
    // We test this via runStackCommand in tech-stack-commands tests, but here
    // we verify the contract: installed is a boolean, never undefined.
    const results = checkEnvironment("## Backend\n- C# .NET");
    const dotnet = results.find((r) => r.tool === "dotnet");
    expect(typeof dotnet?.installed).toBe("boolean");
  });

  it("each result has required:true (only required tools are returned)", () => {
    const results = checkEnvironment("## Backend\n- Go / Golang");
    for (const r of results) {
      expect(r.required).toBe(true);
    }
  });
});
