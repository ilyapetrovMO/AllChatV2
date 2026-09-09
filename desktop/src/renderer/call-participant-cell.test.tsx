import { describe, expect, it } from "vitest";
import { dominantAvatarColor, avatarLabelColor } from "./call-participant-cell";

describe("participant avatar palette", () => {
  it("uses the dominant group of nearby colors instead of averaging the whole photo", () => {
    expect(dominantAvatarColor([32, 120, 112, 255, 36, 124, 116, 255, 240, 32, 32, 255]))
      .toEqual([34, 122, 114]);
  });
  it("ignores transparent pixels and allows entirely transparent avatars to fall back", () => {
    expect(dominantAvatarColor([255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255])).toEqual([0, 0, 0]);
    expect(dominantAvatarColor([255, 0, 0, 0])).toBeNull();
  });
  it("chooses readable labels for light and dark avatars", () => {
    expect(avatarLabelColor([250, 240, 220])).toBe("#000000");
    expect(avatarLabelColor([35, 124, 115])).toBe("#ffffff");
  });
});
