# SRJ18 C43 / TP5 conversion close-up

This reduced fixture comes from `tests/assets/usb-c-power-adapter.kicad_pcb`
(SRJ18 sample016). It keeps C43 pin 1 and TP5 and translates the pair by
(-90.676, -95.55) mm in KiCad coordinates. C43 retains its -90° footprint
angle, pad-local position (-3.4, 0), absolute pad angle 270°, size 2.5 × 5.3 mm,
and absent `rect_delta`. TP5 retains its 0.75 mm circle and relative position
(-0.05, -5.675). The net labels are shortened to VCIN and +5V. Other copper,
footprint graphics, and C43 pin 2 are omitted to isolate this contact. The
8 × 7 mm Edge.Cuts rectangle only defines the comparison viewport.

The left panel is rendered by **KiCad 10's `pcb export svg`**, and the right
panel by **`circuit-to-svg` from the converter output**. Both use 80 pixels/mm.
The native SVG's viewport is normalized to the fixture's exact outline;
its copper paths are not changed. The reference circle should be separated
from the wide horizontal pad. In the broken conversion the tall pad swallows
that circle because the two copper shapes overlap.

The test records the observed pad dimensions and signed vertical copper gap
in a text snapshot as well as the comparison PNG. On the baseline branch,
these intentionally describe the existing incorrect conversion. The follow-up
fix updates both snapshots: 2.5 × 5.3 becomes 5.3 × 2.5 mm and the signed gap
changes from -0.75 to +0.65 mm. The KiCad panel remains unchanged.

Run:

```sh
bun test tests/repros/srj18-c43-pad-rotation/c43-tp5.test.ts
```

After intentionally changing the conversion, regenerate and inspect the PNG:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test -u tests/repros/srj18-c43-pad-rotation/c43-tp5.test.ts
```
