# generate-product

Convert any specification document into a structured `docs/product.md` file
that speckit-autopilot can parse to build a feature backlog.

## Arguments

`$ARGUMENTS` — path to the source specification file (any format, any language).

If no argument is provided, ask the user for the path before proceeding.

## Steps

### Step 1 — Read the specification

Read the ENTIRE file at the path provided in `$ARGUMENTS` using the Read tool.
Do NOT skim. Do NOT stop after the first sections.
If the file is longer than 2000 lines, read it in multiple chunks until you have
ingested every section.

### Step 2 — Deep analysis

Before writing anything, perform a full analysis of the document:

1. Identify the **product title** and its core purpose.
2. Identify all **epics / macro-components** (e.g. Backend API, Admin Portal,
   End-user Web App, Mobile App, Design System, Infrastructure, Integrations).
3. For each epic, identify every **distinct feature** described in the spec.
   A feature is a cohesive unit of functionality that can be implemented
   independently (e.g. "Authentication & RBAC", "Room Template Management",
   "Signature Workflow Engine").
4. For each feature, extract **concrete, testable acceptance criteria** from the
   spec text. Do not write generic criteria like "it works as expected".
   Write specific criteria derived directly from the spec (e.g.
   "POST /api/auth/login returns a JWT token valid for 24 hours").
5. Identify **dependencies** between features (which must be built first).
6. Determine the **delivery order**: infrastructure and shared layers first,
   then domain logic, then UI layers.

### Step 3 — Write `docs/product.md`

Create or overwrite `docs/product.md` in the current working directory.

The file MUST follow this EXACT format — no deviations:

```
# <Product Title>

## Vision
<2-4 sentences describing the product, its goals, and intended users>

## In Scope

### Feature 1 - <Epic>: <Feature Title>
- <acceptance criterion — specific and testable>
- <acceptance criterion — specific and testable>
- <acceptance criterion — specific and testable>
(5 to 15 criteria per feature)

### Feature 2 - <Epic>: <Feature Title>
- ...

(repeat for ALL features extracted)

## Out of Scope
- <item explicitly excluded in the spec or clearly outside scope>
- ...

## Delivery Preference
1. <title that matches EXACTLY the ### Feature N heading above>
2. <title that matches EXACTLY the ### Feature N heading above>
...
(list ALL features in implementation dependency order)
```

## Rules — read carefully before writing

- **Completeness**: Extract ALL significant features. Missing a feature means it
  will never be implemented. When in doubt, include it.
- **No invented content**: Every feature and every criterion must come from the
  specification. Never add features that are not described.
- **Detail**: Each acceptance criterion must be specific enough for a developer
  to know exactly what to implement and test. Reference API endpoints, UI
  components, data fields, state transitions, or business rules from the spec.
- **Grouping**: Prefix feature titles with the epic name:
  `Feature N - Backend: Authentication` or `Feature N - Mobile: Signature Flow`.
- **Delivery order**: Infrastructure first (auth, DB schema, base API),
  then domain logic (workflows, integrations), then UI layers (web, mobile).
  Features with no dependencies come before features that depend on them.
- **Exact title matching**: The titles in `## Delivery Preference` must be
  copied character-for-character from the `### Feature N -` headings.
- **English only**: All output must be in English regardless of the source
  language of the specification.
- **No preamble**: Output ONLY the markdown content. No introductory text,
  no "Here is the product.md:", no closing remarks.
- **Overwrite**: If `docs/product.md` already exists, overwrite it completely.

## Completion

After writing `docs/product.md`, print a summary:
```
✓ docs/product.md written
  Features extracted: <N>
  Epics: <list>

Next step:
  node run.mjs all --root <current directory>
```
