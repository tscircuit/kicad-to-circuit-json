# Missing schematic resistance and capacitance

This self-contained schematic places two components with embedded library
symbols: R1 has `Value = 10k`, and C1 has `Value = 100n`. It needs no external
symbol libraries, PCB, or schematic wires to reproduce the problem.

Run from the repository root:

```sh
bun test tests/repros/schematic-passive-values/schematic-passive-values.test.ts
```

The ordinary test verifies that `kicadts` reads both values and that conversion
creates both components and all four schematic pins. Its snapshot records the
actual source components and validation issues from this repository's
`circuit-json` dependency:

| Instance   | Expected Circuit JSON property | Actual result                                            |
| ---------- | ------------------------------ | -------------------------------------------------------- |
| R1, `10k`  | `resistance: 10000` (ohms)     | `resistance` is absent; the resistor schema rejects it   |
| C1, `100n` | `capacitance: 1e-7` (farads)   | `capacitance` is absent; the capacitor schema rejects it |

The converter instead puts `10k` and `100n` in `manufacturer_part_number`.
`CollectLibrarySymbolsStage.processSymbol()` chooses the correct passive
`ftype`, but only inserts `name`, `ftype`, and `manufacturer_part_number`.
Neither required electrical property is added before returning the output.

Two `test.failing` cases state the desired schema-valid numeric values. They
are expected failures while the bug exists, so this repro can land without
breaking the test suite. An unexpected pass signals that the failure marker
needs removal. To see ordinary red regression tests, temporarily replace
`test.failing` with `test` in this file and rerun the same command.

When implementing the follow-up fix, remove both `.failing` markers and update
the snapshot after checking that the actual output contains the numeric values.
This change only adds the reproduction; it does not modify conversion behavior.
