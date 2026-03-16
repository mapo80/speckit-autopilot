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
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/, "Feature ID must be a kebab-case slug"),
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

export function featureSlug(title: string, existingSlugs: string[]): string {
  let slug = title
    .replace(/^Feature\s+\d+\s*[-–]\s*/i, "")
    .replace(/^[^:]+:\s*/i, "")
    .replace(/[^\w\s-]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/_+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  // Trim incomplete last word if truncated
  if (slug.length === 40) {
    slug = slug.replace(/-[^-]*$/, "");
  }
  // Ensure minimum length
  if (slug.length < 3) slug = (slug + "feature").slice(0, 40);
  let candidate = slug;
  let i = 2;
  while (existingSlugs.includes(candidate)) {
    candidate = `${slug}-${i++}`;
  }
  return candidate;
}

export function priorityWeight(p: Priority): number {
  return p === "high" ? 3 : p === "medium" ? 2 : 1;
}

export function sortFeaturesByPriority(features: Feature[]): Feature[] {
  return [...features].sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
}
