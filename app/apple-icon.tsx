import { ImageResponse } from "next/og";

// iOS applies its own rounded-corner mask over "Add to Home Screen" icons,
// so this stays a plain full-bleed square rather than rounding it here too.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3f5c46",
          color: "#ffffff",
          fontSize: 110,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        K
      </div>
    ),
    { ...size }
  );
}
