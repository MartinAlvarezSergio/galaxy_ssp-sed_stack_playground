import type { SspBc03AssetV1 } from "./types";

export type LoadedSspAsset = {
  asset: SspBc03AssetV1;
  /** SSP template mass normalization in M☉ inferred from units string (fallback: 1e6) */
  massNormMsun: number;
  /** λ (Å), length nLambda */
  lambda: Float64Array;
  /** log10(age / yr), length nAge — strictly increasing */
  logAge: Float64Array;
  /** Sorted ascending Z; same length as asset metallicity */
  metallicitySorted: Float64Array;
  /** Column permutation applied to metal axis (original file order may be unsorted) */
  metalPerm: number[];
  /** flux[iAge, iMetal, iLambda] row-major after metal permutation */
  flux: Float64Array;
  nAge: number;
  nMetal: number;
  nLambda: number;
};

let cached: Promise<LoadedSspAsset> | null = null;
const DEFAULT_MASS_NORM_MSUN = 1e6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAsset(raw: unknown): SspBc03AssetV1 {
  if (!isRecord(raw)) {
    throw new Error("SSP asset: expected JSON object");
  }
  const version = raw.version;
  if (version !== 1) {
    throw new Error(`SSP asset: unsupported version ${String(version)}`);
  }
  const dims = raw.dims;
  if (!Array.isArray(dims) || dims.length !== 3) {
    throw new Error("SSP asset: dims must be [nAge, nMetal, nLambda]");
  }
  const [nAge, nMetal, nLambda] = dims as [number, number, number];
  const fluxLinear = raw.fluxLinear;
  if (!Array.isArray(fluxLinear) || fluxLinear.length !== nAge * nMetal * nLambda) {
    throw new Error("SSP asset: fluxLinear length mismatch");
  }
  return {
    version: 1,
    model: String(raw.model ?? ""),
    unitsLinearLuminosity: String(raw.unitsLinearLuminosity ?? ""),
    lambdaAngstrom: raw.lambdaAngstrom as number[],
    ageYr: raw.ageYr as number[],
    metallicity: raw.metallicity as number[],
    dims: [nAge, nMetal, nLambda],
    fluxLinear: fluxLinear as number[]
  };
}

function parseMassNormMsun(units: string): number {
  const s = units.toLowerCase();
  const explicitPow = s.match(/10\^([+-]?\d+(?:\.\d+)?)\s*(?:m☉|msun|solar masses?)/i);
  if (explicitPow) {
    return 10 ** Number(explicitPow[1]);
  }
  const explicitNumber = s.match(/([\d.]+(?:e[+-]?\d+)?)\s*(?:m☉|msun|solar masses?)/i);
  if (explicitNumber) {
    return Number(explicitNumber[1]);
  }
  return DEFAULT_MASS_NORM_MSUN;
}

/** Sort metal axis by Z ascending; permute flux columns accordingly */
function permuteMetals(asset: SspBc03AssetV1): Omit<LoadedSspAsset, "asset" | "massNormMsun"> {
  const [nAge, nMetal, nLambda] = asset.dims;
  const idx = Array.from({ length: nMetal }, (_, j) => j);
  idx.sort((a, b) => asset.metallicity[a] - asset.metallicity[b]);
  const metallicitySorted = new Float64Array(nMetal);
  for (let j = 0; j < nMetal; j += 1) {
    metallicitySorted[j] = asset.metallicity[idx[j]];
  }
  const flux = new Float64Array(nAge * nMetal * nLambda);
  const src = asset.fluxLinear;
  for (let ia = 0; ia < nAge; ia += 1) {
    for (let jNew = 0; jNew < nMetal; jNew += 1) {
      const jOld = idx[jNew];
      const base = (ia * nMetal + jNew) * nLambda;
      const baseOld = (ia * nMetal + jOld) * nLambda;
      for (let il = 0; il < nLambda; il += 1) {
        flux[base + il] = src[baseOld + il];
      }
    }
  }
  const logAge = new Float64Array(nAge);
  for (let i = 0; i < nAge; i += 1) {
    logAge[i] = Math.log10(Math.max(asset.ageYr[i], 1));
  }
  const lambda = Float64Array.from(asset.lambdaAngstrom);
  return {
    lambda,
    logAge,
    metallicitySorted,
    metalPerm: idx,
    flux,
    nAge,
    nMetal,
    nLambda
  };
}

export function loadSspAsset(url: string): Promise<LoadedSspAsset> {
  return fetch(url)
    .then((r) => {
      if (!r.ok) {
        throw new Error(`Failed to load SSP asset: ${r.status} ${r.statusText}`);
      }
      return r.json();
    })
    .then((raw) => {
      const asset = parseAsset(raw);
      const p = permuteMetals(asset);
      return { asset, massNormMsun: parseMassNormMsun(asset.unitsLinearLuminosity), ...p };
    });
}

/** Default URL under Vite public/ */
export function defaultSspAssetUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}ssp/bc03_subset.json`;
}

export function loadSspAssetCached(url = defaultSspAssetUrl()): Promise<LoadedSspAsset> {
  if (!cached) {
    cached = loadSspAsset(url);
  }
  return cached;
}

export function clearSspAssetCache(): void {
  cached = null;
}
