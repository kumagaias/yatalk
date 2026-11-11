import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const alt = "Sample TRES street menu with five English food items and prices";

export function SampleMenuPreview() {
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return <>
    <button className="sample-menu-preview-trigger" type="button" onClick={() => setOpen(true)} aria-label="Enlarge sample menu photo">
      <img src="/menu-ocr-sample.webp" alt={alt} />
    </button>
    {open && <div className="sample-menu-lightbox" role="dialog" aria-modal="true" aria-label="Sample menu photo">
      <button className="sample-menu-lightbox-backdrop" type="button" aria-label="Close sample menu preview" onClick={() => setOpen(false)} />
      <figure className="sample-menu-lightbox-content">
        <button ref={closeButton} className="sample-menu-lightbox-close" type="button" onClick={() => setOpen(false)}>
          <X size={20} aria-hidden="true" /> Close
        </button>
        <img src="/menu-ocr-sample.webp" alt={alt} />
      </figure>
    </div>}
  </>;
}
