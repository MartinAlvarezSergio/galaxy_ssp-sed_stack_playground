import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppletHostAdapter } from "../../core/host";
import { ControlCard } from "../../ui/ControlCard";
import { clearSspAssetCache, defaultSspAssetUrl, loadSspAssetCached, type LoadedSspAsset } from "./loadSspAsset";
import { combineMassMsun, normalizeMassScientific, splitMassMsun } from "./massScientific";
import { computeSpectra } from "./spectrum";
import { renderSpectrumPlot } from "./spectrumPlot";
import { SSP_COMPONENT_LINE_COLORS } from "./sspColors";
import { resolvePreset, SSP_PRESETS, type SspPreset } from "./presets";
import type { SspComponent } from "./types";

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

const PLOT_W = 920;
const PLOT_H = 400;
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

function formatAgeOption(yr: number): string {
  if (yr >= 1e9) {
    return `${(yr / 1e9).toPrecision(4)} Gyr`;
  }
  if (yr >= 1e6) {
    return `${(yr / 1e6).toPrecision(4)} Myr`;
  }
  return `${yr.toExponential(2)} yr`;
}

function formatMetallicityOption(z: number): string {
  if (z >= 0.001) {
    return z.toFixed(4);
  }
  return z.toExponential(2);
}

function clampRowsToAsset(prev: Row[], d: LoadedSspAsset): Row[] {
  return prev.map((r) => ({
    ...r,
    ageIdx: Math.max(0, Math.min(d.nAge - 1, r.ageIdx)),
    metalIdx: Math.max(0, Math.min(d.nMetal - 1, r.metalIdx))
  }));
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

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !spectra) {
      return;
    }
    const ctx = c.getContext("2d");
    if (!ctx) {
      return;
    }
    renderSpectrumPlot(ctx, c.width, c.height, {
      lambdaAngstrom: spectra.lambdaAngstrom,
      perComponent: spectra.perComponent,
      total: spectra.total,
      logX,
      logY,
      logYAxisMin: logY ? yLogAxisMin : undefined,
      logYAxisMax: logY ? yLogAxisMax : undefined,
      logXAxisMin: xAxisLogMin,
      logXAxisMax: xAxisLogMax
    });
  }, [spectra, logX, logY, yLogAxisMin, yLogAxisMax, xAxisLogMin, xAxisLogMax]);

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

  return (
    <div className="ssp-composite-layout">
      <header className="ssp-composite-header">
        <h2>Composite Stellar Spectrum (BC03)</h2>
        <p className="subtle">
          Build a galaxy spectrum by summing simple stellar populations (SSPs) from the Bruzual &amp; Charlot 2003 grid.
        </p>
      </header>

      {loadError ? (
        <section className="panel card">
          <p>Could not load the BC03 SSP asset: {loadError}</p>
          <button type="button" onClick={retryLoad}>
            Reload asset
          </button>
        </section>
      ) : null}

      <div className="ssp-composite-plot-wrap">
        <canvas
          ref={canvasRef}
          width={PLOT_W}
          height={PLOT_H}
          className="ssp-composite-canvas"
          aria-label="Spectral energy distribution plot"
        />
      </div>

      <div className="ssp-composite-toggles">
        <label>
          <input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} /> Log wavelength axis
        </label>
        <label>
          <input
            type="checkbox"
            checked={logY}
            onChange={(e) => {
              const on = e.target.checked;
              setLogY(on);
              if (on) {
                const { min, max } = enforceYLogAxisOrder(yLogAxisMin, yLogAxisMax);
                setYLogAxisMin(min);
                setYLogAxisMax(max);
              }
            }}
          />{" "}
          Log luminosity axis
        </label>
      </div>

      {logY ? (
        <div className="panel card ssp-y-axis-oneline" role="group" aria-label="Log L lambda axis range">
          <div className="ssp-y-oneline-lead">
            <strong>Y-axis window (log L_λ)</strong>.
          </div>
          <label className="ssp-y-inline-range">
            <span>y-axis min</span>
            <span className="ssp-y-slider-value">{yLogAxisMin}</span>
            <input
              type="range"
              min={Y_LOG_AXIS_SLIDER_MIN}
              max={Y_LOG_AXIS_SLIDER_MAX}
              value={yLogAxisMin}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                const { min, max } = enforceYLogAxisOrder(v, yLogAxisMax);
                setYLogAxisMin(min);
                setYLogAxisMax(max);
              }}
            />
          </label>
          <label className="ssp-y-inline-range">
            <span>y-axis max</span>
            <span className="ssp-y-slider-value">{yLogAxisMax}</span>
            <input
              type="range"
              min={Y_LOG_AXIS_SLIDER_MIN}
              max={Y_LOG_AXIS_SLIDER_MAX}
              value={yLogAxisMax}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                const { min, max } = enforceYLogAxisOrder(yLogAxisMin, v);
                setYLogAxisMin(min);
                setYLogAxisMax(max);
              }}
            />
          </label>
        </div>
      ) : null}

      {spectra ? (
        <div className="panel card ssp-x-axis-oneline" role="group" aria-label="Wavelength axis range">
          <div className="ssp-y-oneline-lead">
            <strong>X-axis wavelength window</strong> in log₁₀(λ/Å).
          </div>
          <label className="ssp-y-inline-range">
            <span>x-axis min</span>
            <span className="ssp-y-slider-value">{xAxisLogMin}</span>
            <input
              type="range"
              min={X_AXIS_LOG_SLIDER_MIN}
              max={X_AXIS_LOG_SLIDER_MAX}
              value={xAxisLogMin}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                const { min, max } = enforceXLogAxisOrder(v, xAxisLogMax);
                setXAxisLogMin(min);
                setXAxisLogMax(max);
              }}
            />
          </label>
          <label className="ssp-y-inline-range">
            <span>x-axis max</span>
            <span className="ssp-y-slider-value">{xAxisLogMax}</span>
            <input
              type="range"
              min={X_AXIS_LOG_SLIDER_MIN}
              max={X_AXIS_LOG_SLIDER_MAX}
              value={xAxisLogMax}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                const { min, max } = enforceXLogAxisOrder(xAxisLogMin, v);
                setXAxisLogMin(min);
                setXAxisLogMax(max);
              }}
            />
          </label>
        </div>
      ) : null}

      <ControlCard
        title="Stellar Population Components"
        subtitle="Define each SSP by mass, age, and metallicity. Mass uses scientific notation (a × 10^b M☉); age and Z are selected from the preprocessed BC03 grid."
      >
        <div className="ssp-presets" role="group" aria-label="SSP scientific presets">
          <div className="ssp-presets-label">Example star-formation histories</div>
          <div className="ssp-presets-buttons">
            {SSP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.tip}
                disabled={!data}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ssp-rows">
          {rows.map((r, idx) => {
            const lineColor = SSP_COMPONENT_LINE_COLORS[idx % SSP_COMPONENT_LINE_COLORS.length];
            const accentStyle = { borderColor: lineColor, boxShadow: `0 0 0 1px ${lineColor}` };
            return (
            <div
              key={r.id}
              className="ssp-row card subtle-border"
              style={{ borderLeft: `4px solid ${lineColor}` }}
            >
              <div className="ssp-row-label" style={{ color: lineColor }}>
                SSP {idx + 1}
              </div>
              <div className="ssp-field ssp-mass-block">
                <div className="ssp-mass-row">
                  <span className="ssp-mass-inline-label">Stellar mass formed (M☉)</span>
                  <input
                    type="number"
                    className="ssp-mantissa"
                    min={0}
                    step={0.01}
                    value={r.massMantissa}
                    style={accentStyle}
                    onChange={(e) => setMassMantissa(r.id, Number(e.target.value))}
                    aria-label="Mass mantissa a in a times ten to the b solar masses"
                  />
                  <span className="ssp-mul">×10</span>
                  <input
                    type="number"
                    className="ssp-exp"
                    step={1}
                    value={r.massExp10}
                    min={MASS_EXP_MIN}
                    max={MASS_EXP_MAX}
                    style={accentStyle}
                    onChange={(e) => setMassExp10(r.id, Number(e.target.value))}
                    aria-label="Mass exponent b in a times ten to the b solar masses"
                  />
                </div>
              </div>
              <label className="ssp-field">
                <span>Stellar age (grid value)</span>
                <select
                  disabled={!data}
                  value={data ? r.ageIdx : 0}
                  style={accentStyle}
                  onChange={(e) => updateRow(r.id, { ageIdx: Number.parseInt(e.target.value, 10) })}
                >
                  {data
                    ? data.asset.ageYr.map((yr, i) => (
                        <option key={`age-${i}`} value={i}>
                          {formatAgeOption(yr)} — {yr.toExponential(3)} yr
                        </option>
                      ))
                    : (
                        <option value={0}>Loading…</option>
                      )}
                </select>
              </label>
              <label className="ssp-field">
                <span>Metallicity Z (grid value)</span>
                <select
                  disabled={!data}
                  value={data ? r.metalIdx : 0}
                  style={accentStyle}
                  onChange={(e) => updateRow(r.id, { metalIdx: Number.parseInt(e.target.value, 10) })}
                >
                  {data
                    ? Array.from({ length: data.nMetal }, (_, i) => {
                        const z = data.metallicitySorted[i];
                        return (
                          <option key={`z-${i}`} value={i}>
                            {formatMetallicityOption(z)} — Z = {z.toExponential(3)}
                          </option>
                        );
                      })
                    : (
                        <option value={0}>Loading…</option>
                      )}
                </select>
              </label>
              <button type="button" className="ssp-remove" onClick={() => removeRow(r.id)} disabled={rows.length <= 1}>
                Remove component
              </button>
            </div>
            );
          })}
        </div>
        <button type="button" className="ssp-add" onClick={addRow}>
          Add component
        </button>
      </ControlCard>

    </div>
  );
}
