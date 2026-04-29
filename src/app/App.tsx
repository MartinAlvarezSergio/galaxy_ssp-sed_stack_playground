import { useMemo } from "react";
import { AppletHostAdapter } from "../core/host";
import { SspCompositeSpectrumCanvas } from "../applets/ssp_composite_spectrum/SspCompositeSpectrumCanvas";

export function App(): JSX.Element {
  const host: AppletHostAdapter = useMemo(
    () => ({
      onClose: () => {},
      readReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }),
    []
  );

  return (
    <div className="app-shell">
      <main>
        <section className="modal card">
          <SspCompositeSpectrumCanvas host={host} />
        </section>
      </main>
    </div>
  );
}
