import React, { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import type { StageSceneProps } from "./StageScene";
import Loader from "../../../components/load/Loader";

// three.js + @react-three/fiber + drei is by far the heaviest dependency in this app. `vite.config.ts`
// keeps it in its own `vendor-three` chunk so no other route downloads it; this `lazy()` keeps it out
// of the Topology route's first paint, so the page's frame, KPIs and any error banner are on screen
// before the renderer arrives.
const StageScene = lazy(() => import("./StageScene"));

/** Cheap synchronous check — cheaper than letting <Canvas> try and throw. */
const hasWebGL = (): boolean => {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

type BoundaryProps = { onUnsupported: () => void; children: ReactNode };

/**
 * Catches anything the scene throws while mounting — a driver that lies about WebGL support, a
 * context-creation failure under GPU pressure, an R3F/React version mismatch — and hands the page
 * back its own error state instead of taking the whole route down. There is no second renderer to
 * fall back to any more, so the honest response is to say the scene could not start, not to show
 * an empty panel.
 */
class StageBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(): void {
    this.props.onUnsupported();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const StageCanvas: React.FC<StageSceneProps & { onUnsupported: () => void }> = (props) => {
  const { onUnsupported } = props;
  // Computed once, synchronously, from a pure browser check — never a cause of the "setState while
  // rendering another component" warning that calling onUnsupported() in the render body would be.
  const [supported] = useState(hasWebGL);
  const told = useRef(false);

  useEffect(() => {
    if (!supported && !told.current) {
      told.current = true;
      onUnsupported();
    }
  }, [supported, onUnsupported]);

  if (!supported) return null;

  return (
    <StageBoundary onUnsupported={onUnsupported}>
      <Suspense fallback={<div className="grid h-full place-items-center"><Loader /></div>}>
        <StageScene {...props} />
      </Suspense>
    </StageBoundary>
  );
};

export default StageCanvas;
