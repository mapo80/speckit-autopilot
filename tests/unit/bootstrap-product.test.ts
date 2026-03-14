import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  parseProductMd,
  buildBacklogFromProduct,
  bootstrapProduct,
  detectSpecKit,
} from "../../src/cli/bootstrap-product.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "bootstrap-test-"));
}

const SAMPLE_PRODUCT_MD = `# TaskBoard Lite

## Vision
A simple task manager.

## In Scope
### Feature 1 - Task CRUD
- Create tasks
- Edit tasks
- Delete tasks

### Feature 2 - Workflow States
- Todo state
- Doing state
- Done state

## Out of Scope
- Login
- Multiuser

## Acceptance Criteria
- I can create tasks
- Tests pass

## Delivery Preference
1. Task CRUD
2. Workflow States
`;

// ---------------------------------------------------------------------------
// parseProductMd
// ---------------------------------------------------------------------------

describe("parseProductMd", () => {
  it("extracts the product title", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    expect(parsed.title).toBe("TaskBoard Lite");
  });

  it("extracts features from In Scope section", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    // Features should include the two defined features
    const allFeatures = parsed.epics.flatMap((e) => e.features);
    expect(allFeatures.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts out-of-scope items", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    expect(parsed.outOfScope).toContain("Login");
  });

  it("extracts acceptance criteria", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    expect(parsed.acceptanceCriteria.some((c) => c.includes("create"))).toBe(true);
  });

  it("extracts delivery order", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    expect(parsed.deliveryOrder.length).toBeGreaterThan(0);
  });

  it("handles a minimal product.md", () => {
    const minimal = "# My Product\n\n## In Scope\n### Feature A\n- Does something\n";
    const parsed = parseProductMd(minimal);
    expect(parsed.title).toBe("My Product");
  });

  it("defaults title to Product when no H1 found", () => {
    const parsed = parseProductMd("No heading here");
    expect(parsed.title).toBe("Product");
  });
});

// ---------------------------------------------------------------------------
// buildBacklogFromProduct
// ---------------------------------------------------------------------------

describe("buildBacklogFromProduct", () => {
  it("produces a valid backlog from parsed product", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    const backlog = buildBacklogFromProduct(parsed);
    expect(backlog.version).toBe("1");
    expect(backlog.features.length).toBeGreaterThan(0);
  });

  it("assigns sequential IDs starting from F-001", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    const backlog = buildBacklogFromProduct(parsed);
    const ids = backlog.features.map((f) => f.id);
    expect(ids[0]).toBe("F-001");
  });

  it("all features start with status open", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    const backlog = buildBacklogFromProduct(parsed);
    expect(backlog.features.every((f) => f.status === "open")).toBe(true);
  });

  it("does not include out-of-scope items as features", () => {
    const parsed = parseProductMd(SAMPLE_PRODUCT_MD);
    const backlog = buildBacklogFromProduct(parsed);
    const titles = backlog.features.map((f) => f.title.toLowerCase());
    expect(titles.some((t) => t.includes("login"))).toBe(false);
    expect(titles.some((t) => t.includes("multiuser"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bootstrapProduct
// ---------------------------------------------------------------------------

describe("bootstrapProduct", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns error when docs/product.md is missing", async () => {
    const result = await bootstrapProduct(tmp);
    expect(result.success).toBe(false);
    expect(result.message).toContain("product.md");
  });

  it("creates roadmap, backlog and state when product.md exists", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "product.md"), SAMPLE_PRODUCT_MD, "utf8");

    const result = await bootstrapProduct(tmp);
    expect(result.success).toBe(true);
    expect(existsSync(join(tmp, "docs", "roadmap.md"))).toBe(true);
    expect(existsSync(join(tmp, "docs", "product-backlog.yaml"))).toBe(true);
    expect(existsSync(join(tmp, "docs", "autopilot-state.json"))).toBe(true);
  });

  it("reports feature count correctly", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "product.md"), SAMPLE_PRODUCT_MD, "utf8");

    const result = await bootstrapProduct(tmp);
    expect(result.success).toBe(true);
    expect(result.featureCount).toBeGreaterThan(0);
  });

  it("reports product title from product.md", async () => {
    mkdirSync(join(tmp, "docs"), { recursive: true });
    writeFileSync(join(tmp, "docs", "product.md"), SAMPLE_PRODUCT_MD, "utf8");

    const result = await bootstrapProduct(tmp);
    expect(result.productTitle).toBe("TaskBoard Lite");
  });
});

// ---------------------------------------------------------------------------
// detectSpecKit
// ---------------------------------------------------------------------------

describe("detectSpecKit", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmp(); });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("returns object with available and initialized booleans", () => {
    const result = detectSpecKit(tmp);
    expect(typeof result.available).toBe("boolean");
    expect(typeof result.initialized).toBe("boolean");
  });

  it("returns initialized:false when .speckit/ does not exist", () => {
    const result = detectSpecKit(tmp);
    expect(result.initialized).toBe(false);
  });

  it("returns initialized:true when .speckit/ directory exists", () => {
    mkdirSync(join(tmp, ".speckit"), { recursive: true });
    const result = detectSpecKit(tmp);
    expect(result.initialized).toBe(true);
  });
});
