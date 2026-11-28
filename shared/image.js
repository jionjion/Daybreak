export const DATA_IMAGE_RE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

export function isDataImage(value) {
  return typeof value === "string" && DATA_IMAGE_RE.test(value);
}

export async function encodeImageBlob(
  blob,
  { maxSize = 1920, quality = 0.84, background = "#ebe5d8", thumbSize = 0, thumbQuality = 0.67 } = {}
) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();

    function scaled(limit, targetQuality) {
      const ratio = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", targetQuality);
    }

    return {
      data: scaled(maxSize, quality),
      thumb: thumbSize > 0 ? scaled(thumbSize, thumbQuality) : undefined,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
