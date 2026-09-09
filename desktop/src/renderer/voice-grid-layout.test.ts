import { describe, expect, it } from "vitest";
import { voiceGridLayout } from "./voice-grid-layout";

describe("Voice Room grid sizing", () => {
  it.each([
    [3, 2, 454], [4, 2, 454], [5, 2, 348.444444],
    [6, 2, 348.444444], [7, 3, 298.666667],
  ])("matches the approved %i-participant design", (count, columns, width) => {
    const layout = voiceGridLayout(count, 920, 612);
    expect(layout.columns).toBe(columns);
    expect(layout.width).toBeCloseTo(width, 5);
    expect(layout.width / layout.height).toBeCloseTo(16 / 9);
  });

  it("changes column count as the available space changes", () => {
    expect(voiceGridLayout(6, 1600, 400).columns).toBe(3);
    expect(voiceGridLayout(6, 400, 1600).columns).toBe(1);
  });

  it("handles empty rooms and unmeasured containers", () => {
    expect(voiceGridLayout(0, 920, 612).width).toBe(0);
    expect(voiceGridLayout(7, 0, 0).width).toBe(0);
  });
});
