/**
 * Additional tests for bootstrap-product.ts branches not covered by the main test file:
 * - bullet-point delivery order (not numbered)
 * - medium and low priority assignment from delivery order position
 * - dependsOn logic when featureIdx > 0 && deliveryIdx > 0
 * - acceptance criteria fallback when feature has no criteria
 */
import { parseProductMd, buildBacklogFromProduct } from "../../src/cli/bootstrap-product.js";

// ---------------------------------------------------------------------------
// Priority assignment: medium (deliveryIdx 1-2) and low (deliveryIdx >= 3 or not found)
// ---------------------------------------------------------------------------

describe("buildBacklogFromProduct – priority assignment", () => {
  const md = [
    "# Product",
    "",
    "## In Scope",
    "### Feature Alpha",
    "- Alpha criterion",
    "",
    "### Feature Beta",
    "- Beta criterion",
    "",
    "### Feature Gamma",
    "- Gamma criterion",
    "",
    "### Feature Delta",
    "- Delta criterion",
    "",
    "## Delivery Preference",
    "1. Alpha",
    "2. Beta",
    "3. Gamma",
    "4. Delta",
  ].join("\n");

  it("assigns high priority to first feature in delivery order", () => {
    const parsed = parseProductMd(md);
    const backlog = buildBacklogFromProduct(parsed);
    const alpha = backlog.features.find((f) => f.title.includes("Alpha"));
    expect(alpha?.priority).toBe("high");
  });

  it("assigns medium priority to second feature in delivery order", () => {
    const parsed = parseProductMd(md);
    const backlog = buildBacklogFromProduct(parsed);
    const beta = backlog.features.find((f) => f.title.includes("Beta"));
    expect(beta?.priority).toBe("medium");
  });

  it("assigns low priority to fourth feature (deliveryIdx >= 3)", () => {
    const parsed = parseProductMd(md);
    const backlog = buildBacklogFromProduct(parsed);
    const delta = backlog.features.find((f) => f.title.includes("Delta"));
    expect(delta?.priority).toBe("low");
  });

  it("assigns dependsOn to non-first features with matching delivery order", () => {
    const parsed = parseProductMd(md);
    const backlog = buildBacklogFromProduct(parsed);
    // Features after the first in delivery order should have dependsOn
    const beta = backlog.features.find((f) => f.title.includes("Beta"));
    expect(beta?.dependsOn.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria fallback (line 156)
// ---------------------------------------------------------------------------

describe("buildBacklogFromProduct – acceptance criteria fallback", () => {
  it("uses fallback criterion when feature has no criteria", () => {
    const md = [
      "# Product",
      "",
      "## In Scope",
      "### Feature Without Criteria",
      // No bullet points under this feature
      "",
    ].join("\n");
    const parsed = parseProductMd(md);
    const backlog = buildBacklogFromProduct(parsed);
    const feature = backlog.features[0];
    expect(feature.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(feature.acceptanceCriteria[0]).toContain("works as described");
  });
});

// ---------------------------------------------------------------------------
// Numbered delivery order via "preference" section name (line 95)
// ---------------------------------------------------------------------------

describe("parseProductMd – preference section delivery order", () => {
  it("extracts bullet delivery items from a 'preference' section", () => {
    const md = [
      "# Product",
      "",
      "## Delivery Preference",
      "- Step one first",
      "- Step two second",
    ].join("\n");
    const parsed = parseProductMd(md);
    // The bullet items in Delivery Preference should be captured
    expect(parsed.deliveryOrder.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// parseProductMd – "order" section name variant
// ---------------------------------------------------------------------------

describe("parseProductMd – 'order' section name", () => {
  it("extracts delivery items from a section with 'order' in the name", () => {
    const md = [
      "# Product",
      "",
      "## Implementation Order",
      "- Feature One",
      "- Feature Two",
    ].join("\n");
    const parsed = parseProductMd(md);
    expect(parsed.deliveryOrder).toContain("Feature One");
    expect(parsed.deliveryOrder).toContain("Feature Two");
  });
});

// ---------------------------------------------------------------------------
// parseProductMd – In Scope section creates epic with features
// ---------------------------------------------------------------------------

describe("parseProductMd – in scope section epic grouping", () => {
  it("creates an epic from the section name when inside In Scope", () => {
    const md = [
      "# Product",
      "",
      "## In Scope",
      "### Feature A",
      "- Does A",
      "",
      "### Feature B",
      "- Does B",
    ].join("\n");
    const parsed = parseProductMd(md);
    // Features should appear in epics
    const allFeatures = parsed.epics.flatMap((e) => e.features);
    expect(allFeatures.length).toBe(2);
  });
});
