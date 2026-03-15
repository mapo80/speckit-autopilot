# speckit-autopilot: generate-techstack

Infer the tech stack from `docs/product.md` and write `docs/tech-stack.md`.
If `docs/tech-stack.md` already exists it is backed up first (unique timestamp name),
then the new file is written.

## Usage

```bash
speckit-autopilot generate-techstack --root .
```

## What it does

- Reads `docs/product.md` (must already exist — run `/generate-product` first)
- Calls Claude to extract language, framework, database, and infrastructure details
- Backs up any existing `docs/tech-stack.md` to `docs/tech-stack.YYYYMMDD-HHmmss.bak.md`
- Writes the new `docs/tech-stack.md`

Review and edit the generated file before running `/ship-product` if the inferred stack is not accurate.

## When to use

- After `/generate-product` and before `/bootstrap-product` (if running steps manually)
- To regenerate after updating the product spec
- `bootstrap-product` runs this automatically when `docs/tech-stack.md` is absent

## Next step

After this command succeeds, run `/bootstrap-product`.
