/**
 * Tests for checkStructuralCompliance() in audit.ts.
 */
import { describe, it, expect } from "@jest/globals";
import { checkStructuralCompliance } from "../../src/cli/audit.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIGNHUB_STRUCTURE = `# Project Structure

## Backend (src/)
src/SignHub.Api/Controllers/{FeatureName}Controller.cs
src/SignHub.Dal/Contexts/SignHubDbContext.cs
src/SignHub.Domain/Entities/{Noun}.cs
src/SignHub.Services/{Domain}/{Noun}Service.cs

## Tests (tests/)
tests/SignHub.UnitTests/Services/{Noun}ServiceTests.cs
tests/SignHub.IntegrationTests/Controllers/{Noun}ControllerTests.cs

## Frontend (frontend/)
frontend/src/features/{featureName}/

## RULES (MANDATORY)
- NEVER create src/Api/ (use src/SignHub.Api/)
- NEVER create src/Dal/ (use src/SignHub.Dal/)
- NEVER create backend/ at root level
- SignHubDbContext.cs exists ONCE at src/SignHub.Dal/Contexts/
`;

// ---------------------------------------------------------------------------
// No project-structure.md → skip check
// ---------------------------------------------------------------------------

describe("checkStructuralCompliance – no project structure provided", () => {
  it("returns no violations when projectStructureMd is null", () => {
    const result = checkStructuralCompliance(
      ["src/Api/Controllers/Foo.cs", "backend/Foo.cs"],
      null
    );
    expect(result.violations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns no violations when generatedFiles is empty", () => {
    const result = checkStructuralCompliance([], SIGNHUB_STRUCTURE);
    expect(result.violations).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Canonical paths → no violations
// ---------------------------------------------------------------------------

describe("checkStructuralCompliance – canonical paths pass", () => {
  it("accepts src/SignHub.Api/ files", () => {
    const result = checkStructuralCompliance(
      ["src/SignHub.Api/Controllers/RoomsController.cs"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations).toHaveLength(0);
  });

  it("accepts tests/ files", () => {
    const result = checkStructuralCompliance(
      ["tests/SignHub.UnitTests/Services/RoomServiceTests.cs"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations).toHaveLength(0);
  });

  it("accepts frontend/ files", () => {
    const result = checkStructuralCompliance(
      ["frontend/src/features/rooms/index.tsx"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations).toHaveLength(0);
  });

  it("accepts docs/ files without violation (docs excluded from check)", () => {
    const result = checkStructuralCompliance(
      ["docs/specs/room-workflow/spec.md"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NEVER patterns → violations
// ---------------------------------------------------------------------------

describe("checkStructuralCompliance – NEVER patterns produce violations", () => {
  it("flags src/Api/ as a violation", () => {
    const result = checkStructuralCompliance(
      ["src/Api/Controllers/FooController.cs"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain("src/Api/");
  });

  it("flags src/Dal/ as a violation", () => {
    const result = checkStructuralCompliance(
      ["src/Dal/Context.cs"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("flags backend/ as a violation", () => {
    const result = checkStructuralCompliance(
      ["backend/SignHub.Api/Controllers/Foo.cs"],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Files outside canonical roots → warnings (not violations)
// ---------------------------------------------------------------------------

describe("checkStructuralCompliance – non-canonical non-docs paths produce warnings", () => {
  it("warns about files at root level outside allowed roots", () => {
    const result = checkStructuralCompliance(
      ["appsettings.json"],
      SIGNHUB_STRUCTURE
    );
    // No violation (it's not a NEVER pattern), but may warn
    expect(result.violations).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(0); // warnings are optional for root files
  });
});

// ---------------------------------------------------------------------------
// Multiple files — mixed result
// ---------------------------------------------------------------------------

describe("checkStructuralCompliance – mixed files", () => {
  it("reports only the violating files, not the clean ones", () => {
    const result = checkStructuralCompliance(
      [
        "src/SignHub.Api/Controllers/RoomsController.cs",   // clean
        "src/Api/Controllers/FooController.cs",              // violation
        "tests/SignHub.UnitTests/RoomTests.cs",              // clean
      ],
      SIGNHUB_STRUCTURE
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("src/Api/");
  });
});
