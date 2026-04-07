/**
 * ManualUploadModal — cho phép người dùng upload ảnh thủ công.
 * Trả về list item có dạng { source: "manual", image_url: base64, title }.
 *
 * Props:
 *   open       – boolean, hiển thị modal hay không
 *   onClose    – () => void
 *   onConfirm  – (items: Array<{source, image_url, title}>) => void
 *   multiple   – boolean, cho phép upload nhiều ảnh (default: false)
 */
import { useState, useRef } from "react";
import { X, Upload, Trash2 } from "lucide-react";
import ImageDropzone from "./ImageDropzone";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ManualUploadModal({ open, onClose, onConfirm, multiple = false }) {
  const [entries, setEntries] = useState([]); // [{file, preview, title}]
  const dropzoneKey = useRef(0);

  if (!open) return null;

  const handleFileChange = (file) => {
    const preview = URL.createObjectURL(file);
    if (!multiple) {
      setEntries(prev => {
        prev.forEach(e => URL.revokeObjectURL(e.preview));
        return [{ file, preview, title: file.name.replace(/\.[^.]+$/, "") }];
      });
    } else {
      setEntries(prev => [...prev, { file, preview, title: file.name.replace(/\.[^.]+$/, "") }]);
    }
  };

  const removeEntry = (idx) => {
    setEntries(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const updateTitle = (idx, title) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, title } : e));
  };

  const handleConfirm = async () => {
    if (entries.length === 0) return;
    const items = await Promise.all(
      entries.map(async (e) => ({
        source: "manual",
        image_url: await fileToBase64(e.file),
        title: e.title || e.file.name,
      }))
    );
    onConfirm(items);
    setEntries([]);
    onClose();
  };

  const handleClose = () => {
    entries.forEach(e => URL.revokeObjectURL(e.preview));
    setEntries([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">📷 Upload ảnh thủ công</h2>
          <button type="button" onClick={handleClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {/* Dropzone */}
          {(multiple || entries.length === 0) && (
            <ImageDropzone
              key={dropzoneKey.current}
              file={null}
              preview={null}
              onChange={handleFileChange}
              className="h-36"
            />
          )}

          {/* Preview list */}
          {entries.length > 0 && (
            <div className="flex flex-col gap-2">
              {entries.map((e, idx) => (
                <div key={idx} className="flex items-center gap-3 p-2 rounded-xl border border-gray-200 bg-gray-50">
                  <img src={e.preview} alt="" className="w-14 h-14 object-cover rounded-lg shrink-0 border border-gray-200" />
                  <input
                    type="text"
                    value={e.title}
                    onChange={(ev) => updateTitle(idx, ev.target.value)}
                    placeholder="Tên ảnh (tuỳ chọn)..."
                    className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded-lg focus:outline-none focus:border-violet-400"
                  />
                  <button type="button" onClick={() => removeEntry(idx)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {entries.length === 0 && (
            <p className="text-xs text-gray-400 text-center">
              Chọn, kéo thả hoặc dán (Ctrl+V) để upload ảnh.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button type="button" onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl font-medium transition-colors">
            Huỷ
          </button>
          <button type="button" onClick={handleConfirm} disabled={entries.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Upload size={14} />
            Xác nhận ({entries.length} ảnh)
          </button>
        </div>
      </div>
    </div>
  );
}
