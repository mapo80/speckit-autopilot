# speckit-autopilot: bootstrap-product

Parse `docs/product.md` and create the backlog, roadmap, and initial state
needed to run `/ship-product`.

## Usage

```bash
speckit-autopilot bootstrap --root .
```

Then show the output to the user. If the command fails, show the full error.

## What it does

- Reads `docs/product.md` (create it first with `/generate-product` if it does not exist)
- Parses features, priorities, and dependencies
- Writes `docs/product-backlog.yaml` — machine-readable backlog
- Writes `docs/roadmap.md` — ordered feature list
- Writes `docs/autopilot-state.json` — initial state

## Next step

After this command succeeds, run `/ship-product`.
