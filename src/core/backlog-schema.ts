import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const FeatureStatusSchema = z.enum(["open", "in_progress", "done", "blocked"]);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

export const PrioritySchema = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const ComplexitySchema = z.enum(["low", "medium", "high"]);
export type Complexity = z.infer<typeof ComplexitySchema>;

// ---------------------------------------------------------------------------
// Feature schema
// ---------------------------------------------------------------------------

export const AcceptanceCriterionSchema = z.string().min(1);

export const FeatureSchema = z.object({
  id: z.string().regex(/^F-\d{3,}$/, "Feature ID must match F-NNN"),
  title: z.string().min(1),
  epic: z.string().min(1),
  status: FeatureStatusSchema.default("open"),
  priority: PrioritySchema.default("medium"),
  dependsOn: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).default([]),
  estimatedComplexity: ComplexitySchema.default("medium"),
  specKitBranch: z.string().default(""),
  notes: z.string().default(""),
});

export type Feature = z.infer<typeof FeatureSchema>;

// ---------------------------------------------------------------------------
// Backlog schema
// ---------------------------------------------------------------------------

export const BacklogSchema = z.object({
  version: z.literal("1"),
  generatedAt: z.string(),
  features: z.array(FeatureSchema).default([]),
});

export type Backlog = z.infer<typeof BacklogSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseBacklog(raw: unknown): Backlog {
  return BacklogSchema.parse(raw);
}

export function validateBacklog(raw: unknown): { success: true; data: Backlog } | { success: false; error: string } {
  const result = BacklogSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

export function makeEmptyBacklog(): Backlog {
  return {
    version: "1",
    generatedAt: new Date().toISOString(),
    features: [],
  };
}

export function featureNextId(backlog: Backlog): string {
  if (backlog.features.length === 0) return "F-001";
  const nums = backlog.features.map((f) => {
    const m = f.id.match(/^F-(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const next = Math.max(...nums) + 1;
  return `F-${String(next).padStart(3, "0")}`;
}

export function priorityWeight(p: Priority): number {
  return p === "high" ? 3 : p === "medium" ? 2 : 1;
}

export function sortFeaturesByPriority(features: Feature[]): Feature[] {
  return [...features].sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}
