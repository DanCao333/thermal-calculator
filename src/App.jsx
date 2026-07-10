import React, { useState, useCallback } from "react";

// ─── Material Database ────────────────────────────────────────────────────────
// CTE in µm/m/°C  (to convert: µm/m/°C ÷ 1.8 = in/in/°F)
const MATERIALS = {
  workpiece: [
    { id: "select",       label: "Select a material",   cte_C: null,         notes: ""},
    { id: "ss_15_5",      label: "15-5 PH",             cte_C: 10.8,         notes: "High‑strength, corrosion‑resistant stainless steel hardened by heat treatment."},
    { id: "ss_17_4",      label: "17-4 PH",             cte_C: 11.3,         notes: "High‑strength, corrosion‑resistant precipitation‑hardening stainless steel."},
    { id: "a286",         label: "A286",                cte_C: 16.7,         notes: "High‑strength, heat‑resistant iron‑nickel alloy with good corrosion resistance."},
    { id: "inc_718",      label: "Inconel 718",         cte_C: 13.0,         notes: "Heat‑resistant nickel alloy with excellent strength and oxidation resistance."},
    { id: "maraging_300", label: "Maraging 300",        cte_C: 10.1,         notes: "Ultra‑high‑strength, low‑carbon nickel steel that hardens through aging."},
    { id: "stellite_6",   label: "Stellite 6",          cte_C: 14.2,         notes: "Cobalt‑chromium alloy known for excellent wear, heat, and corrosion resistance."},
    { id: "6061_t6",      label: "Aluminum 6061 T6",    cte_C: 23.6,         notes: "Versatile, lightweight aluminum alloy with good corrosion resistance and strength."},
    { id: "7075_t7",      label: "Aluminum 7075 T7",    cte_C: 23.4,         notes: "High‑strength aluminum alloy with excellent fatigue resistance and improved stress‑corrosion resistance."},
    { id: "4340",         label: "4340",                cte_C: 12.6,         notes: "High‑strength alloy steel with good toughness and wear resistance." },
    { id: "440C",         label: "440C",                cte_C: 10.2,         notes: "High‑carbon stainless steel known for excellent hardness, wear resistance, and good corrosion resistance."},
    { id: "titanium",     label: "Titanium Ti-6Al-4V",  cte_C: 8.6,          notes: "Aerospace titanium alloy" },
  ],
  instrument: [
    { id: "same",      label: "Same as Workpiece",   cte_C: null, notes: "" },
    { id: "steel_inst", label: "Steel (micrometer / caliper)", cte_C: 11.7, notes: "Standard measuring instruments" },
    { id: "carbide",   label: "Tungsten Carbide (gauge / CMM probe)", cte_C: 5.5, notes: "Hard gauge plugs, CMM styli" },
    { id: "invar_inst", label: "Invar (precision reference bar)", cte_C: 1.2, notes: "Metrology reference bars" },
    { id: "ceramic_inst", label: "Ceramic / Zirconia (CMM probe)", cte_C: 9.5, notes: "CMM probe material" },
    { id: "chrome_carbide", label: "Chrome Carbide gauge block", cte_C: 11.7, notes: "Gauge blocks per ASME B89" },
    { id: "none_inst", label: "Not applicable",      cte_C: null, notes: "" },
  ],
};

const DIM_TYPES = [
  { id: "od",     label: "Outside Diameter (OD)", icon: "⌀↔" },
  { id: "id",     label: "Inside Diameter / Bore (ID)", icon: "⌀↕" },
  { id: "length", label: "Length", icon: "←→" },
  { id: "thickness", label: "Thickness", icon: "↕" },
  { id: "hole_spacing", label: "Hole Spacing / Center Distance", icon: "⊕⊕" },
  { id: "other",  label: "Other Linear Dimension", icon: "─" },
];

// ─── Math helpers ─────────────────────────────────────────────────────────────
const fToC = (f) => (f - 32) * 5 / 9;
const cToF = (c) => c * 9 / 5 + 32;
const inToMm = (v) => v * 25.4;
const mmToIn = (v) => v / 25.4;

function getCTE(matId, matList, workpieceCTE) {
  if (!matId) return null;
  if (matId === "same") return workpieceCTE;
  if (matId === "none" || matId === "none_inst") return null;
  const m = matList.find((x) => x.id === matId);
  return m ? m.cte_C : null;
}

function calculate(inputs) {
  const {
    shopTempRaw, shopUnit, refTempRaw, refUnit,
    workpieceMatId, instrumentMatId,
    dimValue, dimUnit, dimType, tolPlus, tolMinus,
  } = inputs;

  // Convert everything to °C
  const shopC = shopUnit === "F" ? fToC(shopTempRaw) : shopTempRaw;
  const refC  = refUnit  === "F" ? fToC(refTempRaw)  : refTempRaw;
  const dT    = shopC - refC; // positive = hotter shop

  // CTEs (µm/m/°C → per °C = same numerically)
  const wpMat  = MATERIALS.workpiece.find((m) => m.id === workpieceMatId);
  const alpha_w = wpMat ? wpMat.cte_C * 1e-6 : null;

  const instCTE_C = getCTE(instrumentMatId, MATERIALS.instrument, wpMat?.cte_C);
  const alpha_i   = instCTE_C != null ? instCTE_C * 1e-6 : null;

  // Reference dimension in inches (canonical)
  const L0_in = dimUnit === "mm" ? mmToIn(dimValue) : dimValue;

  if (!alpha_w || isNaN(L0_in) || L0_in <= 0) return null;

  // Workpiece expansion at shop temperature
  // ΔL = α * L0 * ΔT
  const dL_w = alpha_w * L0_in * dT; // in inches

  // At shop temp, the physical size is L0 + dL_w
  // To end up at L0 after cooling to ref temp, we must cut to L_cut such that:
  //   L_cut * (1 + alpha_w * dT) → L0  when cooled
  //   L_cut = L0 / (1 + alpha_w * dT)   [exact]
  //   ≈ L0 * (1 - alpha_w * dT)          [first-order, equivalent for small dT]
  const L_cut_in = L0_in * (1 + alpha_w * dT);
  const thermal_offset_in = L_cut_in - L0_in; // negative if shop is hotter

  // Predicted dim after returning to ref temp (should ≈ L0)
  const L_predicted_in = L_cut_in * (1 - alpha_w * dT);

  // Measurement instrument correction
  // If the instrument is also at shop temp, its scale/frame is also expanded.
  // For a caliper/micrometer measuring an OD at hot temp:
  //   indicated = L_cut_in + dL_w  (what we see on the gauge)
  //   instrument itself has expanded: actual indicated may differ
  // The indicated reading error due to instrument expansion:
  // A steel frame micrometer at hot temp reads LARGER than truth by
  //   delta_indicated = (alpha_i - alpha_w) * L0 * dT  (first-order)
  // If alpha_i == alpha_w: no error (common-material law)
  let instError_in = null;
  if (alpha_i != null) {
    instError_in = (alpha_w - alpha_i) * L0_in * dT;
  }

  // Tolerance in inches
  let tol_plus_in = null, tol_minus_in = null;
  if (tolPlus !== "" && !isNaN(parseFloat(tolPlus))) {
    tol_plus_in = dimUnit === "mm" ? mmToIn(parseFloat(tolPlus)) : parseFloat(tolPlus);
  }
  if (tolMinus !== "" && !isNaN(parseFloat(tolMinus))) {
    tol_minus_in = dimUnit === "mm" ? mmToIn(parseFloat(tolMinus)) : parseFloat(tolMinus);
  }

  // Warning: is offset large vs tolerance?
  let warningLevel = "none"; // none | caution | warning
  if (tol_plus_in != null && tol_minus_in != null) {
    const bandIn = (tol_plus_in + tol_minus_in) / 2;
    const absOffset = Math.abs(thermal_offset_in);
    if (absOffset > bandIn * 0.5) warningLevel = "warning";
    else if (absOffset > bandIn * 0.2) warningLevel = "caution";
  }

  // Dimension-type notes
  const dimNotes = {
    od: dT > 0 ? "OD expands when hot — cut larger than drawing dimension." : "OD contracts when cold — cut smaller than drawing dimension.",
    id: dT > 0 ? "Bore expands when hot — cut larger than drawing dimension; bore will shrink to target at 68°F." : "Bore contracts when cold — cut smaller than drawing dimension.",
    length: dT > 0 ? "Part is longer when hot — cut longer." : "Part is shorter when cold — cut shorter.",
    thickness: dT > 0 ? "Thickness increases when hot — cut thicker." : "Thickness decreases when cold — cut thinner.",
    hole_spacing: dT > 0 ? "Center distance increases when hot — cut further apart." : "Center distance decreases when cold — machine closer together.",
    other: dT > 0 ? "Dimension increases when hot — cut larger." : "Dimension decreases when cold — cut smaller.",
  };

  return {
    shopC, refC, dT,
    alpha_w, alpha_w_F: alpha_w / 1.8,
    alpha_i, instCTE_C,
    L0_in, L_cut_in, thermal_offset_in, L_predicted_in,
    instError_in,
    tol_plus_in, tol_minus_in,
    warningLevel,
    dimNote: dimNotes[dimType] || dimNotes.other,
    wpMat,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
function fmt(val, digits = 5) {
  if (val == null || isNaN(val)) return "—";
  return val.toFixed(digits);
}
function fmtPM(val, digits = 5) {
  if (val == null || isNaN(val)) return "—";
  return (val >= 0 ? "+" : "") + val.toFixed(digits);
}
function displayDim(val_in, unit, digits = 5) {
  if (val_in == null || isNaN(val_in)) return "—";
  if (unit === "mm") return fmt(inToMm(val_in), digits === 5 ? 4 : 3) + " mm";
  return fmt(val_in, digits) + " in";
}
function displayOffset(val_in, unit) {
  if (val_in == null || isNaN(val_in)) return "—";
  const sign = val_in >= 0 ? "+" : "";
  if (unit === "mm") return sign + inToMm(val_in).toFixed(4) + " mm";
  return sign + val_in.toFixed(5) + " in";
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Label({ children, sub }) {
  return (
    <div className="field-label">
      {children}
      {sub && <span className="field-sub">{sub}</span>}
    </div>
  );
}

function Select({ value, onChange, options, className = "" }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={"select " + className}>
      {options.map((o) => (
        <option key={o.id || o.value} value={o.id || o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function TempInput({ value, onChange, unit, onUnitChange, label, sub, defaultVal }) {
  return (
    <div className="field">
      <Label sub={sub}>{label}</Label>
      <div className="input-row">
        <input
          type="number"
          className="num-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step="0.1"
        />
        <div className="unit-toggle">
          <button className={unit === "F" ? "tog-btn active" : "tog-btn"} onClick={() => onUnitChange("F")}>°F</button>
          <button className={unit === "C" ? "tog-btn active" : "tog-btn"} onClick={() => onUnitChange("C")}>°C</button>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value, highlight, sub }) {
  return (
    <div className={`result-row ${highlight ? "result-row--" + highlight : ""}`}>
      <span className="result-label">{label}{sub && <span className="result-sub">{sub}</span>}</span>
      <span className="result-value">{value}</span>
    </div>
  );
}

function WarningBanner({ level, children }) {
  if (level === "none") return null;
  return (
    <div className={`banner banner--${level}`}>
      <span className="banner-icon">{level === "warning" ? "⚠" : "ℹ"}</span>
      <span>{children}</span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function ThermalCalc() {
  const [shopTemp, setShopTemp]   = useState("78");
  const [shopUnit, setShopUnit]   = useState("F");
  const [refTemp,  setRefTemp]    = useState("68");
  const [refUnit,  setRefUnit]    = useState("F");

  const [workpieceMat, setWorkpieceMat] = useState("al_6061");
  const [instrumentMat, setInstrumentMat] = useState("steel_inst");

  const [dimValue, setDimValue] = useState("4.0000");
  const [dimUnit,  setDimUnit]  = useState("in");
  const [dimType,  setDimType]  = useState("od");

  const [tolPlus,  setTolPlus]  = useState("");
  const [tolMinus, setTolMinus] = useState("");

  const [result, setResult] = useState(null);
  const [calculated, setCalculated] = useState(false);

  const handleCalculate = useCallback(() => {
    const r = calculate({
      shopTempRaw: parseFloat(shopTemp),
      shopUnit,
      refTempRaw:  parseFloat(refTemp),
      refUnit,
      workpieceMatId: workpieceMat,
      instrumentMatId: instrumentMat,
      dimValue: parseFloat(dimValue),
      dimUnit,
      dimType,
      tolPlus, tolMinus,
    });
    setResult(r);
    setCalculated(true);
  }, [shopTemp, shopUnit, refTemp, refUnit, workpieceMat, instrumentMat, dimValue, dimUnit, dimType, tolPlus, tolMinus]);

  const handleReset = () => {
    setResult(null);
    setCalculated(false);
  };

  const wpMat = MATERIALS.workpiece.find((m) => m.id === workpieceMat);

  return (
    <div className="app">
      <style>{CSS}</style>

      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo-block">
            <span className="logo-glyph">Δℓ</span>
            <div>
              <div className="logo-title">ThermoComp</div>
              <div className="logo-sub">CNC Thermal Expansion Calculator</div>
            </div>
          </div>
          <div className="ref-badge">Reference: 68°F / 20°C per ANSI/ASME B89</div>
        </div>
      </header>

      <main className="main">
        <div className="layout">

          {/* ── INPUT PANEL ── */}
          <section className="panel panel--input">
            <div className="panel-head">
              <span className="panel-num">01</span>
              <h2 className="panel-title">Shop Conditions</h2>
            </div>

            <TempInput
              label="Shop Temperature"
              sub="Current average shop air temperature"
              value={shopTemp} onChange={setShopTemp}
              unit={shopUnit} onUnitChange={setShopUnit}
            />
            <TempInput
              label="Reference Temperature"
              sub="Drawing datum — default 68°F / 20°C"
              value={refTemp}  onChange={setRefTemp}
              unit={refUnit}   onUnitChange={setRefUnit}
            />

            {/* Delta T preview */}
            {shopTemp && refTemp && (
              <div className="dT-bar">
                {(() => {
                  const sc = shopUnit === "F" ? fToC(parseFloat(shopTemp)) : parseFloat(shopTemp);
                  const rc = refUnit  === "F" ? fToC(parseFloat(refTemp))  : parseFloat(refTemp);
                  const d  = sc - rc;
                  const cls = d > 0 ? "hot" : d < 0 ? "cold" : "neutral";
                  return (
                    <span className={`dT-val dT-${cls}`}>
                      ΔT = {d > 0 ? "+" : ""}{d.toFixed(1)} °C&nbsp;&nbsp;
                      ({(d * 1.8 > 0 ? "+" : "") + (d * 1.8).toFixed(1)} °F)
                      &nbsp;— shop is {d > 0 ? "warmer" : d < 0 ? "cooler" : "at reference"}
                    </span>
                  );
                })()}
              </div>
            )}

            <div className="divider" />

            <div className="panel-head">
              <span className="panel-num">02</span>
              <h2 className="panel-title">Materials</h2>
            </div>

            <div className="field">
              <Label sub="Material being machined">Workpiece Material</Label>
              <Select value={workpieceMat} onChange={setWorkpieceMat} options={MATERIALS.workpiece} />
              {wpMat && (
                <div className="mat-cte">
                  α = {wpMat.cte_C} µm/m/°C &nbsp;|&nbsp; {(wpMat.cte_C / 1.8).toFixed(2)} ×10⁻⁶/°F
                  {wpMat.notes && <span className="mat-note"> — {wpMat.notes}</span>}
                </div>
              )}
            </div>

            <div className="field">
              <Label sub="Micrometer, caliper, CMM, gauge, etc.">Measuring Instrument</Label>
              <Select value={instrumentMat} onChange={setInstrumentMat} options={MATERIALS.instrument} />
            </div>

            <div className="divider" />

            <div className="panel-head">
              <span className="panel-num">03</span>
              <h2 className="panel-title">Dimension</h2>
            </div>

            <div className="field">
              <Label sub="Target dimension on drawing at reference temperature selected">Drawing Dimension</Label>
              <div className="input-row">
                <input
                  type="number"
                  className="num-input num-input--wide"
                  value={dimValue}
                  onChange={(e) => setDimValue(e.target.value)}
                  step="0.0001"
                  min="0"
                />
                <div className="unit-toggle">
                  <button className={dimUnit === "in" ? "tog-btn active" : "tog-btn"} onClick={() => setDimUnit("in")}>in</button>
                  <button className={dimUnit === "mm" ? "tog-btn active" : "tog-btn"} onClick={() => setDimUnit("mm")}>mm</button>
                </div>
              </div>
            </div>

            <div className="field">
              <Label sub="Type of feature being dimensioned (does not affect calculation)">Dimension Type</Label>
              <div className="dim-grid">
                {DIM_TYPES.map((d) => (
                  <button
                    key={d.id}
                    className={dimType === d.id ? "dim-btn active" : "dim-btn"}
                    onClick={() => setDimType(d.id)}
                  >
                    <span className="dim-icon">{d.icon}</span>
                    <span className="dim-label">{d.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <Label sub="Optional — used for tolerance warning">Tolerance (optional)</Label>
              <div className="tol-row">
                <label className="tol-label">+</label>
                <input type="number" className="num-input tol-input" value={tolPlus}
                  onChange={(e) => setTolPlus(e.target.value)} placeholder="0.0005" step="0.0001" min="0" />
                <label className="tol-label">−</label>
                <input type="number" className="num-input tol-input" value={tolMinus}
                  onChange={(e) => setTolMinus(e.target.value)} placeholder="0.0005" step="0.0001" min="0" />
                <span className="tol-unit">{dimUnit}</span>
              </div>
            </div>

            <button className="calc-btn" onClick={handleCalculate}>
              Calculate Compensation →
            </button>
          </section>

          {/* ── RESULTS PANEL ── */}
          <section className="panel panel--results">
            <div className="panel-head">
              <span className="panel-num">04</span>
              <h2 className="panel-title">Results</h2>
            </div>

            {!calculated && (
              <div className="empty-state">
                <div className="empty-glyph">Δℓ = αL₀ΔT</div>
                <div className="empty-text">Enter shop conditions and drawing dimension, then calculate.</div>
              </div>
            )}

            {calculated && !result && (
              <div className="error-banner">
                ⚠ Check your inputs — make sure all required fields are filled and dimension is greater than zero.
              </div>
            )}

            {calculated && result && (
              <>
                {/* Dimension note */}
                <div className={`dim-note ${result.dT > 0 ? "dim-note--hot" : "dim-note--cold"}`}>
                  {result.dT > 0 ? "🌡 Shop is WARMER than reference" : result.dT < 0 ? "🧊 Shop is COOLER than reference" : "✓ Shop is at reference temperature"}
                  <div className="dim-note-detail">{result.dimNote}</div>
                </div>

                {/* Tolerance warning */}
                {result.warningLevel !== "none" && (
                  <WarningBanner level={result.warningLevel}>
                    {result.warningLevel === "warning"
                      ? `Thermal offset (${displayOffset(result.thermal_offset_in, dimUnit)}) exceeds 50% of your tolerance band. Thermal compensation is critical for this part.`
                      : `Thermal offset (${displayOffset(result.thermal_offset_in, dimUnit)}) is 20–50% of your tolerance band. Review carefully.`
                    }
                  </WarningBanner>
                )}

                {/* Core results */}
                <div className="result-block">
                  <div className="result-block-title">Drawing Target</div>
                  <ResultRow label="Drawing dimension at 68°F / 20°C"
                    value={displayDim(result.L0_in, dimUnit)} />
                  <ResultRow label="Shop temperature"
                    value={`${result.shopC.toFixed(1)} °C  (${cToF(result.shopC).toFixed(1)} °F)`} />
                  <ResultRow label="Reference temperature"
                    value={`${result.refC.toFixed(1)} °C  (${cToF(result.refC).toFixed(1)} °F)`} />
                  <ResultRow label="Temperature delta (ΔT)"
                    value={`${result.dT > 0 ? "+" : ""}${result.dT.toFixed(2)} °C`} />
                </div>

                <div className="result-block">
                  <div className="result-block-title">Workpiece — {result.wpMat?.label}</div>
                  <ResultRow label="CTE (α)"
                    value={`${result.wpMat?.cte_C} µm/m·°C  =  ${(result.wpMat?.cte_C / 1.8).toFixed(2)} ×10⁻⁶/°F`} />
                  <ResultRow label="Thermal expansion at shop temp (ΔL)"
                    value={displayOffset(result.dL_w, dimUnit) === "—"
                      ? displayOffset(result.thermal_offset_in, dimUnit)
                      : displayOffset(result.alpha_w * result.L0_in * result.dT, dimUnit)} />
                </div>

                <div className="result-block result-block--highlight">
                  <div className="result-block-title">⬡ Machine to This Dimension at Shop Temperature</div>
                  <ResultRow label="Recommended cut dimension"
                    value={displayDim(result.L_cut_in, dimUnit)}
                    highlight="primary" />
                  <ResultRow label="Thermal offset from drawing"
                    value={displayOffset(result.thermal_offset_in, dimUnit)}
                    highlight="offset" />
                  <ResultRow label="Predicted dimension after returning to 68°F"
                    value={displayDim(result.L_predicted_in, dimUnit)} />
                </div>

                {/* Dual unit display */}
                <div className="dual-unit">
                  <div className="dual-block">
                    <div className="dual-label">Cut dimension (inches)</div>
                    <div className="dual-val">{fmt(result.L_cut_in, 5)} in</div>
                    <div className="dual-offset">{displayOffset(result.thermal_offset_in, "in")} from drawing</div>
                  </div>
                  <div className="dual-sep">↔</div>
                  <div className="dual-block">
                    <div className="dual-label">Cut dimension (mm)</div>
                    <div className="dual-val">{fmt(inToMm(result.L_cut_in), 4)} mm</div>
                    <div className="dual-offset">{displayOffset(result.thermal_offset_in, "mm")} from drawing</div>
                  </div>
                </div>

                {/* Instrument correction */}
                {result.instError_in != null && Math.abs(result.instError_in) > 1e-8 && (
                  <div className="result-block">
                    <div className="result-block-title">📏 Measurement Instrument Note</div>
                    <ResultRow label="Instrument CTE"
                      value={`${result.instCTE_C} µm/m·°C`} />
                    <ResultRow label="Instrument-vs-workpiece CTE difference"
                      value={`${((result.instCTE_C ?? 0) - (result.wpMat?.cte_C ?? 0)).toFixed(1)} µm/m·°C`} />
                    <ResultRow
                      label="Indicated reading error at shop temp"
                      value={displayOffset(result.instError_in, dimUnit)}
                      highlight={Math.abs(result.instError_in) > 0.00005 ? "caution" : undefined}
                    />
                    <div className="inst-note">
                      {Math.abs(result.instError_in) < 0.00001
                        ? "✓ Instrument and workpiece have nearly identical CTE — measurement error is negligible."
                        : result.instError_in < 0
                          ? `The instrument frame expands more than the workpiece. Your gauge may read SMALLER than the true dimension by around ${(Math.abs(result.instError_in).toFixed(5))} in.`
                          : `The instrument frame expands less than the workpiece. Your gauge may read LARGER than the true dimension by around ${(Math.abs(result.instError_in).toFixed(5))} in.`
                      }
                    </div>
                  </div>
                )}

                {/* Tolerance summary */}
                {(result.tol_plus_in != null || result.tol_minus_in != null) && (
                  <div className="result-block">
                    <div className="result-block-title">Tolerance Analysis</div>
                    {result.tol_plus_in != null && (
                      <ResultRow label="Upper tolerance"
                        value={`+${displayDim(result.tol_plus_in, dimUnit)}`} />
                    )}
                    {result.tol_minus_in != null && (
                      <ResultRow label="Lower tolerance"
                        value={`−${displayDim(result.tol_minus_in, dimUnit)}`} />
                    )}
                    <ResultRow label="Thermal offset magnitude"
                      value={displayOffset(Math.abs(result.thermal_offset_in), dimUnit)} />
                    <div className={`tol-verdict tol-verdict--${result.warningLevel === "none" ? "ok" : result.warningLevel}`}>
                      {result.warningLevel === "none" && "✓ Thermal offset is small relative to tolerance."}
                      {result.warningLevel === "caution" && "⚠ Thermal offset is a significant fraction of tolerance — apply compensation."}
                      {result.warningLevel === "warning" && "⛔ Thermal offset may push part outside tolerance without compensation."}
                    </div>
                  </div>
                )}

                {/* Disclaimer */}
                <div className="disclaimer">
                  <strong>First-order calculator</strong> — assumes uniform temperature, isotropic material, no thermal gradients, no cutting heat, no coolant effects, and no residual stress. CTE values are nominal; actual alloy CTE may vary ±5–10%. This tool does not replace calibrated inspection or CMM verification. Verify with shop-specific data before production use.
                </div>
              </>
            )}
          </section>
        </div>

        {/* Examples strip */}
        <section className="examples">
          <div className="examples-title">Quick Examples</div>
          <div className="ex-grid">
            {[
              { label: "Aluminum OD, hot shop", desc: "Al 6061 · 4.0000 in OD · 78°F shop", action: () => { setWorkpieceMat("6061_t6"); setDimValue("4.0000"); setDimUnit("in"); setDimType("od"); setShopTemp("78"); setShopUnit("F"); setRefTemp("68"); setRefUnit("F"); setInstrumentMat("steel_inst"); setTolPlus("0.0005"); setTolMinus("0.0005"); setResult(null); setCalculated(false); } },
              { label: "Steel length, cold shop", desc: "4340 Steel · 10.000 in length · 58°F shop", action: () => { setWorkpieceMat("4340"); setDimValue("10.0000"); setDimUnit("in"); setDimType("length"); setShopTemp("58"); setShopUnit("F"); setRefTemp("68"); setRefUnit("F"); setInstrumentMat("steel_inst"); setTolPlus("0.001"); setTolMinus("0.001"); setResult(null); setCalculated(false); } },
              { label: "Stainless + steel mic", desc: "17-4 PH · 50 mm OD · 80°F · steel micrometer", action: () => { setWorkpieceMat("ss_17_4"); setDimValue("50.0000"); setDimUnit("mm"); setDimType("od"); setShopTemp("80"); setShopUnit("F"); setRefTemp("68"); setRefUnit("F"); setInstrumentMat("steel_inst"); setTolPlus("0.025"); setTolMinus("0.025"); setResult(null); setCalculated(false); } },
              { label: "Titanium tight tol.", desc: "Ti-6Al-4V · 2.5000 in bore · 85°F · ±0.0002 in", action: () => { setWorkpieceMat("titanium"); setDimValue("2.5000"); setDimUnit("in"); setDimType("id"); setShopTemp("85"); setShopUnit("F"); setRefTemp("68"); setRefUnit("F"); setInstrumentMat("carbide"); setTolPlus("0.0002"); setTolMinus("0.0002"); setResult(null); setCalculated(false); } },
            ].map((ex) => (
              <button key={ex.label} className="ex-btn" onClick={ex.action}>
                <div className="ex-name">{ex.label}</div>
                <div className="ex-desc">{ex.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Formula reference */}
        <section className="formula-ref">
          <div className="formula-title">Formula Reference</div>
          <div className="formula-grid">
            <div className="formula-card">
              <div className="formula-name">Thermal expansion</div>
              <div className="formula-eq">ΔL = α · L₀ · ΔT</div>
            </div>
            <div className="formula-card">
              <div className="formula-name">Corrected cut dimension</div>
              <div className="formula-eq">L_cut = L₀ * (1 + α · ΔT)</div>
            </div>
            <div className="formula-card">
              <div className="formula-name">Thermal offset</div>
              <div className="formula-eq">δ = L_cut − L₀</div>
            </div>
            <div className="formula-card">
              <div className="formula-name">Instrument reading error</div>
              <div className="formula-eq">ε = (part − α_inst) · L₀ · ΔT</div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        ThermoComp · First-order thermal compensation · Reference temperature 68°F per ANSI/ASME B89.6.2 · Not a substitute for calibrated metrology
      </footer>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .app {
    --bg: #1b1d23;
    --panel: #23262f;
    --panel-alt: #1a1c23;
    --recess: #101216;
    --lcd-bg: #0b1510;
    --lcd-text: #fdd300;
    --lcd-text-dim: #bb8c00;
    --border: #3a3f4f;
    --border-soft: #2c2f3b;
    --text-primary: #eef0f4;
    --text-secondary: #a7aec2;
    --text-muted: #6d7488;
    --accent: #ffb020;
    --accent-bright: #ffcb52;
    --accent-dark: #7a4f10;
    --accent-panel: #2e2410;
    --blue: #5db4f7;
    --blue-panel: #0f2436;
    --blue-border: #2f6fa8;
    --hot: #ff8a4c;
    --hot-panel: #34200f;
    --hot-border: #a85a28;
    --cold: #5db4f7;
    --cold-panel: #10202f;
    --cold-border: #2f6fa8;
    --caution: #ffcc3d;
    --caution-panel: #33290c;
    --caution-border: #a9862a;
    --warning: #ff8a4c;
    --warning-panel: #341c0c;
    --warning-border: #a85a28;
    --ok: #5fdd8a;

    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    background: var(--bg);
    color: var(--text-primary);
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.6;
  }

  .mono {
    font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  }

  /* ── Header ── */
  .header {
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
    padding: 0 24px;
  }
  .header-inner {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
  }
  .logo-block { display: flex; align-items: center; gap: 14px; }
  .logo-glyph {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 26px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -0.5px;
    line-height: 1;
    text-shadow: 0 0 14px rgba(255,176,32,0.35);
  }
  .logo-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 0.3px;
    text-align: left;
  }
  .logo-sub { font-size: 11.5px; color: var(--text-muted); letter-spacing: 0.4px; font-style: italic; }
  .ref-badge {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 10.5px;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    padding: 4px 9px;
    border-radius: 4px;
    letter-spacing: 0.5px;
    background: var(--panel-alt);
  }

  /* ── Main layout ── */
  .main { max-width: 1200px; margin: 0 auto; padding: 24px 24px 0; }
  .layout { display: grid; grid-template-columns: 420px 1fr; gap: 18px; align-items: start; }

  @media (max-width: 860px) {
    .layout { grid-template-columns: 1fr; }
  }

  /* ── Panels ── */
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.3);
    padding: 20px;
  }
  .panel-head { display: flex; align-items: left; gap: 10px; margin-bottom: 16px; }
  .panel-num {
    font-family: 'JetBrains Mono', Consolas, monospace;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--accent-bright);
    letter-spacing: 1px;
    border: 1px solid var(--accent-dark);
    padding: 3px 7px;
    border-radius: 4px;
    background: var(--accent-panel);
  }
  .panel-title { font-size: 14.5px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.3px; text-align: left; }

  /* ── Fields ── */
  .field { margin-bottom: 15px; }
  .field-label {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--text-secondary);
    margin-bottom: 6px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    text-align: left;
  }
  .field-sub { font-weight: 400; color: var(--text-muted); margin-left: 8px; text-transform: none; letter-spacing: 0; font-style: italic; }
  .input-row { display: flex; gap: 8px; align-items: center; }

  .num-input {
    font-family: 'JetBrains Mono', Consolas, monospace;
    background: var(--recess);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: inset 0 1px 4px rgba(0,0,0,0.4);
    color: var(--lcd-text);
    font-size: 15px;
    font-weight: 600;
    padding: 8px 10px;
    width: 110px;
    outline: none;
    transition: border-color 0.15s;
  }
  .num-input:focus { border-color: var(--accent); }
  .num-input--wide { width: 160px; }

  .unit-toggle { display: flex; border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
  .tog-btn {
    font-family: Georgia, serif;
    background: var(--panel-alt);
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 700;
    padding: 7px 13px;
    transition: background 0.1s, color 0.1s;
  }
  .tog-btn.active { background: var(--accent); color: #1a1200; }

  .select {
    font-family: Georgia, serif;
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 13.5px;
    padding: 8px 10px;
    width: 100%;
    outline: none;
    cursor: pointer;
  }
  .select:focus { border-color: var(--accent); }

  .mat-cte {
    font-size: 11.5px;
    color: var(--blue);
    margin-top: 5px;
    padding: 5px 9px;
    background: var(--blue-panel);
    border-radius: 4px;
    border-left: 3px solid var(--blue-border);
  }
  .mat-note { color: var(--text-muted); font-style: italic; }

  /* ── ΔT bar ── */
  .dT-bar { margin-bottom: 15px; }
  .dT-val {
    font-family: 'JetBrains Mono', Consolas, monospace;
    display: inline-block;
    font-size: 12.5px;
    font-weight: 600;
    padding: 6px 11px;
    border-radius: 4px;
    border: 1px solid;
  }
  .dT-hot  { color: var(--hot); border-color: var(--hot-border); background: var(--hot-panel); }
  .dT-cold { color: var(--cold); border-color: var(--cold-border); background: var(--cold-panel); }
  .dT-neutral { color: var(--ok); border-color: #2f8a52; background: #0f2417; }

  /* ── Dimension type grid ── */
  .dim-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
  }
  .dim-btn {
    font-family: Georgia, serif;
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11.5px;
    padding: 8px 9px;
    text-align: left;
    transition: all 0.12s;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .dim-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  .dim-btn.active { border-color: var(--accent); color: var(--accent-bright); background: var(--accent-panel); }
  .dim-icon { font-size: 14px; opacity: 0.9; flex-shrink: 0; }
  .dim-label { line-height: 1.35; }

  /* ── Tolerance row ── */
  .tol-row { display: flex; align-items: center; gap: 7px; }
  .tol-label { font-size: 15px; color: var(--text-secondary); font-weight: 700; min-width: 12px; }
  .tol-input { width: 90px !important; }
  .tol-unit { font-size: 11.5px; color: var(--text-muted); }

  .divider {
    border: none;
    border-top: 1px solid var(--border-soft);
    margin: 18px 0;
  }

  /* ── Calculate button ── */
  .calc-btn {
    font-family: Georgia, serif;
    width: 100%;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
    color: #1a1200;
    cursor: pointer;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.5px;
    margin-top: 6px;
    padding: 13px;
    transition: background 0.15s;
  }
  .calc-btn:hover { background: var(--accent-bright); }

  /* ── Results ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 12px;
    color: var(--text-muted);
  }
  .empty-glyph { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 34px; font-weight: 700; letter-spacing: -1px; }
  .empty-text { font-size: 12.5px; text-align: center; max-width: 220px; font-style: italic; }

  .error-banner {
    background: #341313;
    border: 1px solid #a83737;
    border-radius: 6px;
    color: #ff9d9d;
    font-size: 12.5px;
    padding: 12px 14px;
  }

  .dim-note {
    border-radius: 6px;
    border: 1px solid;
    font-size: 12.5px;
    margin-bottom: 12px;
    padding: 10px 12px;
  }
  .dim-note--hot  { background: var(--hot-panel); border-color: var(--hot-border); color: var(--hot); }
  .dim-note--cold { background: var(--cold-panel); border-color: var(--cold-border); color: var(--cold); }
  .dim-note-detail { color: var(--text-secondary); margin-top: 4px; font-size: 11.5px; }

  .banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border-radius: 6px;
    font-size: 12.5px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid;
  }
  .banner--caution { background: var(--caution-panel); border-color: var(--caution-border); color: var(--caution); }
  .banner--warning { background: var(--warning-panel); border-color: var(--warning-border); color: var(--warning); }
  .banner-icon { font-size: 15px; flex-shrink: 0; }

  .result-block {
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .result-block--highlight { border-color: var(--accent-dark); box-shadow: 0 0 0 1px var(--accent-dark); }
  .result-block-title {
    background: var(--panel);
    border-bottom: 1px solid var(--border-soft);
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 7px 12px;
    text-transform: uppercase;
  }
  .result-block--highlight .result-block-title { color: var(--accent); border-color: var(--accent-dark); }

  .result-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--recess);
    gap: 10px;
  }
  .result-row:last-child { border-bottom: none; }
  .result-row--primary .result-value { font-family: 'JetBrains Mono', Consolas, monospace; color: var(--accent-bright); font-weight: 700; font-size: 16px; }
  .result-row--offset  .result-value { font-family: 'JetBrains Mono', Consolas, monospace; color: var(--hot); font-weight: 600; }
  .result-row--caution .result-value { font-family: 'JetBrains Mono', Consolas, monospace; color: var(--caution); }
  .result-label { font-size: 11.5px; color: var(--text-secondary); flex: 1; }
  .result-sub { color: var(--text-muted); margin-left: 6px; }
  .result-value { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 13.5px; color: var(--text-primary); font-weight: 500; white-space: nowrap; }

  /* ── Dual unit block (LCD readout) ── */
  .dual-unit {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--lcd-bg);
    border: 1px solid #1e3d28;
    border-radius: 6px;
    box-shadow: inset 0 1px 6px rgba(0,0,0,0.5);
    padding: 13px 16px;
    margin-bottom: 10px;
  }
  .dual-block { flex: 1; }
  .dual-label { font-size: 10px; color: var(--lcd-text-dim); letter-spacing: 0.6px; text-transform: uppercase; }
  .dual-val { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 19px; font-weight: 700; color: var(--lcd-text); margin: 4px 0; letter-spacing: 0.5px; text-shadow: 0 0 8px rgba(92,240,122,0.35); }
  .dual-offset { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 11.5px; color: var(--hot); }
  .dual-sep { color: #2f4a37; font-size: 18px; }

  /* ── Instrument note ── */
  .inst-note {
    font-size: 11.5px;
    color: var(--text-secondary);
    padding: 9px 12px;
    background: var(--panel);
    border-top: 1px solid var(--border-soft);
    font-style: italic;
  }

  /* ── Tolerance verdict ── */
  .tol-verdict {
    font-size: 11.5px;
    font-weight: 700;
    padding: 9px 12px;
    border-top: 1px solid var(--border-soft);
  }
  .tol-verdict--ok      { color: var(--ok); }
  .tol-verdict--caution { color: var(--caution); }
  .tol-verdict--warning { color: var(--warning); }

  /* ── Disclaimer ── */
  .disclaimer {
    font-size: 10.5px;
    color: var(--text-muted);
    border-top: 1px solid var(--border-soft);
    padding-top: 12px;
    margin-top: 4px;
    line-height: 1.7;
    font-style: italic;
  }

  /* ── Examples ── */
  .examples {
    margin-top: 16px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .examples-title {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .ex-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  @media (max-width: 860px) { .ex-grid { grid-template-columns: repeat(2, 1fr); } }
  .ex-btn {
    font-family: Georgia, serif;
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: inherit;
    cursor: pointer;
    padding: 11px 12px;
    text-align: left;
    transition: border-color 0.12s;
  }
  .ex-btn:hover { border-color: var(--accent); }
  .ex-name { font-size: 12.5px; font-weight: 700; color: var(--text-secondary); margin-bottom: 3px; }
  .ex-desc { font-size: 10.5px; color: var(--text-muted); line-height: 1.5; }

  /* ── Formula reference ── */
  .formula-ref {
    margin-top: 16px;
    margin-bottom: 24px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .formula-title {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .formula-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  @media (max-width: 860px) { .formula-grid { grid-template-columns: repeat(2, 1fr); } }
  .formula-card {
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
  }
  .formula-name { font-size: 10.5px; color: var(--text-muted); margin-bottom: 6px; font-style: italic; }
  .formula-eq { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 13.5px; color: var(--blue); font-weight: 600; }

  /* ── Footer ── */
  .footer {
    border-top: 1px solid var(--border-soft);
    color: var(--text-muted);
    font-size: 10.5px;
    padding: 14px 24px;
    text-align: center;
    letter-spacing: 0.3px;
    margin-top: 8px;
    font-style: italic;
  }
`;