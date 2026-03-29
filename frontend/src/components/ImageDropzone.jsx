import React, { useEffect, useRef } from "react";

/**
 * Reusable image dropzone with click, drag-and-drop, and paste (Ctrl+V) support.
 * Props:
 *   file        – current File object (or null)
 *   preview     – object URL for preview (or null)
 *   onChange    – (file: File) => void
 *   className   – extra classes for the outer div
 *   style       – extra styles for the outer div
 */
export default function ImageDropzone({ file, preview, onChange, className = "", style = {} }) {
  const fileInputRef = useRef(null);

  const applyFile = (f) => {
    if (!f || !f.type.startsWith("image/")) return;
    onChange(f);
  };

  // Global paste listener
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) { applyFile(f); break; }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      onDrop={(e) => { e.preventDefault(); applyFile(e.dataTransfer.files?.[0]); }}
      onDragOver={(e) => e.preventDefault()}
      className={`relative rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer overflow-hidden ${className}`}
      style={style}
    >
      {preview ? (
        <img src={preview} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-400 p-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-xs text-center leading-snug">Chọn, kéo thả, hoặc dán ảnh (Ctrl+V)</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => applyFile(e.target.files?.[0])}
        style={{ cursor: "pointer", height: "100%", opacity: 0, position: "absolute", width: "100%", left: 0, top: 0, fontSize: 0 }}
      />
    </div>
  );
}
