# Gridfinity Battery Organizer

Generate 3D-printable [Gridfinity](https://gridfinity.xyz/) battery organizer bins in the browser and export them as STL.

Pick a grid size (42mm units), a battery type (AA, AAA, CR2032, CR2025, LR1130), and the tool auto-fills the bin with battery slots, renders a live 3D preview, and exports a print-ready STL — spec-accurate Gridfinity base feet and an optional stacking lip included.

## How it works

- Geometry is built with [occt-wasm](https://github.com/andymai/occt-wasm) (OpenCascade compiled to WebAssembly) — exact B-rep solids, true 45° chamfer profiles per the Gridfinity spec, and native STL export. All client-side, no backend.
- Preview rendering via [Three.js](https://threejs.org/).
- The base foot profile and stacking lip follow the [Gridfinity design reference](https://gridfinity.xyz/specification/) breakpoints (4.75mm foot, 4.4mm lip, 0.1mm nesting clearance).

## Development

```bash
npm install   # also copies occt-wasm.wasm into public/
npm run dev
```

## Build

```bash
npm run build
```

Gridfinity was created by [Zack Freedman](https://www.youtube.com/watch?v=ra_9zU-mnl8).
