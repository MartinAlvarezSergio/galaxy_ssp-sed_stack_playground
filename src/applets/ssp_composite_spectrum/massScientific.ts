/** Decompose M☉ into mantissa × 10^exponent with mantissa ∈ [1, 10). */
export function splitMassMsun(massMsun: number): { mantissa: number; exp10: number } {
  if (!Number.isFinite(massMsun) || massMsun <= 0) {
    return { mantissa: 1, exp10: 6 };
  }
  const exp10 = Math.floor(Math.log10(massMsun));
  const mantissa = massMsun / 10 ** exp10;
  return { mantissa, exp10 };
}

/** Combine; normalizes mantissa into [1, 10) when possible. */
export function combineMassMsun(mantissa: number, exp10: number): number {
  const { mantissa: m, exp10: e } = normalizeMassScientific(mantissa, exp10);
  if (m === 0) {
    return 0;
  }
  return m * 10 ** e;
}

export function normalizeMassScientific(mantissa: number, exp10: number): { mantissa: number; exp10: number } {
  let m = mantissa;
  let e = Math.round(exp10);
  if (!Number.isFinite(m) || !Number.isFinite(e)) {
    return { mantissa: 1, exp10: 8 };
  }
  if (m === 0) {
    return { mantissa: 0, exp10: 0 };
  }
  while (m >= 10) {
    m /= 10;
    e += 1;
  }
  while (m > 0 && m < 1) {
    m *= 10;
    e -= 1;
  }
  return { mantissa: m, exp10: e };
}
