import { ImageResponse } from "next/og";

// A real PNG instead of an SVG favicon — Safari's SVG-favicon support has
// historically been inconsistent (sometimes rendering nothing at all), while
// PNG is universally supported by every browser and OS.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 8,
          color: "#ffffff",
          fontSize: 22,
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
