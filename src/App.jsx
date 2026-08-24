import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDieline, joinSegments } from './dieline.js';

const MM_PER_IN = 25.4;
const MATERIAL_COLORS = { '1.5': '#e0c39a', '3.0': '#c9a06a', '4.0': '#b8875a', '7.0': '#8a5a34', '0.5': '#f0e6d2' };

function InfoIcon() {
  return <svg className="info-icon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 14h-2v-6h2v6zm-1-7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" /></svg>;
}

function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createDXF(model) {
  let dxf = '0\nSECTION\n2\nENTITIES\n';
  const writePolyline = (segments, layer) => {
    joinSegments(segments).forEach((poly) => {
      const isClosed = Math.abs(poly[0].x1 - poly[poly.length - 1].x2) < 0.001 && Math.abs(poly[0].y1 - poly[poly.length - 1].y2) < 0.001;
      dxf += `0\nLWPOLYLINE\n8\n${layer}\n90\n${isClosed ? poly.length : poly.length + 1}\n70\n${isClosed ? '1' : '0'}\n`;
      poly.forEach((segment) => { dxf += `10\n${segment.x1.toFixed(4)}\n20\n${(-segment.y1).toFixed(4)}\n`; });
      if (!isClosed) {
        const last = poly[poly.length - 1];
        dxf += `10\n${last.x2.toFixed(4)}\n20\n${(-last.y2).toFixed(4)}\n`;
      }
    });
  };
  writePolyline(model.cuts.getSegments(), 'CUTTING');
  writePolyline(model.folds.getSegments(), 'FOLDING');
  return `${dxf}0\nENDSEC\n0\nEOF`;
}

function Sidebar({ values, setValues, model, onDXF, onPDF, onSVG }) {
  const setField = (field) => (event) => setValues((current) => ({ ...current, [field]: event.target.value }));
  const setUnit = (unit) => {
    if (unit === values.unit) return;
    const from = values.unit === 'in' ? MM_PER_IN : 1;
    const to = unit === 'in' ? MM_PER_IN : 1;
    const convert = (value) => {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? value : ((parsed * from) / to).toFixed(unit === 'in' ? 3 : 1);
    };
    setValues((current) => ({ ...current, unit, length: convert(current.length), width: convert(current.width), depth: convert(current.depth) }));
  };
  const changeThickness = (amount) => setValues((current) => {
    const value = parseFloat(current.thickness) || 1.5;
    if ((amount < 0 && value <= 0.1) || (amount > 0 && value >= 4)) return current;
    return { ...current, thickness: (value + amount).toFixed(1) };
  });

  return <aside>
    <div className="sidebar-body">
      <div className="section-header-row">
        <div className="sec-title">Custom size <InfoIcon /></div>
        <div className="unit-toggle">
          <div className={`unit-btn ${values.unit === 'mm' ? 'active' : ''}`} onClick={() => setUnit('mm')}>mm</div>
          <div className={`unit-btn ${values.unit === 'in' ? 'active' : ''}`} onClick={() => setUnit('in')}>in</div>
        </div>
      </div>
      <div className="size-grid">
        {[['length', 'Length'], ['width', 'Width'], ['depth', 'Height']].map(([field, label]) => <div className="input-group" key={field}>
          <label>{label}</label>
          <div className="input-wrap"><input type="number" value={values[field]} min={field === 'depth' ? model.stats.minDepthInput : field === 'width' ? model.stats.minWidthInput : 1} onChange={setField(field)} /><span className="unit-text">{values.unit}</span></div>
        </div>)}
      </div>

      <div className="section-header-row" style={{ marginTop: 20 }}><div className="sec-title">Choose material <InfoIcon /></div></div>
      <div className="material-wrap">
        <div className="mat-color-dot" style={{ background: MATERIAL_COLORS[values.material] || '#d2b48c' }} />
        <select value={values.material} onChange={(event) => setValues((current) => ({ ...current, material: event.target.value, thickness: event.target.value }))}>
          <option value="1.5">E-flute (1.5mm)</option><option value="3.0">B-flute (3.0mm)</option><option value="4.0">C-flute (4.0mm)</option><option value="7.0">BC-flute Double Wall (7.0mm)</option><option value="0.5">Paperboard (0.5mm)</option>
        </select>
      </div>

      <div className="section-header-row" style={{ marginTop: 20, marginBottom: 8 }}><div className="sec-title">Custom thickness</div></div>
      <div className="sub-label">(0.1~4.0mm)</div>
      <div className="stepper-wrap">
        <button className="stepper-btn" aria-label="Reduce thickness" onClick={() => changeThickness(-0.1)}>&minus;</button>
        <input type="number" value={values.thickness} min="0.1" max="4" step="0.1" onChange={setField('thickness')} />
        <button className="stepper-btn" onClick={() => changeThickness(0.1)}>+</button>
      </div>

      <details className="advanced-details">
        <summary>Advanced Options</summary>
        <div className="advanced-content">
          <div className="adv-row"><span>Canvas Width</span><span>{model.stats.width}</span></div>
          <div className="adv-row"><span>Canvas Height</span><span>{model.stats.height}</span></div>
          <div className="adv-row"><span>Min. Recommended Height (this board)</span><span>{model.stats.minDepth}</span></div>
          <div className="adv-row"><span>Lock Tab Flare</span><span>{model.stats.flare}</span></div>
          {[['showNames', 'Show Panel Names'], ['showFormulas', 'Show CAD Dimensions'], ['perfFold', 'Perforated Fold Lines (Laser)']].map(([field, label]) => <label className="adv-toggle" key={field}><input type="checkbox" checked={values[field]} onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.checked }))} /> {label}</label>)}
        </div>
      </details>
    </div>
    <div className="footer">
      <div className="btn-row"><button className="btn-blue" onClick={onDXF}>DXF</button><button className="btn-red" onClick={onPDF}>PDF</button></div>
      <button className="btn-dark" onClick={onSVG}>Download Vector SVG</button>
    </div>
  </aside>;
}

function Canvas({ model }) {
  const [view, setView] = useState({ scale: 0.5, panX: 0, panY: 0 });
  const drag = useRef(null);
  useEffect(() => {
    const move = (event) => drag.current && setView((current) => ({ ...current, panX: event.clientX - drag.current.x, panY: event.clientY - drag.current.y }));
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const zoom = (amount) => setView((current) => ({ ...current, scale: Math.max(0.05, Math.min(3, current.scale + amount)) }));
  const startDrag = (event) => { if (event.target === event.currentTarget || event.target.closest('#svg-wrapper')) drag.current = { x: event.clientX - view.panX, y: event.clientY - view.panY }; };
  const wheel = (event) => { if (event.target === event.currentTarget || event.target.closest('#svg-wrapper')) { event.preventDefault(); zoom(-event.deltaY * 0.001); } };
  const transform = `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`;

  return <main id="viewport" onMouseDown={startDrag} onWheel={wheel}>
    <div className="zoom-bar">
      <button className="zoom-btn" onClick={() => zoom(-0.1)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg></button>
      <div className="zoom-divider" /><span className="zoom-label">{Math.round(view.scale * 100)}%</span><div className="zoom-divider" />
      <button className="zoom-btn" onClick={() => zoom(0.1)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></button>
      <button className="reset-btn" onClick={() => setView({ scale: 0.5, panX: 0, panY: 0 })}>Reset</button>
    </div>
    <div id="svg-wrapper" style={{ transform }} dangerouslySetInnerHTML={{ __html: model.svgHTML }} />
  </main>;
}

export default function App() {
  const [values, setValues] = useState({ length: '180', width: '120', depth: '50', thickness: '1.5', material: '1.5', unit: 'mm', showNames: false, showFormulas: false, perfFold: true });
  const [toast, setToast] = useState('');
  const model = useMemo(() => buildDieline(values), [values]);
  const showToast = (message) => { setToast(message); setTimeout(() => setToast(''), 3300); };
  const exportPDF = () => {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) { showToast('PDF library failed to load.'); return; }
    const box = model.boundingBox;
    const pdf = new JsPDF({ orientation: box.w > box.h ? 'l' : 'p', unit: 'mm', format: [box.w, box.h] });
    const drawLine = (line) => pdf.line(line.x1 - box.x, line.y1 - box.y, line.x2 - box.x, line.y2 - box.y);
    pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.3); model.cuts.getSegments().forEach(drawLine);
    pdf.setDrawColor(255, 0, 0); pdf.setLineWidth(0.3); if (!model.perfEnabled) pdf.setLineDashPattern([2, 2], 0); model.folds.getSegments().forEach(drawLine);
    pdf.save('FEFCO_0427_Dieline.pdf');
  };
  return <>
    <Sidebar values={values} setValues={setValues} model={model} onDXF={() => download(createDXF(model), 'application/dxf', 'FEFCO_0427_Dieline.dxf')} onPDF={exportPDF} onSVG={() => download(model.svgHTML, 'image/svg+xml;charset=utf-8', 'FEFCO_0427_Dieline.svg')} />
    <Canvas model={model} />
    <div id="toast" style={toast ? { display: 'block', opacity: 1 } : undefined}>{toast}</div>
  </>;
}
