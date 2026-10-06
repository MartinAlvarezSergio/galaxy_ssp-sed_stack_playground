import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setLogicalTransform } from "../../core/canvasScale";
import { AppletHostAdapter } from "../../core/host";
import { AppletStage } from "../../ui/stage/AppletStage";
import {
  StageDivider,
  StageIconButton,
  StagePillButton,
  StageReadout,
  StageSection,
  StageSlider,
  StageToggle
} from "../../ui/stage/StageControls";
import { clearSspAssetCache, defaultSspAssetUrl, loadSspAssetCached, type LoadedSspAsset } from "./loadSspAsset";
import { combineMassMsun, normalizeMassScientific, splitMassMsun } from "./massScientific";
import { computeSpectra } from "./spectrum";
import { renderSpectrumPlot } from "./spectrumPlot";
import { SSP_COMPONENT_LINE_COLORS } from "./sspColors";
import { resolvePreset, SSP_PRESETS, type SspPreset } from "./presets";
import type { SspComponent } from "./types";
import "./ssp-stage.css";

type SspCompositeSpectrumCanvasProps = {
  host?: AppletHostAdapter;
};

type Row = {
  id: string;
  /** Coefficient a in M = a × 10^b M☉, typically [1, 10) */
  massMantissa: number;
  /** Exponent b */
  massExp10: number;
  /** Index into preprocessed `asset.ageYr` (tabulated SSP age) */
  ageIdx: number;
  /** Index into `metallicitySorted` (tabulated Z) */
  metalIdx: number;
};

/** Logical plot size; the stage keeps this aspect ratio and the plot is drawn in these units. */
const PLOT_W = 920;
const PLOT_H = 400;
/** Controls panel width (CSS px). While it is open the plot starts to its right. */
const PANEL_W = 364;
/** Panel's left inset plus a small gap, in CSS px. */
const PANEL_GUTTER = 20;
const MASS_EXP_MIN = -4;
const MASS_EXP_MAX = 15;
const Y_LOG_AXIS_SLIDER_MIN = 1;
const Y_LOG_AXIS_SLIDER_MAX = 60;
const DEFAULT_Y_LOG_AXIS_MIN = 35;
const DEFAULT_Y_LOG_AXIS_MAX = 44;

const X_AXIS_LOG_SLIDER_MIN = 0;
const X_AXIS_LOG_SLIDER_MAX = 8;
const DEFAULT_X_AXIS_LOG_MIN = 2;
const DEFAULT_X_AXIS_LOG_MAX = 5;

const TIP = {
  logX: "On: wavelength axis in log₁₀(λ/Å). Off: linear λ in Å.",
  logY: "On: luminosity axis in log₁₀ L_λ. Off: linear L_λ, scaled to the curves.",
  reset: "Back to the three starting components and the default axes.",
  components:
    "Define each SSP by mass, age, and metallicity. The galaxy spectrum is the sum of the SSP spectra.",
  mass: "Stellar mass formed in this burst, in scientific notation a × 10^b M☉. Luminosity scales in proportion.",
  age: "Time since the burst formed (grid value: chosen from the ages of the preprocessed BC03 grid).",
  metallicity:
    "Mass fraction of elements heavier than helium; Z = 0.02 is solar (grid value: chosen from the preprocessed BC03 grid).",
  add: "Add another SSP: 1 × 10^8 M☉ at a mid-grid age and Z.",
  yMin: "Bottom of the plot, as log₁₀ L_λ (erg s⁻¹ Å⁻¹).",
  yMax: "Top of the plot, as log₁₀ L_λ (erg s⁻¹ Å⁻¹).",
  xMin: "Shortest wavelength shown, as log₁₀(λ/Å).",
  xMax: "Longest wavelength shown, as log₁₀(λ/Å).",
  totalMass: "Sum of the SSP masses."
} as const;

/** Section titles are written in capitals here (see ssp-stage.css) so CSS never turns λ into Λ. */
const SECTION = {
  components: "STELLAR POPULATION COMPONENTS",
  presets: "EXAMPLE STAR-FORMATION HISTORIES",
  yWindow: "Y-AXIS WINDOW (LOG L_λ)",
  xWindow: "X-AXIS WAVELENGTH WINDOW (LOG₁₀ λ/Å)"
} as const;

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function enforceYLogAxisOrder(minRaw: number, maxRaw: number): { min: number; max: number } {
  let lo = clampInt(minRaw, Y_LOG_AXIS_SLIDER_MIN, Y_LOG_AXIS_SLIDER_MAX);
  let hi = clampInt(maxRaw, Y_LOG_AXIS_SLIDER_MIN, Y_LOG_AXIS_SLIDER_MAX);
  if (lo >= hi) {
    if (hi < Y_LOG_AXIS_SLIDER_MAX) {
      hi = lo + 1;
    } else {
      lo = hi - 1;
    }
  }
  return { min: lo, max: hi };
}

function enforceXLogAxisOrder(minRaw: number, maxRaw: number): { min: number; max: number } {
  let lo = clampInt(minRaw, X_AXIS_LOG_SLIDER_MIN, X_AXIS_LOG_SLIDER_MAX);
  let hi = clampInt(maxRaw, X_AXIS_LOG_SLIDER_MIN, X_AXIS_LOG_SLIDER_MAX);
  if (lo >= hi) {
    if (hi < X_AXIS_LOG_SLIDER_MAX) {
      hi = lo + 1;
    } else {
      lo = hi - 1;
    }
  }
  return { min: lo, max: hi };
}

function newRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultRows(): Row[] {
  const r = (massMsun: number, ageIdx: number, metalIdx: number): Row => {
    const { mantissa, exp10 } = splitMassMsun(massMsun);
    return { id: newRowId(), massMantissa: mantissa, massExp10: exp10, ageIdx, metalIdx };
  };
  // Choose rows that span young/intermediate/old ages on compact subset grids.
  return [r(2e8, 0, 1), r(5e8, 2, 2), r(1e9, 4, 4)];
}

function newRowFromAsset(data: LoadedSspAsset, massMsun: number): Row {
  const { mantissa, exp10 } = splitMassMsun(massMsun);
  return {
    id: newRowId(),
    massMantissa: mantissa,
    massExp10: exp10,
    ageIdx: Math.min(data.nAge - 1, Math.max(0, Math.floor(data.nAge / 2))),
    metalIdx: Math.min(data.nMetal - 1, Math.max(0, Math.floor(data.nMetal / 2)))
  };
}

/** Short label for age dropdown (one value, scientific). */
function formatAgeDropdownLabel(yr: number): string {
  return `${yr.toExponential(1)} yr`;
}

/** Short label for Z dropdown (one value, scientific). */
function formatMetallicityDropdownLabel(z: number): string {
  return z.toExponential(1);
}

function clampRowsToAsset(prev: Row[], d: LoadedSspAsset): Row[] {
  return prev.map((r) => ({
    ...r,
    ageIdx: Math.max(0, Math.min(d.nAge - 1, r.ageIdx)),
    metalIdx: Math.max(0, Math.min(d.nMetal - 1, r.metalIdx))
  }));
}

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

function superscript(n: number): string {
  return String(n)
    .replace(/-/g, "⁻")
    .replace(/\d/g, (d) => SUPERSCRIPT_DIGITS[Number(d)]);
}

/** e.g. "7.0 × 10⁸ M☉" */
function formatTotalMass(massMsun: number): string {
  if (massMsun === 0) {
    return "0 M☉";
  }
  if (!Number.isFinite(massMsun) || massMsun < 0) {
    return "—";
  }
  const { mantissa, exp10 } = splitMassMsun(massMsun);
  const rounded = Number(mantissa.toFixed(1));
  return rounded >= 10 ? `1.0 × 10${superscript(exp10 + 1)} M☉` : `${rounded.toFixed(1)} × 10${superscript(exp10)} M☉`;
}

function tipProps(tip: string): { title: string; "data-hover-help": string } {
  return { title: tip, "data-hover-help": tip };
}

export function SspCompositeSpectrumCanvas({ host }: SspCompositeSpectrumCanvasProps): JSX.Element {
  void host;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [data, setData] = useState<LoadedSspAsset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>(defaultRows);
  const [logX, setLogX] = useState(true);
  const [logY, setLogY] = useState(true);
  const [yLogAxisMin, setYLogAxisMin] = useState(DEFAULT_Y_LOG_AXIS_MIN);
  const [yLogAxisMax, setYLogAxisMax] = useState(DEFAULT_Y_LOG_AXIS_MAX);
  const [xAxisLogMin, setXAxisLogMin] = useState(DEFAULT_X_AXIS_LOG_MIN);
  const [xAxisLogMax, setXAxisLogMax] = useState(DEFAULT_X_AXIS_LOG_MAX);

  useEffect(() => {
    let cancelled = false;
    loadSspAssetCached(defaultSspAssetUrl())
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setRows((prev) => clampRowsToAsset(prev, d));
          setLoadError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setData(null);
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const components: SspComponent[] = useMemo(() => {
    if (!data) {
      return [];
    }
    return rows.map((r) => ({
      massMsun: combineMassMsun(r.massMantissa, r.massExp10),
      ageYr: data.asset.ageYr[r.ageIdx],
      metallicityZ: data.metallicitySorted[r.metalIdx]
    }));
  }, [data, rows]);

  const spectra = useMemo(() => {
    if (!data) {
      return null;
    }
    return computeSpectra(data, components);
  }, [data, components]);

  const [controlsVisible, setControlsVisible] = useState(true);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) {
      return;
    }
    // On small screens the panel sits below the plot, so nothing needs to be kept clear.
    const overlaid = controlsVisible && !window.matchMedia("(max-width: 760px)").matches;
    const leftReserve = overlaid && c.clientWidth > 0 ? ((PANEL_W + PANEL_GUTTER) * PLOT_W) / c.clientWidth : 0;
    setLogicalTransform(ctx, PLOT_W);
    if (!spectra) {
      ctx.clearRect(0, 0, PLOT_W, PLOT_H);
      return;
    }
    renderSpectrumPlot(ctx, PLOT_W, PLOT_H, {
      lambdaAngstrom: spectra.lambdaAngstrom,
      perComponent: spectra.perComponent,
      total: spectra.total,
      logX,
      logY,
      logYAxisMin: logY ? yLogAxisMin : undefined,
      logYAxisMax: logY ? yLogAxisMax : undefined,
      logXAxisMin: xAxisLogMin,
      logXAxisMax: xAxisLogMax,
      // The readouts panel sits over that corner; the attribution is in the info panel.
      showCaption: false,
      leftReserve
    });
  }, [spectra, logX, logY, yLogAxisMin, yLogAxisMax, xAxisLogMin, xAxisLogMax, controlsVisible]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const updateRow = (
    id: string,
    patch: Partial<Pick<Row, "massMantissa" | "massExp10" | "ageIdx" | "metalIdx">>
  ): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const setMassMantissa = (id: string, raw: number): void => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) {
          return r;
        }
        const { mantissa, exp10 } = normalizeMassScientific(raw, r.massExp10);
        return { ...r, massMantissa: mantissa, massExp10: exp10 };
      })
    );
  };

  const setMassExp10 = (id: string, rawExp: number): void => {
    const e = Math.round(Math.min(MASS_EXP_MAX, Math.max(MASS_EXP_MIN, rawExp)));
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) {
          return r;
        }
        const { mantissa, exp10 } = normalizeMassScientific(r.massMantissa, e);
        return { ...r, massMantissa: mantissa, massExp10: exp10 };
      })
    );
  };

  const addRow = (): void => {
    if (!data) {
      return;
    }
    setRows((prev) => [...prev, newRowFromAsset(data, 1e8)]);
  };

  const removeRow = (id: string): void => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const applyPreset = (preset: SspPreset): void => {
    if (!data) {
      return;
    }
    const resolved = resolvePreset(data, preset);
    setRows(
      resolved.map((c) => {
        const { mantissa, exp10 } = splitMassMsun(c.massMsun);
        return {
          id: newRowId(),
          massMantissa: mantissa,
          massExp10: exp10,
          ageIdx: c.ageIdx,
          metalIdx: c.metalIdx
        };
      })
    );
  };

  const resetAll = (): void => {
    setRows(data ? clampRowsToAsset(defaultRows(), data) : defaultRows());
    setLogX(true);
    setLogY(true);
    setYLogAxisMin(DEFAULT_Y_LOG_AXIS_MIN);
    setYLogAxisMax(DEFAULT_Y_LOG_AXIS_MAX);
    setXAxisLogMin(DEFAULT_X_AXIS_LOG_MIN);
    setXAxisLogMax(DEFAULT_X_AXIS_LOG_MAX);
  };

  const retryLoad = (): void => {
    clearSspAssetCache();
    setLoadError(null);
    setData(null);
    loadSspAssetCached(defaultSspAssetUrl())
      .then((d) => {
        setData(d);
        setRows((prev) => clampRowsToAsset(prev, d));
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  };

  const onLogYChange = (on: boolean): void => {
    setLogY(on);
    if (on) {
      const { min, max } = enforceYLogAxisOrder(yLogAxisMin, yLogAxisMax);
      setYLogAxisMin(min);
      setYLogAxisMax(max);
    }
  };

  const setYWindow = (lo: number, hi: number): void => {
    const { min, max } = enforceYLogAxisOrder(lo, hi);
    setYLogAxisMin(min);
    setYLogAxisMax(max);
  };

  const setXWindow = (lo: number, hi: number): void => {
    const { min, max } = enforceXLogAxisOrder(lo, hi);
    setXAxisLogMin(min);
    setXAxisLogMax(max);
  };

  const totalMassMsun = rows.reduce((sum, r) => sum + combineMassMsun(r.massMantissa, r.massExp10), 0);

  const toolbar = (
    <>
      <StageToggle label="Log wavelength axis" on={logX} tip={TIP.logX} onChange={setLogX} />
      <StageToggle label="Log luminosity axis" on={logY} tip={TIP.logY} onChange={onLogYChange} />
      <StageDivider />
      <StageIconButton icon="reset" label="Reset" tip={TIP.reset} onClick={resetAll} />
    </>
  );

  const componentRows = (
    <div className="ssp-stage-rows">
      <div className="ssp-stage-row ssp-stage-head" aria-hidden="true">
        <span />
        <span {...tipProps(TIP.mass)}>Stellar mass formed (M☉)</span>
        <span {...tipProps(TIP.age)}>Stellar age</span>
        <span {...tipProps(TIP.metallicity)}>Metallicity Z</span>
        <span />
      </div>
      {rows.map((r, idx) => {
        const lineColor = SSP_COMPONENT_LINE_COLORS[idx % SSP_COMPONENT_LINE_COLORS.length];
        return (
          <div
            key={r.id}
            className="ssp-stage-row"
            role="group"
            aria-label={`SSP ${idx + 1}`}
            style={{ "--ssp-color": lineColor } as CSSProperties}
          >
            <span className="ssp-stage-tag">SSP {idx + 1}</span>
            <span className="ssp-stage-mass" {...tipProps(TIP.mass)}>
              <input
                type="number"
                className="ssp-stage-mantissa"
                min={0}
                step={0.01}
                value={r.massMantissa}
                onChange={(e) => setMassMantissa(r.id, Number(e.target.value))}
                aria-label="Mass mantissa a in a times ten to the b solar masses"
              />
              <span className="ssp-stage-mul">×10</span>
              <input
                type="number"
                className="ssp-stage-exp"
                step={1}
                value={r.massExp10}
                min={MASS_EXP_MIN}
                max={MASS_EXP_MAX}
                onChange={(e) => setMassExp10(r.id, Number(e.target.value))}
                aria-label="Mass exponent b in a times ten to the b solar masses"
              />
            </span>
            <select
              disabled={!data}
              value={data ? r.ageIdx : 0}
              aria-label="Stellar age"
              {...tipProps(TIP.age)}
              onChange={(e) => updateRow(r.id, { ageIdx: Number.parseInt(e.target.value, 10) })}
            >
              {data ? (
                data.asset.ageYr.map((yr, i) => (
                  <option key={`age-${i}`} value={i}>
                    {formatAgeDropdownLabel(yr)}
                  </option>
                ))
              ) : (
                <option value={0}>Loading…</option>
              )}
            </select>
            <select
              disabled={!data}
              value={data ? r.metalIdx : 0}
              aria-label="Metallicity Z"
              {...tipProps(TIP.metallicity)}
              onChange={(e) => updateRow(r.id, { metalIdx: Number.parseInt(e.target.value, 10) })}
            >
              {data ? (
                Array.from({ length: data.nMetal }, (_, i) => (
                  <option key={`z-${i}`} value={i}>
                    {formatMetallicityDropdownLabel(data.metallicitySorted[i])}
                  </option>
                ))
              ) : (
                <option value={0}>Loading…</option>
              )}
            </select>
            <StageIconButton
              icon="trash"
              label="Remove SSP component"
              disabled={rows.length <= 1}
              onClick={() => removeRow(r.id)}
            />
          </div>
        );
      })}
    </div>
  );

  const controls = (
    <>
      <StageSection title={SECTION.components}>
        <div className="ssp-stage-section-tip" {...tipProps(TIP.components)}>
          {componentRows}
        </div>
        <div className="stage-pills">
          <StagePillButton label="Add component" tip={TIP.add} disabled={!data} onClick={addRow} />
        </div>
      </StageSection>
      <StageSection title={SECTION.presets}>
        <div className="stage-pills" role="group" aria-label="SSP scientific presets">
          {SSP_PRESETS.map((p) => (
            <StagePillButton key={p.id} label={p.label} tip={p.tip} disabled={!data} onClick={() => applyPreset(p)} />
          ))}
        </div>
      </StageSection>
      {logY ? (
        <StageSection title={SECTION.yWindow}>
          <div className="ssp-stage-pair" role="group" aria-label="Log L lambda axis range">
            <StageSlider
              label="y-axis min"
              display={String(yLogAxisMin)}
              value={yLogAxisMin}
              min={Y_LOG_AXIS_SLIDER_MIN}
              max={Y_LOG_AXIS_SLIDER_MAX}
              step={1}
              tip={TIP.yMin}
              onChange={(v) => setYWindow(v, yLogAxisMax)}
            />
            <StageSlider
              label="y-axis max"
              display={String(yLogAxisMax)}
              value={yLogAxisMax}
              min={Y_LOG_AXIS_SLIDER_MIN}
              max={Y_LOG_AXIS_SLIDER_MAX}
              step={1}
              tip={TIP.yMax}
              onChange={(v) => setYWindow(yLogAxisMin, v)}
            />
          </div>
        </StageSection>
      ) : null}
      {spectra ? (
        <StageSection title={SECTION.xWindow}>
          <div className="ssp-stage-pair" role="group" aria-label="Wavelength axis range">
            <StageSlider
              label="x-axis min"
              display={String(xAxisLogMin)}
              value={xAxisLogMin}
              min={X_AXIS_LOG_SLIDER_MIN}
              max={X_AXIS_LOG_SLIDER_MAX}
              step={1}
              tip={TIP.xMin}
              onChange={(v) => setXWindow(v, xAxisLogMax)}
            />
            <StageSlider
              label="x-axis max"
              display={String(xAxisLogMax)}
              value={xAxisLogMax}
              min={X_AXIS_LOG_SLIDER_MIN}
              max={X_AXIS_LOG_SLIDER_MAX}
              step={1}
              tip={TIP.xMax}
              onChange={(v) => setXWindow(xAxisLogMin, v)}
            />
          </div>
        </StageSection>
      ) : null}
    </>
  );

  const readouts = loadError ? (
    <div className="ssp-stage-error" role="alert">
      <span>Could not load the BC03 SSP asset: {loadError}</span>
      <div className="stage-pills">
        <StagePillButton label="Reload asset" onClick={retryLoad} />
      </div>
    </div>
  ) : data ? (
    <>
      <StageReadout label="Total mass" value={formatTotalMass(totalMassMsun)} tip={TIP.totalMass} />
      <StageReadout label="Components" value={String(rows.length)} />
    </>
  ) : (
    <StageReadout label="Loading BC03 grid…" value="" muted />
  );

  const info = (
    <>
      <h4>Reading the plot</h4>
      <ul>
        <li>
          Each coloured line is one simple stellar population (SSP), in the colour of its row. The dashed white line is
          their sum: the composite galaxy spectrum.
        </li>
        <li>
          Wavelength λ is in Å, shown as log₁₀(λ/Å) on the log wavelength axis. Luminosity density L_λ is in erg s⁻¹
          Å⁻¹, shown as log₁₀ L_λ on the log luminosity axis.
        </li>
        <li>
          The y-axis window sets the plotted range of log₁₀ L_λ (log luminosity axis only); the x-axis window sets the
          wavelength range in log₁₀(λ/Å).
        </li>
      </ul>
      <h4>Components</h4>
      <ul>
        <li>
          Build a galaxy spectrum by summing simple stellar populations (SSPs) from the Bruzual &amp; Charlot 2003 grid.
          Each SSP is defined by mass, age, and metallicity.
        </li>
        <li>Mass uses scientific notation (a × 10^b M☉); the luminosity of an SSP scales in proportion to its mass.</li>
        <li>Stellar age and metallicity Z are grid values: they are selected from the preprocessed BC03 grid.</li>
      </ul>
      <h4>Example star-formation histories</h4>
      <ul>
        <li>
          Schematic presets: toy splits of the stellar mass into a few bursts, each snapped to the nearest grid age and
          Z. They are not fitted to any specific galaxy.
        </li>
      </ul>
      <h4>Model</h4>
      <ul>
        <li>Spectra: Bruzual &amp; Charlot (2003) SSP models (BC03), a preprocessed subset of the grid.</li>
        <li>
          Each component is a single burst of stars with one age and one metallicity; a few bursts stand in for a
          continuous star-formation history.
        </li>
        <li>Intrinsic spectra: no dust attenuation or redshift is applied.</li>
      </ul>
    </>
  );

  return (
    <AppletStage
      logicalWidth={PLOT_W}
      logicalHeight={PLOT_H}
      canvasRef={canvasRef}
      canvasLabel="Spectral energy distribution plot"
      onCanvasResize={redraw}
      toolbar={toolbar}
      controls={controls}
      readouts={readouts}
      info={info}
      rootClassName="ssp-stage"
      controlsWidth={PANEL_W}
      onControlsVisibilityChange={setControlsVisible}
    />
  );
}
