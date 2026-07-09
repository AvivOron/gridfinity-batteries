import * as THREE from 'three';
import { OcctKernel, TransitionMode, type ShapeHandle, type Vec3 } from 'occt-wasm';

export type { ShapeHandle } from 'occt-wasm';

// ---- Gridfinity constants (mm) ----
export const GRID_PITCH = 42;
export const GRID_CLEARANCE = 0.5; // body is 41.5mm so bins sit with a gap in the grid
export const GRID_BODY = GRID_PITCH - GRID_CLEARANCE;
export const UNIT_HEIGHT = 7; // one Z unit
export const WALL = 1.2; // cavity wall thickness
export const FLOOR_THICKNESS = 2.0;
export const BASE_HEIGHT = 4.75;

// Real gridfinity base profile (per the gridfinity.xyz reference diagram): two 45-degree
// chamfers separated by a straight vertical run, as (insetFromEdge, height) breakpoints.
const FOOT_PROFILE: Array<[inset: number, height: number]> = [
  [2.95, 0], // fully inset, at the floor
  [2.15, 0.8], // after the first 45-degree chamfer
  [2.15, 2.6], // after the straight vertical run
  [0, 4.75], // after the second 45-degree chamfer, flush with the full cell size
];

// Stacking lip recess profile (same diagram, mirrored so a foot nests into it), as
// (insetFromEdge, heightAboveDeck) breakpoints of the material REMOVED inside the rim.
export const LIP_HEIGHT = 4.4;
const LIP_PROFILE: Array<[inset: number, height: number]> = [
  [2.85, 0], // recess floor boundary at deck level (foot bottom is 2.95 -> 0.1 clearance)
  [2.15, 0.7], // after the lower 45-degree chamfer
  [2.15, 2.5], // after the straight vertical run
  [0.25, 4.4], // top edge, leaving a 0.25mm land on the rim
];

export interface BatterySpec {
  id: string;
  label: string;
  shape: 'cylinder' | 'coin';
  diameter: number; // mm
  length: number; // mm (cylinder height, or coin thickness)
  spacing?: number; // extra clearance around battery, mm
}

export const BATTERY_TYPES: BatterySpec[] = [
  { id: 'AA', label: 'AA', shape: 'cylinder', diameter: 14.5, length: 50.5, spacing: 1.2 },
  { id: 'AAA', label: 'AAA', shape: 'cylinder', diameter: 10.5, length: 44.5, spacing: 1.0 },
  { id: 'CR2032', label: 'CR2032 (coin)', shape: 'coin', diameter: 20, length: 3.2, spacing: 0.8 },
  { id: 'CR2025', label: 'CR2025 (coin)', shape: 'coin', diameter: 20, length: 2.5, spacing: 0.8 },
  { id: 'LR1130', label: 'LR1130 (coin)', shape: 'coin', diameter: 11.6, length: 3.1, spacing: 0.6 },
];

export interface GridfinityParams {
  gridX: number;
  gridY: number;
  heightUnits: number;
  battery: BatterySpec;
  includeLip?: boolean;
  cornerRadius?: number;
}

export interface LayoutInfo {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  count: number;
}

function outerSize(units: number) {
  return units * GRID_PITCH - GRID_CLEARANCE;
}

export function recommendedHeightUnits(battery: BatterySpec): number {
  // Coins stand on edge in a slit cut ~60% of their diameter deep; cylinders
  // (AA/AAA) stand upright and need their full length.
  const neededDepth = battery.shape === 'coin' ? battery.diameter * 0.6 : battery.length;
  const neededWall = neededDepth + 1 + FLOOR_THICKNESS - BASE_HEIGHT;
  return Math.max(1, Math.ceil(neededWall / UNIT_HEIGHT));
}

// Coin cells stand on edge in a vertical slit slot: narrow along X (thickness +
// clearance), tall along Y (diameter + clearance) — the coin drops in edge-first, like
// a coin-sorter tray. Cylindrical batteries (AA/AAA) get a square footprint either way.
export function cellFootprint(battery: BatterySpec): { w: number; h: number } {
  const clearance = battery.spacing ?? 1;
  if (battery.shape === 'coin') {
    return { w: battery.length + clearance, h: battery.diameter + clearance };
  }
  const size = battery.diameter + clearance;
  return { w: size, h: size };
}

export function computeLayout(params: GridfinityParams): LayoutInfo {
  const { gridX, gridY, battery, includeLip } = params;
  // With a stacking lip, the rim band is 2.85mm thick at deck level — slots must stay
  // clear of it or the lip would overhang the outermost batteries.
  const edgeInset = includeLip ? LIP_PROFILE[0][0] + 0.1 : WALL;
  const usableX = outerSize(gridX) - 2 * edgeInset;
  const usableY = outerSize(gridY) - 2 * edgeInset;
  const { w: cellW, h: cellH } = cellFootprint(battery);

  const cols = Math.max(1, Math.floor((usableX + WALL) / (cellW + WALL)));
  const rows = Math.max(1, Math.floor((usableY + WALL) / (cellH + WALL)));

  return { cols, rows, cellW, cellH, count: cols * rows };
}

let kernelPromise: Promise<OcctKernel> | null = null;
export function getKernel(): Promise<OcctKernel> {
  if (!kernelPromise) {
    // Browser: the .wasm is served from public/. Node (tests): auto-locate it next to
    // the occt-wasm JS module.
    kernelPromise =
      typeof window === 'undefined' ? OcctKernel.init() : OcctKernel.init({ wasm: '/occt-wasm.wasm' });
  }
  return kernelPromise;
}

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

// The 8 edges (4 straight + 4 quarter-circle arcs) of a rounded-rect wire in the XY
// plane at the given Z height.
function roundedRectEdges(
  kernel: OcctKernel,
  width: number,
  depth: number,
  radius: number,
  z: number
): ShapeHandle[] {
  const hw = width / 2;
  const hd = depth / 2;
  // A radius exactly at half-width/half-depth collapses a straight edge to zero
  // length, which OCCT rejects — stay strictly under the smaller half-dimension.
  const r = Math.min(radius, hw - 0.01, hd - 0.01);

  const quarterArc = (cx: number, cy: number, startDeg: number, endDeg: number) => {
    const midDeg = (startDeg + endDeg) / 2;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const pt = (deg: number) => v(cx + r * Math.cos(toRad(deg)), cy + r * Math.sin(toRad(deg)), z);
    return kernel.makeArcEdge(pt(startDeg), pt(midDeg), pt(endDeg));
  };

  return [
    kernel.makeLineEdge(v(-hw + r, -hd, z), v(hw - r, -hd, z)),
    quarterArc(hw - r, -hd + r, -90, 0),
    kernel.makeLineEdge(v(hw, -hd + r, z), v(hw, hd - r, z)),
    quarterArc(hw - r, hd - r, 0, 90),
    kernel.makeLineEdge(v(hw - r, hd, z), v(-hw + r, hd, z)),
    quarterArc(-hw + r, hd - r, 90, 180),
    kernel.makeLineEdge(v(-hw, hd - r, z), v(-hw, -hd + r, z)),
    quarterArc(-hw + r, -hd + r, 180, 270),
  ];
}

// A closed solid whose side wall is a chamfer profile (given as (insetFromEdge, dz)
// breakpoints) swept around a rounded-rect perimeter, capped flat at the first and last
// breakpoints. This one construction serves both the gridfinity foot pedestal and the
// stacking-lip recess cutter — they're the same shape family, mirrored.
function buildProfileSolid(
  kernel: OcctKernel,
  width: number,
  depth: number,
  cornerRadius: number,
  profile: Array<[inset: number, dz: number]>,
  zBase: number
): ShapeHandle {
  const spineWire = kernel.makeWire(roundedRectEdges(kernel, width, depth, cornerRadius, zBase));

  const startPt = v(-width / 2 + cornerRadius, -depth / 2, zBase);
  const profileVecs: Vec3[] = profile.map(([inset, dz]) => v(startPt.x, startPt.y + inset, zBase + dz));
  const profEdges = profileVecs.slice(0, -1).map((p, i) => kernel.makeLineEdge(p, profileVecs[i + 1]));
  const profWire = kernel.makeWire(profEdges);

  const sideShell = kernel.sweep(profWire, spineWire, TransitionMode.RoundCorner);

  const capFace = ([inset, dz]: [number, number]) =>
    kernel.makeFace(
      kernel.makeWire(
        roundedRectEdges(
          kernel,
          width - 2 * inset,
          depth - 2 * inset,
          Math.max(0.1, cornerRadius - inset),
          zBase + dz
        )
      )
    );
  const bottomFace = capFace(profile[0]);
  const topFace = capFace(profile[profile.length - 1]);

  let solid = kernel.sewAndSolidify([sideShell, bottomFace, topFace], 1e-3);
  // sewAndSolidify can produce an inside-out solid (negative volume = reversed
  // orientation, i.e. the set complement); booleans on it misbehave badly.
  if (kernel.getVolume(solid) < 0) solid = kernel.reverseShape(solid);
  return solid;
}

// The material to REMOVE around one cell's foot: a full 42mm-pitch slab spanning
// z 0..BASE_HEIGHT, minus the foot pedestal. Cutting this from the body prism carves
// the per-cell foot (with the 0.5mm inter-cell gaps) out of a single primary solid,
// which keeps the result free of internal membrane faces (a fuse-based assembly of
// body + feet leaves the coplanar interfaces behind as internal faces).
function buildAntiFoot(kernel: OcctKernel, cellCx: number, cellCy: number, cornerRadius: number): ShapeHandle {
  const halfPitch = GRID_PITCH / 2;
  const slab = kernel.makeBoxFromCorners(
    v(cellCx - halfPitch, cellCy - halfPitch, -0.1),
    v(cellCx + halfPitch, cellCy + halfPitch, BASE_HEIGHT)
  );
  // Extend the pedestal past BASE_HEIGHT at the top so cut(slab, pedestal) has no
  // coplanar-face ambiguity.
  const pedestalProfile: Array<[number, number]> = [...FOOT_PROFILE, [0, BASE_HEIGHT + 0.1]];
  let pedestal = buildProfileSolid(kernel, GRID_BODY, GRID_BODY, cornerRadius, pedestalProfile, 0);
  pedestal = kernel.translate(pedestal, cellCx, cellCy, 0);
  return kernel.cut(slab, pedestal);
}

export interface BuiltGeometry {
  geometry: THREE.BufferGeometry;
  layout: LayoutInfo;
  shapeHandle: ShapeHandle;
}

export async function buildBinGeometryOcct(params: GridfinityParams): Promise<BuiltGeometry> {
  const { gridX, gridY, heightUnits, battery, cornerRadius = 3.75 } = params;
  const kernel = await getKernel();

  // Every rebuild creates dozens of intermediate shapes in the kernel arena; we only
  // ever keep the latest result, so flush everything from the previous build first.
  kernel.releaseAll();

  const sizeX = outerSize(gridX);
  const sizeY = outerSize(gridY);
  const totalHeight = BASE_HEIGHT + heightUnits * UNIT_HEIGHT; // deck level (top of walls)
  const includeLip = params.includeLip ?? false;
  const prismTop = includeLip ? totalHeight + LIP_HEIGHT : totalHeight;

  // Single primary solid: full-footprint rounded-rect prism over the whole height
  // (including the lip band, if any — the recess is carved back out below).
  const bodyFace = kernel.makeFace(kernel.makeWire(roundedRectEdges(kernel, sizeX, sizeY, cornerRadius, 0)));
  let shape = kernel.extrude(bodyFace, 0, 0, prismTop);

  // Carve the per-cell gridfinity feet out of its bottom.
  const antiFeet: ShapeHandle[] = [];
  for (let gx = 0; gx < gridX; gx++) {
    for (let gy = 0; gy < gridY; gy++) {
      const cellCx = (gx + 0.5) * GRID_PITCH - sizeX / 2 - GRID_CLEARANCE / 2;
      const cellCy = (gy + 0.5) * GRID_PITCH - sizeY / 2 - GRID_CLEARANCE / 2;
      antiFeet.push(buildAntiFoot(kernel, cellCx, cellCy, cornerRadius));
    }
  }
  shape = kernel.cutAll(shape, antiFeet);

  // Stacking lip: carve the nesting recess into the raised rim band so another bin's
  // foot drops in. The cutter is the recess profile swept along the bin perimeter,
  // extended 0.1 past the top so the cut has no coplanar-face ambiguity.
  if (includeLip) {
    const lipCutterProfile: Array<[number, number]> = [
      ...LIP_PROFILE,
      [LIP_PROFILE[LIP_PROFILE.length - 1][0], LIP_HEIGHT + 0.1],
    ];
    const lipCutter = buildProfileSolid(kernel, sizeX, sizeY, cornerRadius, lipCutterProfile, totalHeight);
    shape = kernel.cut(shape, lipCutter);
  }

  // Battery cavities cut directly into the solid so the material between adjacent
  // slots survives as dividing walls.
  const layout = computeLayout(params);
  const totalW = layout.cols * layout.cellW + (layout.cols - 1) * WALL;
  const totalD = layout.rows * layout.cellH + (layout.rows - 1) * WALL;
  const startX = -totalW / 2 + layout.cellW / 2;
  const startY = -totalD / 2 + layout.cellH / 2;

  const spacing = battery.spacing ?? 1;
  const maxDepth = totalHeight - FLOOR_THICKNESS;

  const cavityTools: ShapeHandle[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const cx = startX + c * (layout.cellW + WALL);
      const cy = startY + r * (layout.cellH + WALL);

      if (battery.shape === 'coin') {
        // Vertical slit: the coin stands on edge and drops in from the top, like a
        // coin-sorter tray. Cut ~60% of the diameter deep so the rest pokes above the
        // rim for an easy pinch-and-pull, capped so a floor always remains.
        const slotDepth = Math.min(battery.diameter * 0.6, maxDepth);
        const slotWidth = battery.length + spacing;
        const slotHeight = battery.diameter + spacing;
        // Radius = half-width so the slot's short ends read as semicircular caps
        // (roundedRectEdges clamps this just under half-width to stay non-degenerate).
        const slotFace = kernel.makeFace(
          kernel.makeWire(roundedRectEdges(kernel, slotWidth, slotHeight, slotWidth / 2, totalHeight - slotDepth))
        );
        const slot = kernel.extrude(slotFace, 0, 0, slotDepth + 1); // +1 pokes above the rim
        cavityTools.push(kernel.translate(slot, cx, cy, 0));
      } else {
        const cavityDepth = Math.min(battery.length + 1, maxDepth);
        const cavityRadius = battery.diameter / 2 + spacing / 2;
        const cyl = kernel.makeCylinder(cavityRadius, cavityDepth + 1); // +1 pokes above the rim
        cavityTools.push(kernel.translate(cyl, cx, cy, totalHeight - cavityDepth));
      }
    }
  }
  if (cavityTools.length > 0) {
    shape = kernel.cutAll(shape, cavityTools);
  }

  const mesh = kernel.tessellate(shape);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  // The model is Z-up (matching STL/slicer convention); the Three.js viewer is Y-up.
  geometry.rotateX(-Math.PI / 2);

  return { geometry, layout, shapeHandle: shape };
}

export async function exportStlOcct(shape: ShapeHandle): Promise<string> {
  const kernel = await getKernel();
  return kernel.exportStl(shape, 0.05, true);
}
