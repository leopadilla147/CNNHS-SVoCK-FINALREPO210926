import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Paperclip, X, ZoomIn, ZoomOut } from "lucide-react";
import type { ComplaintEvidence } from "../context/AppContext";
import { isImageEvidence } from "../lib/complaints";

/**
 * 096: full-screen zoom for an evidence image.  Closes on backdrop click,
 * the X button, or Escape.  Escape is consumed here (capture phase +
 * stopPropagation) so a page/modal underneath with its own Escape handler
 * does not close at the same time as the lightbox.
 *
 * The image is zoomable: mouse wheel or the +/− controls scale it (1x–5x),
 * double-click toggles between fit and 2.5x, and while zoomed it can be
 * dragged to pan.  Dropping back to 1x recenters; a new image always opens
 * fit and centered.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // A new image always opens fit and centered.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Keep the pan offset inside what the scaled image actually covers
  // (clientWidth/Height are the unscaled layout sizes, so multiply).
  const clampOffset = (x: number, y: number, atScale: number) => {
    const img = imgRef.current;
    const viewport = viewportRef.current;
    if (!img || !viewport) return { x, y };
    const maxX = Math.max(0, (img.clientWidth * atScale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (img.clientHeight * atScale - viewport.clientHeight) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  };

  // Wheel zoom over the whole viewport.  Non-passive so the page behind the
  // fixed overlay cannot scroll while zooming.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((prev) => Math.min(5, Math.max(1, prev * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  // Re-clamp (and at 1x, recenter) whenever the scale changes.
  useEffect(() => {
    setOffset((prev) => (scale === 1 ? { x: 0, y: 0 } : clampOffset(prev.x, prev.y, scale)));
  }, [scale]);

  const zoomBy = (factor: number) => setScale((prev) => Math.min(5, Math.max(1, prev * factor)));

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return;
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setOffset(clampOffset(drag.baseX + (e.clientX - drag.startX), drag.baseY + (e.clientY - drag.startY), scale));
  };
  const endDrag = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

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

      <div ref={viewportRef} className="flex items-center justify-center overflow-hidden">
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          className={`max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl select-none ${
            scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
          }`}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setScale((prev) => (prev > 1 ? 1 : 2.5));
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>

      {/* Zoom controls — clicking them must not close the lightbox. */}
      <div
        className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-1"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={scale <= 1}
          onClick={() => zoomBy(1 / 1.25)}
          className="p-2 rounded-full text-white hover:bg-white/20 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomOut size={18} />
        </button>
        <button
          type="button"
          title="Reset zoom"
          aria-label="Reset zoom"
          onClick={() => setScale(1)}
          className="min-w-[3.25rem] px-1 py-1 rounded-full text-xs font-medium text-white hover:bg-white/20 transition-colors"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={scale >= 5}
          onClick={() => zoomBy(1.25)}
          className="p-2 rounded-full text-white hover:bg-white/20 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ZoomIn size={18} />
        </button>
      </div>
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
