import type { LoadedSspAsset } from "./loadSspAsset";

export type SspPresetComponent = {
  massMsun: number;
  ageYr: number;
  metallicityZ: number;
};

export type SspPresetId =
  | "quenched_dwarf"
  | "dwarf_galaxy"
  | "outshining_dwarf"
  | "spiral_galaxy"
  | "starburst_spiral"
  | "elliptical_galaxy";

export type SspPreset = {
  id: SspPresetId;
  label: string;
  tip: string;
  components: SspPresetComponent[];
};

/**
 * Schematic SFH presets in M☉ formed per SSP component, with target (age, Z).
 * Components are snapped to the loaded asset's nearest tabulated grid point,
 * so target values do not need to match the grid exactly. All toy partitions;
 * not fitted to any specific galaxy.
 *
 * MILES grid (current default):
 *   ages (yr): [3e7, 1.5e8, 6e8, 3e9, 1.4e10]
 *   metallicities Z: [1.07e-4, 6.47e-4, 2.19e-3, 1.12e-2, 5.02e-2]
 *   λ range: 3540–7410 Å (optical only)
 */
export const SSP_PRESETS: readonly SspPreset[] = [
  {
    id: "quenched_dwarf",
    label: "Quenched dwarf",
    tip: "1e7 M☉ dwarf, all old metal-poor stars (no recent SF).",
    components: [
      { massMsun: 1.0e7, ageYr: 1.0e10, metallicityZ: 1e-4 }
    ]
  },
  {
    id: "dwarf_galaxy",
    label: "Dwarf galaxy",
    tip: "1e7 M☉ dwarf with extended SFH: dominant old + intermediate + small young burst.",
    components: [
      { massMsun: 7.0e6, ageYr: 6.0e9, metallicityZ: 1e-3 },
      { massMsun: 2.5e6, ageYr: 3.0e8, metallicityZ: 1e-3 },
      { massMsun: 5.0e5, ageYr: 1.5e7, metallicityZ: 6e-3 }
    ]
  },
  {
    id: "outshining_dwarf",
    label: "Outshining dwarf",
    tip: "1e7 M☉ dwarf with a young burst that outshines the old population in UV/blue.",
    components: [
      { massMsun: 7.0e6, ageYr: 6.0e9, metallicityZ: 1e-3 },
      { massMsun: 2.0e6, ageYr: 3.0e8, metallicityZ: 6e-3 },
      { massMsun: 1.0e6, ageYr: 1.0e6, metallicityZ: 6e-3 }
    ]
  },
  {
    id: "spiral_galaxy",
    label: "Spiral galaxy (MW-like)",
    tip: "~6e10 M☉ stellar mass, continuous SFH from old thick disk to ongoing SF.",
    components: [
      { massMsun: 3.0e10, ageYr: 6.0e9, metallicityZ: 6e-3 },
      { massMsun: 2.0e10, ageYr: 3.0e8, metallicityZ: 6e-3 },
      { massMsun: 5.0e9, ageYr: 1.5e7, metallicityZ: 4e-2 },
      { massMsun: 1.0e9, ageYr: 1.0e6, metallicityZ: 4e-2 }
    ]
  },
  {
    id: "starburst_spiral",
    label: "Starburst spiral",
    tip: "MW-mass spiral with a strong recent burst; UV-bright young populations.",
    components: [
      { massMsun: 4.0e10, ageYr: 6.0e9, metallicityZ: 6e-3 },
      { massMsun: 1.5e10, ageYr: 3.0e8, metallicityZ: 6e-3 },
      { massMsun: 1.0e10, ageYr: 1.5e7, metallicityZ: 4e-2 },
      { massMsun: 5.0e9, ageYr: 1.0e6, metallicityZ: 4e-2 }
    ]
  },
  {
    id: "elliptical_galaxy",
    label: "Elliptical (quenched)",
    tip: "~3e11 M☉ massive quenched galaxy, dominated by old metal-rich stars.",
    components: [
      { massMsun: 2.5e11, ageYr: 1.0e10, metallicityZ: 4e-2 },
      { massMsun: 5.0e10, ageYr: 6.0e9, metallicityZ: 4e-2 }
    ]
  }
];

/** Index in `arr` (ascending) closest to `target` in absolute value. */
export function nearestIndex(arr: ArrayLike<number>, target: number): number {
  let bestIdx = 0;
  let bestErr = Infinity;
  for (let i = 0; i < arr.length; i += 1) {
    const err = Math.abs(arr[i] - target);
    if (err < bestErr) {
      bestErr = err;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Index in `arr` (positive ascending) closest to `target` in log space. */
export function nearestIndexLog(arr: ArrayLike<number>, target: number): number {
  const logT = Math.log10(Math.max(target, 1));
  let bestIdx = 0;
  let bestErr = Infinity;
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i];
    if (!(v > 0)) {
      continue;
    }
    const err = Math.abs(Math.log10(v) - logT);
    if (err < bestErr) {
      bestErr = err;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export type ResolvedPresetComponent = {
  massMsun: number;
  ageIdx: number;
  metalIdx: number;
};

/** Snap each component (age in yr, Z) to nearest tabulated grid index in the loaded asset. */
export function resolvePreset(asset: LoadedSspAsset, preset: SspPreset): ResolvedPresetComponent[] {
  return preset.components.map((c) => ({
    massMsun: c.massMsun,
    ageIdx: nearestIndexLog(asset.asset.ageYr, c.ageYr),
    metalIdx: nearestIndex(asset.metallicitySorted, c.metallicityZ)
  }));
}
