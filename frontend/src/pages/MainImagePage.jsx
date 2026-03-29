import React, { useState, useRef } from "react";
import { Upload, Trash2, Download, ImageIcon, FolderOpen } from "lucide-react";

const STORAGE_KEY = "main_image_library";

function loadImages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveImages(imgs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(imgs));
}

export default function MainImagePage() {
  const [images, setImages] = useState(() => loadImages());
  const [selected, setSelected] = useState(null); // id of selected image
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const addFiles = (files) => {
    const newImgs = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = {
          id: Date.now() + Math.random(),
          name: file.name,
          src: e.target.result,
          size: file.size,
          addedAt: new Date().toISOString(),
        };
        setImages((prev) => {
          const updated = [img, ...prev];
          saveImages(updated);
          return updated;
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileInput = (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    setImages((prev) => {
      const updated = prev.filter((img) => img.id !== id);
      saveImages(updated);
      return updated;
    });
    if (selected === id) setSelected(null);
  };

  const handleDownload = (img, e) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = img.src;
    a.download = img.name;
    a.click();
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const selectedImg = images.find((i) => i.id === selected);

  return (
    <div className="flex h-full">
      {/* Left panel - image grid */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <ImageIcon size={20} className="text-violet-500" />
            Main Image Library
          </h2>
          <span className="ml-auto text-sm text-gray-400">{images.length} ảnh</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Upload size={15} />
            Thêm ảnh
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* Drop zone + grid */}
        <div
          className="flex-1 overflow-auto p-6"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {images.length === 0 ? (
            <div
              className={`flex flex-col items-center justify-center h-full border-2 border-dashed rounded-2xl transition-colors ${
                dragOver ? "border-violet-400 bg-violet-50" : "border-gray-300 bg-gray-50"
              }`}
            >
              <FolderOpen size={48} className="text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">Kéo thả ảnh vào đây</p>
              <p className="text-gray-400 text-sm mt-1">hoặc click "Thêm ảnh" để chọn file</p>
            </div>
          ) : (
            <div
              className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 ${
                dragOver ? "opacity-60" : ""
              }`}
            >
              {images.map((img) => (
                <div
                  key={img.id}
                  onClick={() => setSelected(img.id === selected ? null : img.id)}
                  className={`group relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${
                    selected === img.id
                      ? "border-violet-500 shadow-lg shadow-violet-200"
                      : "border-transparent hover:border-gray-300"
                  }`}
                >
                  <img
                    src={img.src}
                    alt={img.name}
                    className="w-full aspect-square object-cover"
                  />
                  {/* Overlay actions */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-end justify-end p-2 gap-1.5 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => handleDownload(img, e)}
                      className="p-1.5 bg-white/90 hover:bg-white rounded-lg text-gray-700"
                      title="Tải xuống"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(img.id, e)}
                      className="p-1.5 bg-white/90 hover:bg-red-100 rounded-lg text-red-500"
                      title="Xóa"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {/* Name */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-white text-xs truncate">{img.name}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - detail */}
      {selectedImg && (
        <div className="w-[280px] shrink-0 border-l border-gray-200 flex flex-col bg-gray-50">
          <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
            <span className="font-semibold text-gray-700 text-sm">Chi tiết</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
            <img
              src={selectedImg.src}
              alt={selectedImg.name}
              className="w-full rounded-xl object-contain max-h-56 bg-white border border-gray-200"
            />
            <div className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-gray-400 text-xs uppercase tracking-wide">Tên file</span>
                <p className="text-gray-800 font-medium break-all mt-0.5">{selectedImg.name}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase tracking-wide">Kích thước</span>
                <p className="text-gray-800 mt-0.5">{formatSize(selectedImg.size)}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase tracking-wide">Ngày thêm</span>
                <p className="text-gray-800 mt-0.5">{formatDate(selectedImg.addedAt)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-auto">
              <button
                type="button"
                onClick={(e) => handleDownload(selectedImg, e)}
                className="flex items-center justify-center gap-2 w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Download size={14} />
                Tải xuống
              </button>
              <button
                type="button"
                onClick={(e) => handleDelete(selectedImg.id, e)}
                className="flex items-center justify-center gap-2 w-full py-2 bg-white hover:bg-red-50 border border-red-200 text-red-500 text-sm font-medium rounded-lg transition-colors"
              >
                <Trash2 size={14} />
                Xóa ảnh
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
