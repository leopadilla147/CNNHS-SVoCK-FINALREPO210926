import { useSyncExternalStore } from "react";

/**
 * Session-only store for the photos attached to the Chief Commissioner
 * Election Report.
 *
 * Per the Chief's request these photos are NOT persisted (no Supabase Storage
 * bucket and no table): they live in this module for the current browser
 * session so the Election Reports page and the Chief dashboard can share the
 * same list. Reloading the page clears them.
 */
export interface ReportImage {
  id: string;
  /** Original file name, used as the default alt/caption fallback. */
  name: string;
  caption: string;
  /** `data:` URL consumed by the printable HTML report. */
  dataUrl: string;
  /** Original bytes, kept for the .docx export (Word needs bytes, not a URL). */
  blob: Blob;
}

let images: ReportImage[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getReportImages(): ReportImage[] {
  return images;
}

export function addReportImages(next: ReportImage[]): void {
  if (next.length === 0) return;
  images = [...images, ...next];
  emit();
}

export function removeReportImage(id: string): void {
  images = images.filter((image) => image.id !== id);
  emit();
}

export function setReportImageCaption(id: string, caption: string): void {
  images = images.map((image) => (image.id === id ? { ...image, caption } : image));
  emit();
}

export function clearReportImages(): void {
  if (images.length === 0) return;
  images = [];
  emit();
}

/** Read a picked file into a session image entry. */
export function fileToReportImage(file: File): Promise<ReportImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        caption: "",
        dataUrl: String(reader.result ?? ""),
        blob: file,
      });
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

/** React binding for the session image list. */
export function useReportImages(): ReportImage[] {
  return useSyncExternalStore(subscribe, getReportImages, getReportImages);
}
