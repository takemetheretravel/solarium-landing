export function driveImageUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

export function driveThumbnailUrl(fileId: string, width = 1600): string {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${width}`;
}
