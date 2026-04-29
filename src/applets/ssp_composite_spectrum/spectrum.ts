import type { LoadedSspAsset } from "./loadSspAsset";
import { interpolateTemplateSpectrum } from "./interp";
import type { SspComponent, SspSpectrumResult } from "./types";

/**
 * Linear luminosity density per component and total (galaxy = sum).
 * Each template is erg/s/Å per one SSP of `data.massNormMsun`; multiply by
 * massMsun / massNormMsun.
 */
export function computeSpectra(data: LoadedSspAsset, components: SspComponent[]): SspSpectrumResult {
  const nLam = data.nLambda;
  const lambdaAngstrom = data.lambda;
  const perComponent: Float64Array[] = [];
  const total = new Float64Array(nLam);

  for (const c of components) {
    const template = interpolateTemplateSpectrum(data, c.ageYr, c.metallicityZ);
    const scale = c.massMsun / data.massNormMsun;
    const scaled = new Float64Array(nLam);
    for (let i = 0; i < nLam; i += 1) {
      scaled[i] = template[i] * scale;
      total[i] += scaled[i];
    }
    perComponent.push(scaled);
  }

  return { lambdaAngstrom, perComponent, total };
}
