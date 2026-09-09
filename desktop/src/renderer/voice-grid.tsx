import { Children, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { voiceGridLayout } from "./voice-grid-layout";

export function VoiceParticipantGrid({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  const layout = voiceGridLayout(count, size.width, size.height);
  // Round down to a browser layout pixel so a full row cannot wrap from rounding up.
  const cellWidth = Math.floor(layout.width * 64) / 64;
  const style = {
    "--voice-cell-width": `${cellWidth}px`,
    "--voice-cell-height": `${cellWidth * 9 / 16}px`,
  } as CSSProperties;
  return <div ref={ref} className="media-stage-grid voice-participant-grid" style={style} data-tile-count={count}>
    {count === 0 ? children : Children.toArray(children).map(child => (
      <div className="voice-grid-cell" key={(child as { key?: string }).key}>{child}</div>
    ))}
  </div>;
}
