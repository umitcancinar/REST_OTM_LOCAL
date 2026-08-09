import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
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
          background: "#171310",
          borderRadius: 16,
          border: "2px solid #E5714B",
          color: "#fffaf3",
          fontFamily: "Georgia, serif",
          fontSize: 38,
          fontWeight: 700,
        }}
      >
        R
      </div>
    ),
    { ...size },
  );
}
