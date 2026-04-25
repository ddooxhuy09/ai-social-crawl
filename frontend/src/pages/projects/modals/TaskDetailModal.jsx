import React, { useState, useEffect, useRef } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { PAGE_OPTIONS } from "../constants";

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function TaskDetailModal({
  open,
  onClose,
  task,
  onSaveNote,
  onSaveDates,
  onSaveLink,
  onRemoveLink,
  onDelete,
}) {
  const [noteDraft, setNoteDraft]   = useState("");
  const [dateDraft, setDateDraft]   = useState({ start_date: "", deadline: "" });
  const [linkDraft, setLinkDraft]   = useState({ page: "crawl", keyword: "", imageData: "", imageName: "" });
  const [imageLoading, setImageLoading] = useState(false);
  const imageInputRef = useRef(null);

  useEffect(() => {
    if (open && task) {
      setNoteDraft(task.notes || "");
      setDateDraft({ start_date: task.start_date || "", deadline: task.deadline || "" });
      setLinkDraft({
        page:      task.linked_page      || "crawl",
        keyword:   task.linked_keyword   || "",
        imageData: task.linked_image_data  || "",
        imageName: task.linked_image_name  || "",
      });
    }
  }, [open, task]);

  if (!open || !task) return null;

  const selectedPageOpt = PAGE_OPTIONS.find(p => p.value === linkDraft.page);

  const handleImageFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 4 * 1024 * 1024) { alert("Image too large (max 4 MB)."); return; }
    setImageLoading(true);
    try {
      const data = await readFileAsBase64(file);
      setLinkDraft(prev => ({ ...prev, imageData: data, imageName: file.name }));
    } finally {
      setImageLoading(false);
    }
  };

  const handleSaveAll = () => {
    if (noteDraft !== (task.notes || "")) {
      onSaveNote(task.id, noteDraft);
    }
    if (dateDraft.start_date !== (task.start_date || "") || dateDraft.deadline !== (task.deadline || "")) {
      onSaveDates(task.id, dateDraft.start_date, dateDraft.deadline);
    }
    const linkChanged =
      linkDraft.page      !== (task.linked_page       || "crawl") ||
      linkDraft.keyword   !== (task.linked_keyword    || "")       ||
      linkDraft.imageData !== (task.linked_image_data || "")       ||
      linkDraft.imageName !== (task.linked_image_name || "");
    if (linkChanged) {
      onSaveLink(task.id, linkDraft.page, linkDraft.keyword, linkDraft.imageData, linkDraft.imageName);
    }
    onClose();
  };

  const handleRemoveLinkClick = () => {
    onRemoveLink(task.id);
    setLinkDraft({ page: "crawl", keyword: "", imageData: "", imageName: "" });
  };

  const handleDelete = () => {
    if (window.confirm("Bạn có chắc muốn xóa thẻ này?")) { onDelete(task.id); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col relative">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${task.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
              {task.status === "done" ? "Hoàn thành" : "Đang thực hiện"}
            </span>
            <span className="text-gray-400 text-sm font-medium">Chi tiết công việc</span>
          </div>
          <Button variant="ghost" type="button" onClick={onClose}
            className="w-8 h-8 p-0 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 transition-colors">✕</Button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-6 p-6">
          <h2 className={`text-2xl font-bold ${task.status === "done" ? "text-gray-500 line-through" : "text-gray-900"}`}>
            {task.title}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Dates + Notes */}
            <div className="flex flex-col gap-5">
              <div className="bg-violet-50/50 border border-violet-100 rounded-xl p-4">
                <h3 className="text-sm font-bold flex items-center gap-2 text-violet-800 mb-3">
                  <span className="text-lg">📅</span> Lịch trình
                </h3>
                <div className="flex flex-col gap-3">
                  {[["Bắt đầu:", "start_date"], ["Deadline:", "deadline"]].map(([label, key]) => (
                    <div key={key} className="flex items-center gap-3">
                      <label className="text-xs font-semibold text-violet-700 w-16">{label}</label>
                      <input type="date" value={dateDraft[key]}
                        onChange={e => setDateDraft(prev => ({ ...prev, [key]: e.target.value }))}
                        className="flex-1 text-sm border-0 border-b-2 border-violet-200 bg-transparent focus:ring-0 focus:border-violet-500 px-1 py-1" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 flex-1 flex flex-col">
                <h3 className="text-sm font-bold flex items-center gap-2 text-amber-800 mb-2">
                  <span className="text-lg">📝</span> Ghi chú chi tiết
                </h3>
                <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                  placeholder="Thêm mô tả, link tham khảo, thông tin chi tiết..."
                  className="w-full flex-1 min-h-[120px] resize-none bg-white border border-amber-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 text-gray-700 placeholder:text-gray-400" />
              </div>
            </div>

            {/* Right: System link */}
            <div className="flex flex-col gap-5">
              <div className="bg-sky-50/50 border border-sky-100 rounded-xl p-4 flex-1">
                <h3 className="text-sm font-bold flex items-center gap-2 text-sky-800 mb-1">
                  <span className="text-lg">🔗</span> Liên kết Hệ thống
                </h3>
                <p className="text-xs text-sky-600/80 mb-3">Gắn với trang công cụ để chạy tự động hoặc xem kết quả</p>

                <div className="flex flex-col gap-3">
                  {/* Page selector */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-gray-600">Chọn trang công cụ:</label>
                    <select value={linkDraft.page}
                      onChange={e => setLinkDraft(prev => ({ ...prev, page: e.target.value, keyword: "", imageData: "", imageName: "" }))}
                      className="w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/50 text-gray-700 font-medium shadow-sm cursor-pointer">
                      {PAGE_OPTIONS.map(p => (
                        <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Keyword / listing name input */}
                  {selectedPageOpt?.hasKeyword && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-gray-600">
                        {selectedPageOpt.keywordLabel || "Keyword"}:
                      </label>
                      <Input value={linkDraft.keyword}
                        onChange={e => setLinkDraft(prev => ({ ...prev, keyword: e.target.value }))}
                        placeholder={`VD: ${linkDraft.page === "etsy-listing" ? "Baby Headband Pattern" : "bunny lovey crochet..."}`}
                        className="h-9 font-medium" />
                    </div>
                  )}

                  {/* Image upload for crawl-image */}
                  {selectedPageOpt?.hasImage && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold text-gray-600">Ảnh để crawl:</label>
                      {linkDraft.imageData ? (
                        <div className="relative group">
                          <img src={linkDraft.imageData} alt="preview"
                            className="w-full h-32 object-cover rounded-lg border border-sky-200" />
                          <div className="absolute inset-0 bg-black/40 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button variant="outline" type="button"
                              onClick={() => imageInputRef.current?.click()}
                              className="text-xs bg-white text-gray-800 px-3 py-1.5 h-auto rounded-lg font-semibold hover:bg-gray-100">
                              Đổi ảnh
                            </Button>
                            <Button variant="destructive" type="button"
                              onClick={() => setLinkDraft(prev => ({ ...prev, imageData: "", imageName: "" }))}
                              className="text-xs bg-red-500 text-white px-3 py-1.5 h-auto rounded-lg font-semibold hover:bg-red-600">
                              Xóa
                            </Button>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1 truncate">{linkDraft.imageName}</p>
                        </div>
                      ) : (
                        <Button variant="outline" type="button"
                          onClick={() => imageInputRef.current?.click()}
                          disabled={imageLoading}
                          className="w-full h-24 border-2 border-dashed border-sky-200 rounded-lg flex flex-col items-center justify-center gap-1.5 text-sky-400 hover:border-sky-400 hover:bg-sky-50 transition-colors cursor-pointer bg-transparent">
                          <span className="text-2xl">{imageLoading ? "⏳" : "🖼️"}</span>
                          <span className="text-xs font-medium">{imageLoading ? "Loading..." : "Click to upload image"}</span>
                        </Button>
                      )}
                      <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); e.target.value = ""; }} />
                    </div>
                  )}

                  {/* Non-queueable note */}
                  {selectedPageOpt && !selectedPageOpt.queueable && (
                    <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                      ℹ️ Loại này không chạy tự động — dùng nút "Open" trên task card để điều hướng.
                    </p>
                  )}

                  {/* Remove link */}
                  {task.linked_page && (
                    <Button variant="outline" size="sm" onClick={handleRemoveLinkClick}
                      className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 mt-1">
                      Hủy liên kết thẻ này
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/80 rounded-b-2xl">
          <Button variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50 font-medium" onClick={handleDelete}>
            Thùng rác
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="font-semibold text-gray-600">Đóng</Button>
            <Button onClick={handleSaveAll} className="font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-200">
              Lưu thay đổi
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
