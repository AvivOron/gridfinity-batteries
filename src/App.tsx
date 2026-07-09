import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Viewer from './components/Viewer';
import {
  buildBinGeometryOcct,
  exportStlOcct,
  recommendedHeightUnits,
  BATTERY_TYPES,
  type BatterySpec,
  type LayoutInfo,
  type ShapeHandle,
} from './lib/occtGridfinity';
import './App.css';

const EMPTY_LAYOUT: LayoutInfo = { cols: 0, rows: 0, cellW: 0, cellH: 0, count: 0 };

function App() {
  const [gridX, setGridX] = useState(2);
  const [gridY, setGridY] = useState(1);
  const [batteryId, setBatteryId] = useState<string>('AA');
  const [heightUnits, setHeightUnits] = useState(() => recommendedHeightUnits(BATTERY_TYPES[0]));
  const [includeLip, setIncludeLip] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(true);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [layout, setLayout] = useState<LayoutInfo>(EMPTY_LAYOUT);
  const shapeRef = useRef<ShapeHandle | null>(null);
  const buildSeq = useRef(0);

  const battery: BatterySpec = useMemo(
    () => BATTERY_TYPES.find((b) => b.id === batteryId) ?? BATTERY_TYPES[0],
    [batteryId]
  );

  const handleBatteryChange = (b: BatterySpec) => {
    setBatteryId(b.id);
    setHeightUnits(recommendedHeightUnits(b));
  };

  useEffect(() => {
    const seq = ++buildSeq.current;
    setBuilding(true);
    buildBinGeometryOcct({ gridX, gridY, heightUnits, battery, includeLip })
      .then((result) => {
        if (seq !== buildSeq.current) return; // a newer build superseded this one
        shapeRef.current = result.shapeHandle;
        setGeometry(result.geometry);
        setLayout(result.layout);
        setError(null);
        setBuilding(false);
      })
      .catch((e) => {
        if (seq !== buildSeq.current) return;
        console.error(e);
        setError(e instanceof Error ? e.message : 'Failed to generate geometry');
        setBuilding(false);
      });
  }, [gridX, gridY, heightUnits, battery, includeLip]);

  const handleExport = async () => {
    if (shapeRef.current == null) return;
    try {
      const stl = await exportStlOcct(shapeRef.current);
      const blob = new Blob([stl], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gridfinity-${gridX}x${gridY}x${heightUnits}-${battery.id}.stl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to export STL');
    }
  };

  return (
    <div className="app">
      <aside className="panel">
        <h1>Gridfinity Battery Organizer</h1>
        <p className="subtitle">Configure a Gridfinity-compatible bin sized to hold batteries, then export to STL.</p>

        <section>
          <h2>Grid size</h2>
          <div className="row">
            <label>
              Width (units of 42mm)
              <input type="number" min={1} max={12} value={gridX} onChange={(e) => setGridX(clamp(Number(e.target.value), 1, 12))} />
            </label>
            <label>
              Depth (units of 42mm)
              <input type="number" min={1} max={12} value={gridY} onChange={(e) => setGridY(clamp(Number(e.target.value), 1, 12))} />
            </label>
          </div>
          <label>
            Height (units of 7mm)
            <input type="number" min={1} max={12} value={heightUnits} onChange={(e) => setHeightUnits(clamp(Number(e.target.value), 1, 12))} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={includeLip} onChange={(e) => setIncludeLip(e.target.checked)} />
            Stacking lip (other bins can stack on top)
          </label>
        </section>

        <section>
          <h2>Battery type</h2>
          <div className="battery-grid">
            {BATTERY_TYPES.map((b) => (
              <button
                key={b.id}
                className={`battery-btn ${b.id === batteryId ? 'active' : ''}`}
                onClick={() => handleBatteryChange(b)}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="battery-meta">
            &oslash;{battery.diameter}mm &times; {battery.length}mm
          </div>
        </section>

        <section>
          <h2>Layout</h2>
          <div className="layout-info">
            <span>{layout.cols} &times; {layout.rows}</span>
            <span className="muted">= {layout.count} slots (auto-filled)</span>
          </div>
        </section>

        {error && <div className="error">{error}</div>}

        <button className="export-btn" onClick={handleExport} disabled={building || shapeRef.current == null}>
          {building ? 'Building…' : 'Export STL'}
        </button>

        <footer className="footnote">
          Outer footprint: {(gridX * 42 - 0.5).toFixed(1)}mm &times; {(gridY * 42 - 0.5).toFixed(1)}mm &times; {(heightUnits * 7 + 4.75 + (includeLip ? 4.4 : 0)).toFixed(1)}mm
          <br />
          Net height (excl. base foot): {(heightUnits * 7 + (includeLip ? 4.4 : 0)).toFixed(1)}mm
        </footer>
      </aside>

      <main className="viewer-wrap">
        <Viewer geometry={geometry} />
        <div className="viewer-hint">drag to rotate &middot; scroll to zoom</div>
      </main>
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

export default App;
