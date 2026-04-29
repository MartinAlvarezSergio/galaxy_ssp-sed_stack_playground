import { SSP_COMPONENT_LINE_COLORS } from "./sspColors";

const PAD_L = 86;
const PAD_R = 28;
const PAD_T = 22;
const PAD_B = 56;

const MINOR_LOG_FACTORS = [2, 3, 4, 5, 6, 7, 8, 9];

export type SpectrumPlotInputs = {
  lambdaAngstrom: Float64Array;
  /** Per-component L_λ; use Float64 so log10(L) is not capped near ~38.5 (Float32 max luminosity). */
  perComponent: Float64Array[];
  total: Float64Array;
  logX: boolean;
  logY: boolean;
  /** When logY: fixed axis limits for log10(L_λ); both must be set and min < max */
  logYAxisMin?: number;
  logYAxisMax?: number;
  /**
   * Fixed wavelength window as log10(λ/1 Å). When logX, axis is these values; when linear, axis is 10^min–10^max Å.
   */
  logXAxisMin?: number;
  logXAxisMax?: number;
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** ~targetCount major ticks on linear scale */
function linearTickValues(min: number, max: number, targetCount: number): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return [min];
  }
  const span = max - min;
  const rough = span / Math.max(2, targetCount - 1);
  const log10 = Math.log10(rough);
  const exp = Math.floor(log10);
  const frac = rough / 10 ** exp;
  let niceFrac = 1;
  if (frac <= 1) {
    niceFrac = 1;
  } else if (frac <= 2) {
    niceFrac = 2;
  } else if (frac <= 5) {
    niceFrac = 5;
  } else {
    niceFrac = 10;
  }
  const step = niceFrac * 10 ** exp;
  const t0 = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let t = t0; t <= max + step * 0.001; t += step) {
    ticks.push(t);
    if (ticks.length > 24) {
      break;
    }
  }
  if (ticks.length === 0) {
    return [min, max];
  }
  return ticks;
}

function log10TickValues(vMin: number, vMax: number): number[] {
  const k0 = Math.ceil(vMin - 1e-12);
  const k1 = Math.floor(vMax + 1e-12);
  const ticks: number[] = [];
  for (let k = k0; k <= k1; k += 1) {
    ticks.push(k);
  }
  if (ticks.length <= 1 && k1 > k0) {
    for (let u = Math.ceil(vMin * 2) / 2; u <= vMax + 1e-9; u += 0.5) {
      ticks.push(u);
    }
  }
  if (ticks.length === 0) {
    ticks.push((vMin + vMax) / 2);
  }
  return ticks;
}

function formatLinearLambda(angstrom: number): string {
  if (!Number.isFinite(angstrom)) {
    return "";
  }
  if (angstrom >= 1e5) {
    return `${(angstrom / 1e4).toFixed(0)}×10⁴`;
  }
  if (angstrom >= 1e4) {
    return `${(angstrom / 1000).toFixed(1)}×10³`;
  }
  if (angstrom >= 1000) {
    return `${Math.round(angstrom)}`;
  }
  return angstrom.toFixed(0);
}

function formatAxisNumber(v: number): string {
  if (!Number.isFinite(v)) {
    return "";
  }
  const a = Math.abs(v);
  if (a === 0) {
    return "0";
  }
  if (a >= 1e4 || a < 1e-3) {
    return v.toExponential(1);
  }
  if (a >= 100) {
    return v.toFixed(0);
  }
  if (a >= 1) {
    return v.toFixed(2).replace(/\.?0+$/, "");
  }
  return v.toPrecision(2);
}

export function renderSpectrumPlot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  plot: SpectrumPlotInputs
): void {
  const {
    lambdaAngstrom,
    perComponent,
    total,
    logX,
    logY,
    logYAxisMin,
    logYAxisMax,
    logXAxisMin,
    logXAxisMax
  } = plot;
  const n = lambdaAngstrom.length;
  if (n < 2) {
    return;
  }

  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#04060c");
  bg.addColorStop(0.5, "#080c18");
  bg.addColorStop(1, "#0a0e1a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  let xMin = lambdaAngstrom[0];
  let xMax = lambdaAngstrom[n - 1];
  if (logX) {
    xMin = Math.log10(Math.max(xMin, 1));
    xMax = Math.log10(Math.max(xMax, xMin + 1e-6));
  }

  const uXLo = logXAxisMin;
  const uXHi = logXAxisMax;
  if (
    uXLo != null &&
    uXHi != null &&
    Number.isFinite(uXLo) &&
    Number.isFinite(uXHi) &&
    uXHi > uXLo
  ) {
    if (logX) {
      xMin = uXLo;
      xMax = uXHi;
    } else {
      xMin = 10 ** uXLo;
      xMax = 10 ** uXHi;
    }
  }

  const scanY = (fn: (y: number) => void): void => {
    const visit = (arr: ArrayLike<number>): void => {
      for (let i = 0; i < n; i += 1) {
        const y = arr[i];
        if (Number.isFinite(y) && y > 0) {
          fn(y);
        }
      }
    };
    visit(total);
    for (const pc of perComponent) {
      visit(pc);
    }
  };

  let yLinMin = Infinity;
  let yLinMax = -Infinity;
  let yLogMin = 99;
  let yLogMax = -99;
  scanY((y) => {
    yLinMin = Math.min(yLinMin, y);
    yLinMax = Math.max(yLinMax, y);
    const ly = Math.log10(y);
    yLogMin = Math.min(yLogMin, ly);
    yLogMax = Math.max(yLogMax, ly);
  });
  if (!Number.isFinite(yLinMin) || yLinMin >= yLinMax) {
    yLinMin = 1e-40;
    yLinMax = 1e-30;
  }
  if (yLogMax <= yLogMin) {
    yLogMin = -30;
    yLogMax = -20;
  }
  const padLin = 0.05 * (yLinMax - yLinMin);
  yLinMin = Math.max(yLinMin - padLin, 1e-300);
  yLinMax += padLin;

  let yLogViewMin = yLogMin;
  let yLogViewMax = yLogMax;
  const userLo = logYAxisMin;
  const userHi = logYAxisMax;
  if (
    logY &&
    userLo != null &&
    userHi != null &&
    Number.isFinite(userLo) &&
    Number.isFinite(userHi) &&
    userHi > userLo
  ) {
    yLogViewMin = userLo;
    yLogViewMax = userHi;
  } else if (logY) {
    const padLog = 0.06 * (yLogMax - yLogMin);
    yLogViewMin = yLogMin - padLog;
    yLogViewMax = yLogMax + padLog;
  }

  yLogMin = yLogViewMin;
  yLogMax = yLogViewMax;

  const xDataToNorm = (xv: number): number => (xv - xMin) / (xMax - xMin);
  const xToPx = (i: number): number => {
    const lam = lambdaAngstrom[i];
    const xv = logX ? Math.log10(Math.max(lam, 1)) : lam;
    return PAD_L + clamp(xDataToNorm(xv), 0, 1) * plotW;
  };

  const yToPx = (y: number): number => {
    if (logY) {
      const ly = Math.log10(Math.max(y, 1e-300));
      const t = (ly - yLogMin) / (yLogMax - yLogMin);
      return PAD_T + (1 - clamp(t, 0, 1)) * plotH;
    }
    const t = (y - yLinMin) / (yLinMax - yLinMin);
    return PAD_T + (1 - clamp(t, 0, 1)) * plotH;
  };

  const xNormToPx = (xNorm: number): number => PAD_L + clamp(xNorm, 0, 1) * plotW;
  const yNormToPx = (yNorm: number): number => PAD_T + (1 - clamp(yNorm, 0, 1)) * plotH;

  // Minor grid (log decades)
  ctx.strokeStyle = "rgba(100, 140, 200, 0.06)";
  ctx.lineWidth = 1;
  if (logX) {
    const k0 = Math.floor(xMin);
    const k1 = Math.ceil(xMax);
    for (let k = k0; k <= k1; k += 1) {
      for (const f of MINOR_LOG_FACTORS) {
        const lx = k + Math.log10(f);
        if (lx < xMin || lx > xMax) {
          continue;
        }
        const xn = xDataToNorm(lx);
        const xPx = xNormToPx(xn);
        ctx.beginPath();
        ctx.moveTo(xPx, PAD_T);
        ctx.lineTo(xPx, PAD_T + plotH);
        ctx.stroke();
      }
    }
  }
  if (logY) {
    const k0 = Math.floor(yLogMin);
    const k1 = Math.ceil(yLogMax);
    for (let k = k0; k <= k1; k += 1) {
      for (const f of MINOR_LOG_FACTORS) {
        const ly = k + Math.log10(f);
        if (ly < yLogMin || ly > yLogMax) {
          continue;
        }
        const yn = (ly - yLogMin) / (yLogMax - yLogMin);
        const yPx = yNormToPx(yn);
        ctx.beginPath();
        ctx.moveTo(PAD_L, yPx);
        ctx.lineTo(PAD_L + plotW, yPx);
        ctx.stroke();
      }
    }
  }

  // Major grid
  ctx.strokeStyle = "rgba(130, 170, 220, 0.14)";
  ctx.lineWidth = 1;
  const xTicks = logX ? log10TickValues(xMin, xMax) : linearTickValues(xMin, xMax, 10);
  for (const xt of xTicks) {
    const xn = logX ? xDataToNorm(xt) : xDataToNorm(xt);
    const xPx = xNormToPx(xn);
    ctx.beginPath();
    ctx.moveTo(xPx, PAD_T);
    ctx.lineTo(xPx, PAD_T + plotH);
    ctx.stroke();
  }

  const yTicks = logY ? log10TickValues(yLogMin, yLogMax) : linearTickValues(yLinMin, yLinMax, 9);
  for (const yt of yTicks) {
    const yn = logY ? (yt - yLogMin) / (yLogMax - yLogMin) : (yt - yLinMin) / (yLinMax - yLinMin);
    const yPx = yNormToPx(yn);
    ctx.beginPath();
    ctx.moveTo(PAD_L, yPx);
    ctx.lineTo(PAD_L + plotW, yPx);
    ctx.stroke();
  }

  // Plot frame
  ctx.strokeStyle = "rgba(200, 215, 240, 0.35)";
  ctx.lineWidth = 2.4;
  ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW - 1, plotH - 1);

  const strokeCurve = (
    arr: ArrayLike<number>,
    stroke: string,
    lineWidth: number,
    dash?: readonly number[]
  ): void => {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i += 1) {
      const y = arr[i];
      if (!Number.isFinite(y) || y <= 0) {
        started = false;
        continue;
      }
      const px = xToPx(i);
      const py = yToPx(y);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  for (let k = 0; k < perComponent.length; k += 1) {
    strokeCurve(perComponent[k], SSP_COMPONENT_LINE_COLORS[k % SSP_COMPONENT_LINE_COLORS.length], 2.9);
  }
  strokeCurve(total, "rgba(248, 250, 255, 0.96)", 3.6, [7, 5]);

  // Tick marks on axes
  const tickLen = 10;
  ctx.fillStyle = "rgba(215, 225, 240, 0.92)";
  ctx.strokeStyle = "rgba(215, 225, 240, 0.92)";
  ctx.font = '22px "SF Mono", ui-monospace, Menlo, monospace';
  ctx.lineWidth = 2;

  for (const xt of xTicks) {
    const xn = logX ? xDataToNorm(xt) : xDataToNorm(xt);
    const xPx = xNormToPx(xn);
    ctx.beginPath();
    ctx.moveTo(xPx, PAD_T + plotH);
    ctx.lineTo(xPx, PAD_T + plotH - tickLen);
    ctx.stroke();
    const label = logX ? `${xt}` : formatLinearLambda(xt);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, xPx, PAD_T + plotH + 12);
  }

  for (const yt of yTicks) {
    const yn = logY ? (yt - yLogMin) / (yLogMax - yLogMin) : (yt - yLinMin) / (yLinMax - yLinMin);
    const yPx = yNormToPx(yn);
    ctx.beginPath();
    ctx.moveTo(PAD_L, yPx);
    ctx.lineTo(PAD_L + tickLen, yPx);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const yLabel = logY ? `${yt}` : formatAxisNumber(yt);
    ctx.fillText(yLabel, PAD_L - 14, yPx);
  }

  // Axis titles
  ctx.fillStyle = "rgba(225, 232, 245, 0.95)";
  ctx.font = '25px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const angstrom = "\u212b";
  const lambda = "\u03bb";
  const xTitle = logX ? `log\u2081\u2080(${lambda} / ${angstrom})` : `${lambda} (${angstrom})`;
  ctx.fillText(xTitle, PAD_L + plotW / 2, height - 40);

  ctx.save();
  ctx.translate(20, PAD_T + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const yTitle = logY
    ? `log\u2081\u2080(L_${lambda} / (erg s\u207b\u00b9 ${angstrom}\u207b\u00b9))`
    : `L_${lambda} (erg s\u207b\u00b9 ${angstrom}\u207b\u00b9)`;
  ctx.fillText(yTitle, 0, 0);
  ctx.restore();

  // Panel caption
  ctx.fillStyle = "rgba(170, 185, 210, 0.75)";
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("BC03 SSP grid · summed composite spectrum", PAD_L + plotW, 6);
}
