# speckit-autopilot: generate-product

Read any specification document and convert it into `docs/product.md`
(the structured product description that `bootstrap-product` will parse into a backlog).

## Arguments

`$ARGUMENTS` — path to the source specification file (any format, any language).
If not provided, ask the user for the path before proceeding.

## Usage

```bash
speckit-autopilot generate --root . --spec $ARGUMENTS
```

Then show the output to the user. If the command fails, show the full error.

## What it does

- Reads the entire spec file (any language, any format)
- Calls Claude to extract epics, features, acceptance criteria, and delivery order
- Writes `docs/product.md` in the project root
- Reports how many features were extracted

## Next step

After this command succeeds, run `/bootstrap-product`.
