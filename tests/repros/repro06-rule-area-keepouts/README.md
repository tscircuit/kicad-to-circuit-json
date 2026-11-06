# Dropped KiCad rule-area keepout

The minimal board contains one unfilled 8 x 4 mm rule area on both copper
layers. It excludes copper pours while allowing tracks, vias, pads and
footprints, matching the rule settings found in the audited SDI board.

Run:

```sh
bun test tests/repros/repro06-rule-area-keepouts/repro06-rule-area-keepouts.test.ts
```

The repro branch intentionally fails with zero imported keepouts. Its snapshot
compares an independently specified expected rectangle on the left with the
actual converter output on the right. The assertion follows the snapshot so the
missing keepout remains visible even while the regression test is red.

The stacked fix updates the imported panel and makes the geometry and permission
assertions pass. No copper fill is needed for a rule-area keepout to apply.
