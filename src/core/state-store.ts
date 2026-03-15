import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AutopilotModeSchema = z.enum(["greenfield", "brownfield"]);
export type AutopilotMode = z.infer<typeof AutopilotModeSchema>;

export const AutopilotStatusSchema = z.enum([
  "bootstrapped",
  "running",
  "completed",
  "blocked",
  "error",
  "paused",
]);
export type AutopilotStatus = z.infer<typeof AutopilotStatusSchema>;

export const PhaseSchema = z.enum([
  "constitution",
  "spec",
  "clarify",
  "plan",
  "tasks",
  "analyze",
  "implement",
  "qa",
  "done",
]);
export type Phase = z.infer<typeof PhaseSchema>;

export const AcceptanceCriteriaConfigSchema = z.object({
  requireLintPass: z.boolean().default(true),
  requireTestsPass: z.boolean().default(true),
  minCoverage: z.number().nullable().default(null),
  items: z
    .array(
      z.object({
        description: z.string(),
        status: z.enum(["pending", "done"]).default("pending"),
      })
    )
    .default([]),
});
export type AcceptanceCriteriaConfig = z.infer<typeof AcceptanceCriteriaConfigSchema>;

export const AutopilotStateSchema = z.object({
  version: z.literal("1"),
  mode: AutopilotModeSchema.default("greenfield"),
  status: AutopilotStatusSchema.default("bootstrapped"),
  activeFeature: z.string().nullable().default(null),
  currentPhase: PhaseSchema.nullable().default(null),
  nextFeature: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  consecutiveFailures: z.number().int().min(0).default(0),
  maxFailures: z.number().int().min(1).default(3),
  testTimeoutMs: z.number().int().min(1000).default(120_000),
  lastCoverage: z.string().nullable().default(null),
  lastTestRun: z.string().nullable().default(null),
  lastLintPassed: z.boolean().nullable().default(null),
  lastTestsPassed: z.boolean().nullable().default(null),
  gatingEnabled: z.boolean().default(true),
  acceptanceCriteria: AcceptanceCriteriaConfigSchema.default({}),
  compactCount: z.number().int().min(0).default(0),
  lastCompactAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AutopilotState = z.infer<typeof AutopilotStateSchema>;

// ---------------------------------------------------------------------------
// StateStore class
// ---------------------------------------------------------------------------

export class StateStore {
  private readonly statePath: string;

  constructor(projectRoot: string) {
    this.statePath = join(projectRoot, "docs", "autopilot-state.json");
  }

  exists(): boolean {
    return existsSync(this.statePath);
  }

  read(): AutopilotState {
    if (!existsSync(this.statePath)) {
      throw new Error(`autopilot-state.json not found at ${this.statePath}`);
    }
    const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as unknown;
    return AutopilotStateSchema.parse(raw);
  }

  readOrNull(): AutopilotState | null {
    if (!existsSync(this.statePath)) return null;
    try {
      return this.read();
    } catch {
      return null;
    }
  }

  write(state: AutopilotState): void {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const updated: AutopilotState = { ...state, updatedAt: new Date().toISOString() };
    writeFileSync(this.statePath, JSON.stringify(updated, null, 2), "utf8");
  }

  update(patch: Partial<Omit<AutopilotState, "version" | "createdAt">>): AutopilotState {
    const current = this.read();
    const next: AutopilotState = { ...current, ...patch, updatedAt: new Date().toISOString() };
    AutopilotStateSchema.parse(next); // validate before writing
    this.write(next);
    return next;
  }

  createInitial(mode: AutopilotMode = "greenfield"): AutopilotState {
    const now = new Date().toISOString();
    const state: AutopilotState = AutopilotStateSchema.parse({
      version: "1",
      mode,
      status: "bootstrapped",
      activeFeature: null,
      currentPhase: null,
      nextFeature: null,
      lastError: null,
      consecutiveFailures: 0,
      maxFailures: 3,
      lastCoverage: null,
      lastTestRun: null,
      lastLintPassed: null,
      lastTestsPassed: null,
      gatingEnabled: true,
      acceptanceCriteria: {
        requireLintPass: true,
        requireTestsPass: true,
        minCoverage: null,
        items: [],
      },
      compactCount: 0,
      lastCompactAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.write(state);
    return state;
  }
}

export function createStateStore(projectRoot: string): StateStore {
  return new StateStore(projectRoot);
}
