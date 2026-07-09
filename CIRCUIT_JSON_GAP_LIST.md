# Circuit JSON Gap List

This file compares the local `kicad-to-circuit-json` implementation against the
local sibling `circuit-json` schema repo.

Scope of this audit:

- "Supported" means this repo currently emits that Circuit JSON element type.
- "Missing" means the type exists in `circuit-json` but is not emitted here.
- "Partial" means something close exists, but the mapping is incomplete or lossy.

## Currently Emitted Element Types

The converter currently emits these top-level Circuit JSON element types:

- `source_component`
- `source_port`
- `source_trace`
- `schematic_component`
- `schematic_port`
- `schematic_trace`
- `pcb_board`
- `pcb_component`
- `pcb_copper_pour`
- `pcb_copper_text`
- `pcb_courtyard_circle`
- `pcb_courtyard_outline`
- `pcb_courtyard_rect`
- `pcb_fabrication_note_path`
- `pcb_fabrication_note_rect`
- `pcb_fabrication_note_text`
- `pcb_hole`
- `pcb_plated_hole`
- `pcb_port`
- `pcb_silkscreen_path`
- `pcb_silkscreen_text`
- `pcb_smtpad`
- `pcb_trace`
- `pcb_via`

## Missing Source-Domain Elements

These source-level Circuit JSON elements are not emitted today:

- `source_board`
- `source_group`
- `source_net`
- `source_interconnect`
- `source_project_metadata`
- `source_pcb_ground_plane`
- `source_manually_placed_via`
- `source_component_internal_connection`

These source diagnostics and validation elements are also missing:

- `source_ambiguous_port_reference`
- `source_component_pins_underspecified_warning`
- `source_failed_to_create_component_error`
- `source_i2c_misconfigured_error`
- `source_invalid_component_property_error`
- `source_missing_manufacturer_part_number_warning`
- `source_missing_property_error`
- `source_no_ground_pin_defined_warning`
- `source_no_power_pin_defined_warning`
- `source_pin_missing_trace_warning`
- `source_pin_must_be_connected_error`
- `source_property_ignored_warning`
- `source_trace_not_connected_error`
- `unknown_error_finding_part`

## Missing Source Component Ftypes

`source_component` is emitted, but only a narrow subset of `ftype` 
 is
recognized today.

Currently recognized:

- `simple_resistor`
- `simple_capacitor`
- `simple_inductor`
- `simple_diode`
- `simple_led`
- `simple_transistor`
- `simple_chip`

Missing `circuit-json` source component variants:

- `simple_battery`
- `simple_connector`
- `simple_crystal`
- `simple_current_source`
- `simple_fiducial`
- `simple_fuse`
- `simple_ground`
- `simple_mosfet`
- `simple_op_amp`
- `simple_pin_header`
- `simple_pinout`
- `simple_potentiometer`
- `simple_power_source`
- `simple_push_button`
- `simple_resonator`
- `simple_switch`
- `simple_test_point`
- `simple_voltage_probe`
- `simple_voltage_source`

## Missing Schematic Elements

These schematic-level Circuit JSON elements are not emitted today:

- `schematic_net_label`
- `schematic_text`
- `schematic_line`
- `schematic_rect`
- `schematic_circle`
- `schematic_arc`
- `schematic_path`
- `schematic_box`
- `schematic_sheet`
- `schematic_symbol`
- `schematic_group`
- `schematic_table`
- `schematic_table_cell`
- `schematic_voltage_probe`

These schematic diagnostics/debug elements are also missing:

- `schematic_debug_object`
- `schematic_error`
- `schematic_layout_error`
- `schematic_manual_edit_conflict_warning`

## Missing PCB Elements

These PCB-level Circuit JSON elements are not emitted today:

- `pcb_net`
- `pcb_cutout`
- `pcb_keepout`
- `pcb_ground_plane`
- `pcb_ground_plane_region`
- `pcb_solder_paste`
- `pcb_thermal_spoke`
- `pcb_trace_hint`
- `pcb_breakout_point`
- `pcb_group`
- `pcb_panel`

These PCB note / annotation primitives are missing:

- `pcb_note_text`
- `pcb_note_rect`
- `pcb_note_path`
- `pcb_note_line`
- `pcb_note_dimension`
- `pcb_fabrication_note_dimension`
- `pcb_text`


These PCB diagnostics / validation elements are also missing:

- `circuit_json_footprint_load_error`
- `external_footprint_load_error`
- `pcb_autorouting_error`
- `pcb_component_invalid_layer_error`
- `pcb_component_not_on_board_edge_error`
- `pcb_component_outside_board_error`
- `pcb_connector_not_in_accessible_orientation_warning`
- `pcb_courtyard_overlap_error`
- `pcb_footprint_overlap_error`
- `pcb_manual_edit_conflict_warning`
- `pcb_missing_footprint_error`
- `pcb_panelization_placement_error`
- `pcb_placement_error`
- `pcb_port_not_connected_error`
- `pcb_port_not_matched_error`
- `pcb_trace_error`
- `pcb_trace_missing_error`
- `pcb_via_clearance_error`

## Missing CAD And Simulation Elements

Nothing in this repo currently emits CAD or simulation Circuit JSON:

- `cad_component`
- `simulation_current_source`
- `simulation_experiment`
- `simulation_op_amp`
- `simulation_switch`
- `simulation_transient_voltage_graph`
- `simulation_unknown_experiment_error`
- `simulation_voltage_probe`
- `simulation_voltage_source`

## Partial Or Lossy Mappings

These items are worth tracking separately because they are not completely
missing, but they are not mapped with full `circuit-json` fidelity yet.

- `schematic_net_label` is listed in `getOutput()` but no stage inserts it.
- `source_net` is not emitted, even though `source_trace.connected_source_net_ids`
  already has a placeholder for it.
- `pcb_net` is not emitted; net names are only kept in an internal map.
- schematic component `ftype` inference is still a best-effort cast instead of a
  validated mapping.
- schematic component size is hard-coded to `1 x 1`.
- schematic trace conversion is still one-trace-per-wire; junctions become
  standalone traces instead of being merged into a net-aware graph.
- connector-like PCB parts are currently downgraded to `simple_chip`.
- PCB LEDs are currently inferred as `simple_diode` on the footprint path.
- board outline extraction currently focuses on `Edge.Cuts` line and arc data.
- many visible PCB graphics are flattened into `pcb_silkscreen_path` or
  `pcb_courtyard_outline` instead of dedicated primitive types.

## Suggested Priority Order

If the goal is better KiCad import parity, the highest-value missing work is
probably:

1. `source_net` and `pcb_net`
2. `schematic_net_label`
3. better `source_component.ftype` coverage
4. schematic text and basic schematic graphics
5. `pcb_cutout`, `pcb_keepout`, and ground-plane related elements
6. dedicated silkscreen / courtyard primitive coverage
7. source/pcb diagnostic element emission
