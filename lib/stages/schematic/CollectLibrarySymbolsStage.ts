import { ConverterStage } from "../../types"
import { applyToPoint } from "transformation-matrix"
import type { SchematicSymbol } from "kicadts"
import { inferSymbolName } from "./utils/inferSymbolName"
import { rotationToDirection } from "./utils/rotationToDirection"
import { mapJustifyToAnchor } from "./utils/mapJustifyToAnchor"

/**
 * CollectLibrarySymbolsStage extracts KiCad schematic symbols and creates:
 * - source_component entries (with ftype inferred from library id)
 * - schematic_component entries with positions
 * - schematic_port entries for each pin
 */
export class CollectLibrarySymbolsStage extends ConverterStage {
  private processedSymbols = new Set<string>()

  step(): boolean {
    if (!this.ctx.kicadSch || !this.ctx.k2cMatSch) {
      this.finished = true
      return false
    }

    const symbols = this.ctx.kicadSch.symbols || []
    console.log(`CollectLibrarySymbolsStage found ${symbols.length} symbols to process`);

    for (const symbol of symbols) {
      const uuid = symbol.uuid
      if (!uuid || this.processedSymbols.has(uuid)) continue

      this.processSymbol(symbol)
      this.processedSymbols.add(uuid)
    }

    this.finished = true
    return false
  }

  private processSymbol(symbol: SchematicSymbol) {
    if (!this.ctx.k2cMatSch) return

    // Get symbol properties
    const reference = this.getProperty(symbol, "Reference") || "U?"
    const value = this.getProperty(symbol, "Value") || ""
    const libId = symbol.libraryId || ""

    // Transform position from KiCad to CJ coordinates
    const at = symbol.at
    const kicadPos = { x: at?.x ?? 0, y: at?.y ?? 0 }
    const cjPos = applyToPoint(this.ctx.k2cMatSch, kicadPos)

    const rotation = at?.angle ?? 0
    // Infer component type from library id
    const ftype = this.inferFtype(libId, reference)

    // Create source_component (if it doesn't exist)
    const sourceComponentId = `${libId}_source`
    const existingSource = this.ctx.db.source_component
      .list()
      .find((sc: any) => sc.source_component_id === sourceComponentId)

    if (!existingSource) {
      this.ctx.db.source_component.insert({
        name: libId || reference,
        ftype: ftype as any, // TODO: Fix ftype - should be mapped to valid CJ simple component types
        manufacturer_part_number: value || undefined,
      })
    }

    // Create schematic_component
    const uuid = symbol.uuid
    if (!uuid) return

    const symbolName = inferSymbolName({ libId, reference, rotation })

    const cleanLibId = libId?.includes(":") ? libId.split(":")[1] : libId;
    const libSymbol = this.ctx.kicadSch?.libSymbols?.symbols?.find(
      (ls: any) => ls.libraryId === cleanLibId || ls.libraryId === libId,
    )
    let hasCustomGraphics = false;
    if (libSymbol) {
      const checkGraphics = (sym: any) => Boolean(sym.rectangles?.length || sym.polylines?.length || sym.texts?.length || sym.circles?.length || sym.arcs?.length);
      hasCustomGraphics = checkGraphics(libSymbol);
      if (!hasCustomGraphics && Array.isArray(libSymbol.subSymbols)) {
         hasCustomGraphics = libSymbol.subSymbols.some(checkGraphics);
      }
    }
    console.log(`[Component Output] ${libId} hasCustomGraphics=${hasCustomGraphics}`);

    const inserted = this.ctx.db.schematic_component.insert({
      source_component_id: sourceComponentId,
      center: { x: cjPos.x, y: cjPos.y },
      size: this.estimateSize(symbol),
      ...(symbolName ? { symbol_name: symbolName } : {}),
      ...(hasCustomGraphics ? { is_box_with_pins: false } : {}),
    } as any)

    const componentId = inserted.schematic_component_id

    // Map uuid to component id for later reference
    this.ctx.symbolUuidToComponentId?.set(uuid, componentId)

    // Create ports for pins
    this.createPorts(symbol, componentId, cjPos)

    // Render designators and properties missing from fallback shapes
    this.createPropertiesText(symbol, componentId, hasCustomGraphics)

    // Update stats
    if (this.ctx.stats) {
      this.ctx.stats.components = (this.ctx.stats.components || 0) + 1
    }
  }

  private createPropertiesText(symbol: SchematicSymbol, componentId: string, hasCustomGraphics: boolean) {
    if (!hasCustomGraphics || !symbol.properties) return;
    const scaleFactor = Math.abs(this.ctx.k2cMatSch?.a || 1 / 15);
    
    for (const prop of symbol.properties) {
      if (!prop.value || prop.value === "~") continue;
      
      const hideVal = (prop as any)._sxEffects?._hide ?? (prop as any).effects?.hide;
      if (hideVal === "yes" || hideVal === true) continue;
      
      const at = (prop as any)._sxAt ?? prop.at;
      if (!at) continue;
      
      const pt = {
        x: at.x * scaleFactor,
        y: -at.y * scaleFactor
      };
      
      const isRef = prop.key === "Reference";
      const anchor = mapJustifyToAnchor((prop as any)._sxEffects?._sxJustify ?? (prop as any).effects?.justify) || "center";
      
      this.ctx.db.schematic_text.insert({
        schematic_component_id: componentId,
        text: prop.value,
        position: pt,
        anchor: anchor,
        color: isRef ? "#008397" : "#005e6b", // tscircuit schematic colors
        font_size: ((prop as any)._sxEffects?._sxFont?._sxSize?._height ?? 1.27) * scaleFactor,
        rotation: at.angle ?? 0,
      } as any);
    }
  }

  private getProperty(
    symbol: SchematicSymbol,
    propName: string,
  ): string | undefined {
    const props = symbol.properties || []
    const prop = props.find((p: any) => p.key === propName)
    return prop?.value
  }

  private inferFtype(libId: string, reference: string): string {
    // Infer component type from library id or reference prefix
    const lower = libId.toLowerCase()

    if (lower.includes("power") || reference.startsWith("#PWR"))
       return "simple_power"
    if (lower.includes(":r_") || reference.startsWith("R"))
      return "simple_resistor"
    if (lower.includes(":c_") || reference.startsWith("C"))
      return "simple_capacitor"
    if (lower.includes(":l_") || reference.startsWith("L"))
      return "simple_inductor"
    if (lower.includes(":d_") || reference.startsWith("D"))
      return "simple_diode"
    if (lower.includes(":led") || reference.startsWith("LED"))
      return "simple_led"
    if (lower.includes(":q_") || reference.startsWith("Q"))
      return "simple_transistor"
    return "simple_chip"
  }

  private estimateSize(symbol: SchematicSymbol): {
    width: number
    height: number
  } {
    // For MVP, use a default size
    // In a more complete implementation, we would parse the symbol's graphical primitives
    // or derive from pin extents
    return { width: 1, height: 1 }
  }

  private createPorts(symbol: SchematicSymbol, componentId: string, cjPos: { x: number; y: number }) {
    // Get the library symbol definition to find pin information
    const libId = symbol.libraryId || ""
    const cleanLibId = libId.includes(":") ? libId.split(":")[1] : libId;
    const libSymbol = this.ctx.kicadSch?.libSymbols?.symbols?.find(
      (ls: any) => ls.libraryId === cleanLibId || ls.libraryId === libId,
    )

    if (!libSymbol) {
      console.log("Could not find libSymbol in registry for instances of:", libId);
      return; 
    }
    
    // DEBUG Graphic Objects
    if (!this.processedSymbols.has(`${libId}_debug_obj`)) {
      console.log(`[Graphic] ${libId} typeof=${libSymbol.constructor.name}`);
      require('fs').writeFileSync(`${libId.replace(/[^a-zA-Z0-9]/g, '_')}_dump.json`, JSON.stringify({
        rectangles: libSymbol.rectangles,
        subSymbols: libSymbol.subSymbols
      }, null, 2));
      this.processedSymbols.add(`${libId}_debug_obj`);
    }

    // Pins might be in the main symbol or in subSymbols
    // Collect pins from all possible locations
    const allPins: any[] = []

    // Check main symbol pins
    if (
      libSymbol.pins &&
      Array.isArray(libSymbol.pins) &&
      libSymbol.pins.length > 0
    ) {
      allPins.push(...libSymbol.pins)
    } else if (libSymbol.pins && !Array.isArray(libSymbol.pins)) {
      allPins.push(libSymbol.pins)
    }

    // Check subSymbols for pins (KiCad often puts pins in subSymbols)
    if (libSymbol.subSymbols && Array.isArray(libSymbol.subSymbols)) {
      for (const subSymbol of libSymbol.subSymbols) {
        if (
          subSymbol.pins &&
          Array.isArray(subSymbol.pins) &&
          subSymbol.pins.length > 0
        ) {
          allPins.push(...subSymbol.pins)
        } else if (subSymbol.pins && !Array.isArray(subSymbol.pins)) {
          allPins.push(subSymbol.pins)
        }
      }
    }

    if (allPins.length === 0) return

    // Get component rotation
    const componentRotation = symbol.at?.angle ?? 0

    for (const pin of allPins) {
      // Transform pin position from KiCad to circuit-json coordinates
      // Pin position in KiCad is relative to symbol origin
      const pinAt = pin._sxAt
      if (!pinAt) continue

      // Apply component rotation to pin position (rotate around origin)
      const rotRad = (componentRotation * Math.PI) / 180
      const cosR = Math.cos(rotRad)
      const sinR = Math.sin(rotRad)

      const rotatedPinPos = {
        x: pinAt.x * cosR - pinAt.y * sinR,
        y: pinAt.x * sinR + pinAt.y * cosR,
      }

      // Transform to circuit-json space scale (k2cMatSch just scales, doesn't rotate)
      const scaleFactor = Math.abs(this.ctx.k2cMatSch?.a || 1 / 15)
      const relativePos = {
        x: rotatedPinPos.x * scaleFactor,
        y: -rotatedPinPos.y * scaleFactor, // Flip Y axis
      }

      this.ctx.db.schematic_port.insert({
        schematic_component_id: componentId,
        center: relativePos,
        facing_direction: this.inferPinDirection(pin, componentRotation),
        pin_number: pin._sxNumber?.value ?? (pin as any).pinNumber ?? undefined,
      } as any)
    }

    // Capture visual layout graphics bounding
    this.createGraphicalPrimitives(symbol, libSymbol, componentId, componentRotation, cjPos);
  }

  private createGraphicalPrimitives(
    symbol: SchematicSymbol,
    libSymbol: any,
    componentId: string,
    componentRotation: number,
    cjPos: { x: number; y: number }
  ) {
    const scaleFactor = Math.abs(this.ctx.k2cMatSch?.a || 1 / 15)
    const rotRad = (componentRotation * Math.PI) / 180
    const cosR = Math.cos(rotRad)
    const sinR = Math.sin(rotRad)

    const transformPoint = (x: number, y: number) => {
      const rx = x * cosR - y * sinR;
      const ry = x * sinR + y * cosR;
      return { 
        x: cjPos.x + rx * scaleFactor, 
        y: cjPos.y - ry * scaleFactor 
      };
    };

    const allContainers = [libSymbol, ...(Array.isArray(libSymbol.subSymbols) ? libSymbol.subSymbols : [])];
    
    for (const container of allContainers) {
      // Rectangles -> schematic_box
      if (Array.isArray(container.rectangles) && container.rectangles.length > 0) {
        console.log(`Extracting ${container.rectangles.length} rectangles for ${componentId}`);
        for (const rect of container.rectangles) {
           const start = rect._sxStart;
           const end = rect._sxEnd;
           if (!start || !end) continue;
           const sx = start.x ?? start._x;
           const sy = start.y ?? start._y;
           const ex = end.x ?? end._x;
           const ey = end.y ?? end._y;
           if (sx === undefined || sy === undefined) continue;
           
           const p1 = transformPoint(sx, sy);
           const p2 = transformPoint(ex, ey);
           this.ctx.db.schematic_box.insert({
              schematic_component_id: componentId,
              x: (p1.x + p2.x) / 2,
              y: (p1.y + p2.y) / 2,
              width: Math.abs(p2.x - p1.x),
              height: Math.abs(p2.y - p1.y),
              is_dashed: false
           } as any);
        }
      }
      
      // Polylines -> schematic_line
      if (Array.isArray(container.polylines)) {
        for (const poly of container.polylines) {
           const pts = poly._sxPts?.points;
           if (!Array.isArray(pts) || pts.length < 2) continue;
           
           for (let i = 0; i < pts.length - 1; i++) {
             const px1 = pts[i].x ?? pts[i]._x;
             const py1 = pts[i].y ?? pts[i]._y;
             const px2 = pts[i+1].x ?? pts[i+1]._x;
             const py2 = pts[i+1].y ?? pts[i+1]._y;
             if (px1 === undefined || py1 === undefined) continue;
             
             const p1 = transformPoint(px1, py1);
             const p2 = transformPoint(px2, py2);
             this.ctx.db.schematic_line.insert({
                schematic_component_id: componentId,
                x1: p1.x,
                y1: p1.y,
                x2: p2.x,
                y2: p2.y,
                color: "black",
                is_dashed: false
             } as any);
           }
        }
      }
      
      // Circles -> schematic_circle
      if (Array.isArray(container.circles)) {
        for (const circ of container.circles) {
           const cx = circ._sxCenter?.x ?? circ._sxCenter?._x;
           const cy = circ._sxCenter?.y ?? circ._sxCenter?._y;
           const rVal = circ._sxRadius?.value ?? circ._sxRadius?._value;
           if (cx === undefined || cy === undefined || rVal === undefined) continue;
           
           const pt = transformPoint(cx, cy);
           const r = rVal * scaleFactor;
           
           const isFilled = circ._sxFill && (circ._sxFill?.type === "color" || circ._sxFill._sxType?.value === "color");
           
           this.ctx.db.schematic_circle.insert({
              schematic_component_id: componentId,
              center: pt,
              radius: Math.abs(r),
              color: "black",
              is_dashed: false,
              is_filled: !!isFilled,
              fill_color: isFilled ? "black" : "none"
           } as any);
        }
      }

      // Arcs -> schematic_arc
      if (Array.isArray(container.arcs)) {
        for (const arc of container.arcs) {
           const sx = arc._sxStart?.x ?? arc._sxStart?._x;
           const sy = arc._sxStart?.y ?? arc._sxStart?._y;
           const mx = arc._sxMid?.x ?? arc._sxMid?._x;
           const my = arc._sxMid?.y ?? arc._sxMid?._y;
           const ex = arc._sxEnd?.x ?? arc._sxEnd?._x;
           const ey = arc._sxEnd?.y ?? arc._sxEnd?._y;
           
           if (sx === undefined || sy === undefined || mx === undefined || my === undefined || ex === undefined || ey === undefined) continue;
           
           const D = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my));
           if (Math.abs(D) < 1e-6) continue;
           
           const cx = ((sx*sx + sy*sy)*(my - ey) + (mx*mx + my*my)*(ey - sy) + (ex*ex + ey*ey)*(sy - my)) / D;
           const cy = ((sx*sx + sy*sy)*(ex - mx) + (mx*mx + my*my)*(sx - ex) + (ex*ex + ey*ey)*(mx - sx)) / D;
           
           const centerPt = transformPoint(cx, cy);
           const startPt = transformPoint(sx, sy);
           const midPt = transformPoint(mx, my);
           const endPt = transformPoint(ex, ey);
           
           const radius = Math.sqrt(Math.pow(startPt.x - centerPt.x, 2) + Math.pow(startPt.y - centerPt.y, 2));
           
           let startAngle = Math.atan2(startPt.y - centerPt.y, startPt.x - centerPt.x) * 180 / Math.PI;
           let midAngle = Math.atan2(midPt.y - centerPt.y, midPt.x - centerPt.x) * 180 / Math.PI;
           let endAngle = Math.atan2(endPt.y - centerPt.y, endPt.x - centerPt.x) * 180 / Math.PI;
           
           startAngle = (startAngle + 360) % 360;
           midAngle = (midAngle + 360) % 360;
           endAngle = (endAngle + 360) % 360;
           
           let cwDiff = (endAngle - startAngle + 360) % 360;
           let midCwDiff = (midAngle - startAngle + 360) % 360;
           
           let direction = (midCwDiff < cwDiff) ? "clockwise" : "counter_clockwise";
           
           this.ctx.db.schematic_arc.insert({
               schematic_component_id: componentId,
               center: centerPt,
               radius: radius,
               start_angle_degrees: startAngle,
               end_angle_degrees: endAngle,
               direction: direction,
               color: "black",
               is_dashed: false
           } as any);
        }
      }

      // Pins -> schematic_line (for the pin visual stems)
      if (Array.isArray(container.pins)) {
        for (const pinItem of container.pins) {
           const at = pinItem._sxAt;
           if (!at) continue;
           const px = at.x ?? at._x;
           const py = at.y ?? at._y;
           const angleStr = at.angle ?? "0";
           const angle = parseFloat(angleStr.toString());
           const len = (pinItem._sxLength?.value ?? pinItem._sxLength?._value ?? 2.54);

           if (px === undefined || py === undefined) continue;

           const rad = angle * Math.PI / 180;
           // Calculate inward dx/dy based on KiCad pin orientation mappings
           const dx = -Math.cos(rad) * len;
           const dy = Math.sin(rad) * len;
           
           const pt1 = transformPoint(px, py);
           const pt2 = transformPoint(px + dx, py + dy);
           
           this.ctx.db.schematic_line.insert({
               schematic_component_id: componentId,
               x1: pt1.x,
               y1: pt1.y,
               x2: pt2.x,
               y2: pt2.y,
               color: "#900000",
               is_dashed: false,
           } as any);

           // Extract pin numbers and names natively alongside the stem
           const num = pinItem._sxNumber?.value ?? pinItem._sxNumber?._value;
           if (num) {
              const numScale = (pinItem._sxNumber?._sxEffects?._sxFont?._sxSize?._height ?? 1.27) * scaleFactor;
              this.ctx.db.schematic_text.insert({
                 schematic_component_id: componentId,
                 text: num.toString(),
                 position: transformPoint(px + dx * 0.5, py + dy * 0.5 - 1.27),
                 anchor: "center",
                 color: "#900000",
                 font_size: numScale,
                 rotation: 0
              } as any);
           }
           
           const name = pinItem._sxName?.value ?? pinItem._sxName?._value;
           if (name && name !== "~") {
              const nameScale = (pinItem._sxName?._sxEffects?._sxFont?._sxSize?._height ?? 1.27) * scaleFactor;
              this.ctx.db.schematic_text.insert({
                 schematic_component_id: componentId,
                 text: name.toString(),
                 position: transformPoint(px + dx * 1.5, py + dy * 1.5),
                 anchor: "center",
                 color: "#008080",
                 font_size: nameScale,
                 rotation: 0
              } as any);
           }
        }
      }

      if (Array.isArray(container.texts)) {
        for (const textItem of container.texts) {
           const at = textItem._sxAt;
           if (!at || !(textItem.text || textItem._value)) continue;
           const pt = transformPoint(at.x, at.y);
           const anchor = mapJustifyToAnchor(textItem._sxEffects?._sxJustify ?? textItem.effects?.justify) || "center";
           this.ctx.db.schematic_text.insert({
             schematic_component_id: componentId,
             text: textItem.text ?? textItem._value ?? "",
             position: pt,
             anchor: anchor,
             color: "black",
             font_size: (textItem._sxEffects?._sxFont?._sxSize?._height ?? 1) * scaleFactor,
             rotation: 0
           } as any);
        }
      }
    }
  }

  private inferPinDirection(
    pin: any,
    componentRotation: number,
  ): "up" | "down" | "left" | "right" {
    const pinAngle = pin.at?.angle ?? 0
    const totalAngle = pinAngle + componentRotation

    return rotationToDirection(totalAngle)
  }
}
