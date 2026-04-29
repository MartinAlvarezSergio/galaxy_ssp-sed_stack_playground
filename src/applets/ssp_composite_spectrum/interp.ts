import type { LoadedSspAsset } from "./loadSspAsset";

function fluxAt(
  data: LoadedSspAsset,
  iAge: number,
  iMetal: number,
  iLambda: number
): number {
  const { nMetal, nLambda, flux } = data;
  return flux[iAge * (nMetal * nLambda) + iMetal * nLambda + iLambda];
}

/** Bracket x in ascending arr; returns [i0, i1] with i1 = i0 or i0+1 */
function bracketAscending(arr: Float64Array, x: number): [number, number] {
  const n = arr.length;
  if (n === 1) {
    return [0, 0];
  }
  if (x <= arr[0]) {
    return [0, 1];
  }
  if (x >= arr[n - 1]) {
    return [n - 2, n - 1];
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] <= x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lo, hi];
}

/**
 * Bilinear interpolation in (log10 age, Z) on the asset grid; returns L_λ(λ_k)
 * for each wavelength (linear L, rectilinear grid in log-age × Z).
 */
export function interpolateTemplateSpectrum(data: LoadedSspAsset, ageYr: number, metallicityZ: number): Float64Array {
  const { nLambda, logAge, metallicitySorted } = data;
  const la = Math.log10(Math.max(ageYr, 1));
  const [ia0, ia1] = bracketAscending(logAge, la);
  const z = Math.max(metallicitySorted[0], Math.min(metallicitySorted[metallicitySorted.length - 1], metallicityZ));
  const [iz0, iz1] = bracketAscending(metallicitySorted, z);

  const la0 = logAge[ia0];
  const la1 = logAge[ia1];
  const z0 = metallicitySorted[iz0];
  const z1 = metallicitySorted[iz1];

  const denomA = la1 - la0;
  const denomZ = z1 - z0;
  const ua = denomA > 1e-30 ? (la - la0) / denomA : 0;
  const vz = denomZ > 1e-30 ? (z - z0) / denomZ : 0;
  const u = Math.min(1, Math.max(0, ua));
  const v = Math.min(1, Math.max(0, vz));

  const out = new Float64Array(nLambda);
  for (let il = 0; il < nLambda; il += 1) {
    const f00 = fluxAt(data, ia0, iz0, il);
    const f10 = fluxAt(data, ia1, iz0, il);
    const f01 = fluxAt(data, ia0, iz1, il);
    const f11 = fluxAt(data, ia1, iz1, il);
    out[il] = (1 - u) * (1 - v) * f00 + u * (1 - v) * f10 + (1 - u) * v * f01 + u * v * f11;
  }
  return out;
}
