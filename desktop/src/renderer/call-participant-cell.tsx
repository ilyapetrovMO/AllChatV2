import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import type { InstanceAction, InstanceActionResult } from "../shared/instance-actions";

/** Quantize nearby colors, then average the largest bucket rather than blending the entire photo. */
export function dominantAvatarColor(pixels: ArrayLike<number>): [number, number, number] | null {
  const buckets = new Map<number, { count: number; sum: number[] }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const key = (pixels[i] >> 5) * 64 + (pixels[i + 1] >> 5) * 8 + (pixels[i + 2] >> 5);
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bucket.count++;
    for (let c = 0; c < 3; c++) bucket.sum[c] += pixels[i + c];
    buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  return winner ? winner.sum.map((value) => Math.round(value / winner.count)) as [number, number, number] : null;
}

export function avatarLabelColor(rgb: readonly number[]): string {
  const linear = rgb.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return (luminance + .05) / .05 > 1.05 / (luminance + .05) ? "#000000" : "#ffffff";
}

type Props = ComponentProps<"article"> & {
  avatarPath?: string;
  name: string;
  onAction(action: InstanceAction): Promise<InstanceActionResult | undefined>;
};

export function CallParticipantCell({ avatarPath, name, onAction, children, className = "", style, ...props }: Props) {
  const [avatar, setAvatar] = useState<{ path: string; source: string } | null>(null);
  const [palette, setPalette] = useState<{ source: string; rgb: [number, number, number] } | null>(null);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  useEffect(() => {
    setAvatar(null);
    setPalette(null);
    if (!avatarPath) return;
    let current = true;
    let source: string | undefined;
    void actionRef.current({ type: "load_asset", path: avatarPath }).then((result) => {
      if (!current || result?.type !== "asset") return;
      source = URL.createObjectURL(new Blob([result.data as BlobPart], { type: result.contentType }));
      setAvatar({ path: avatarPath, source });
    }).catch(() => { /* Keep the initial avatar when the asset is unavailable. */ });
    return () => { current = false; if (source) URL.revokeObjectURL(source); };
  }, [avatarPath]);
  const source = avatar?.path === avatarPath ? avatar?.source : undefined;
  const rgb = source && palette?.source === source ? palette.rgb : null;
  return <article {...props} className={`media-stage-tile participant-tile ${className}`} style={{
    ...style,
    "--participant-color": rgb ? `rgb(${rgb.join(", ")})` : "var(--brand)",
    "--participant-label": rgb ? avatarLabelColor(rgb) : "#ffffff",
  } as CSSProperties}>
    <div className="media-stage-visual">
      {source ? <img src={source} alt="" className="media-stage-avatar" onError={() => setAvatar(null)} onLoad={(event) => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 32;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          const image = event.currentTarget;
          const side = Math.min(image.naturalWidth, image.naturalHeight);
          context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 32, 32);
          const color = dominantAvatarColor(context.getImageData(0, 0, 32, 32).data);
          if (color) setPalette({ source, rgb: color });
        } catch { /* Canvas decoding failures retain the fallback color. */ }
      }} /> : <span className="media-stage-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
    </div>
    {children}
  </article>;
}
