const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "dmfoddfz3";
const BASE_URL = `https://res.cloudinary.com/${CLOUD_NAME}`;

export function videoUrl(publicId: string, format: "mp4" | "webm" = "mp4"): string {
  return `${BASE_URL}/video/upload/q_auto/${publicId}.${format}`;
}

export function videoPosterUrl(
  publicId: string,
  opts?: { width?: number; height?: number },
): string {
  const w = opts?.width || 1600;
  const h = opts?.height || 900;
  return `${BASE_URL}/video/upload/w_${w},h_${h},c_fill,q_auto,f_jpg/${publicId}.jpg`;
}
