import { useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
import type { ComplaintEvidence } from "../context/AppContext";
import { isImageEvidence } from "../lib/complaints";

/**
 * 096: full-screen zoom for an evidence image.  Closes on backdrop click,
 * the X button, or Escape.
 */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${alt}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/**
 * 096: a small thumbnail for a picked (not-yet-uploaded) evidence file.
 * Images get a local object-URL preview that opens a zoom lightbox on click;
 * anything else falls back to a paperclip glyph.  The object URL is revoked
 * when the file changes or the chip unmounts, so nothing leaks.
 */
export function EvidenceFileThumb({ file, size = 40 }: { file: File; size?: number }) {
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!isImageEvidence(file.name) || typeof URL.createObjectURL !== "function") {
      setUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) {
    return (
      <span
        className="flex items-center justify-center rounded bg-gray-100 text-gray-400 shrink-0"
        style={{ width: size, height: size }}
      >
        <Paperclip size={14} />
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setZoom(true)}
        title={`Zoom ${file.name}`}
        aria-label={`Zoom ${file.name}`}
        className="shrink-0 cursor-zoom-in"
      >
        <img
          src={url}
          alt={file.name}
          className="rounded object-cover border border-gray-200 bg-white hover:opacity-80"
          style={{ width: size, height: size }}
        />
      </button>
      {zoom && <ImageLightbox src={url} alt={file.name} onClose={() => setZoom(false)} />}
    </>
  );
}

/**
 * 096: one uploaded evidence attachment.  Images render as a clickable
 * thumbnail that opens a zoom lightbox; every attachment also exposes the
 * original file name as a link that opens the file in a new tab.
 */
export function EvidenceAttachment({
  item,
  linkClassName = "text-xs text-[#5C0102] underline",
}: {
  item: ComplaintEvidence;
  linkClassName?: string;
}) {
  const [zoom, setZoom] = useState(false);
  const isImage = isImageEvidence(item.name);

  return (
    <span className="flex items-center gap-2">
      {isImage && (
        <>
          <button
            type="button"
            onClick={() => setZoom(true)}
            title={`Zoom ${item.name}`}
            aria-label={`Zoom ${item.name}`}
            className="shrink-0 cursor-zoom-in"
          >
            <img
              src={item.url}
              alt={item.name}
              className="w-10 h-10 rounded object-cover border border-gray-200 bg-white hover:opacity-80"
            />
          </button>
          {zoom && <ImageLightbox src={item.url} alt={item.name} onClose={() => setZoom(false)} />}
        </>
      )}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 ${linkClassName}`}
      >
        <Paperclip size={11} /> {item.name}
      </a>
    </span>
  );
}
