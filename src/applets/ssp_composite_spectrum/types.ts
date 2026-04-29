export type SspBc03AssetV1 = {
  version: number;
  model: string;
  unitsLinearLuminosity: string;
  lambdaAngstrom: number[];
  ageYr: number[];
  metallicity: number[];
  dims: [number, number, number];
  /** Row-major: [iAge][iMetal][iLambda] = iAge * (nMetal * nLam) + iMetal * nLam + iLambda */
  fluxLinear: number[];
};

export type SspComponent = {
  /** Stellar mass formed in this burst (M☉); scales L ∝ M / 10^6 at fixed IMF */
  massMsun: number;
  /** SSP age (yr) */
  ageYr: number;
  /** Total metallicity Z (mass fraction) on the model grid range */
  metallicityZ: number;
};

export type SspSpectrumResult = {
  lambdaAngstrom: Float64Array;
  perComponent: Float64Array[];
  total: Float64Array;
};
