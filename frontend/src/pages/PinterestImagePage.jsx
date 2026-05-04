import React, { useEffect, useMemo, useState } from "react";
import { API_BASE, SORT_OPTIONS } from "../constants";
import { downloadHistoryCsv as _downloadHistoryCsv } from "../lib/download";
import { sortPins } from "../lib/sortPins";
import HistoryModal from "../components/HistoryModal";
import PinCard from "../components/PinCard";
import ImageDropzone from "../components/ImageDropzone";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Label } from "../components/ui/label";
import { LoadingOverlay } from "../components/ui/loading-overlay";

function HistoryRow({ item, onLoad, onDownload, onDelete }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col gap-1.5">
      <button type="button" onClick={() => onLoad(item.id)} className="text-left w-full cursor-pointer">
        <p className="text-[0.72rem] font-semibold text-gray-900 leading-snug truncate">
          {item.keyword} ({item.total})
        </p>
        <p className="text-[0.65rem] text-gray-400">{item.created_at?.slice(0, 16).replace("T", " ")}</p>
      </button>
      <div className="flex gap-1.5">
        <Button variant="outline-sky" size="xs" type="button" onClick={() => onDownload(item)}>
          Tải CSV
        </Button>
        <Button variant="outline-red" size="xs" type="button" onClick={() => onDelete(item)}>
          Xóa
        </Button>
      </div>
    </div>
  );
}

export default function PinterestImagePage({ history, loadHistory, initialHistoryId, onInitConsumed }) {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [headless] = useState(true);
  const [scrollRounds, setScrollRounds] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);

  useEffect(() => {
    if (!initialHistoryId) return;
    loadHistoryDetail(initialHistoryId);
    onInitConsumed?.();
  }, [initialHistoryId]); // eslint-disable-line

  const handleFile = (f) => {
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
    setError("");
    setResult(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!imageFile) { setError("Vui lòng chọn ảnh."); return; }
    setLoading(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("file", imageFile);
    form.append("headless", headless ? "true" : "false");
    form.append("scroll_rounds", String(scrollRounds));
    try {
      const res = await fetch(`${API_BASE}/api/pinterest/upload_and_search`, { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Lỗi ${res.status}`);
      }
      setResult(await res.json());
      await loadHistory();
    } catch (err) {
      setError(err.message || "Lỗi không xác định.");
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryDetail = async (id) => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history/${id}`);
      if (!res.ok) throw new Error(`Lỗi tải lịch sử: ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(err.message || "Không tải được lịch sử.");
    } finally {
      setLoading(false);
    }
  };

  const downloadHistoryCsv = (item) => _downloadHistoryCsv(item, API_BASE, setError);

  const deleteHistory = async (item) => {
    if (!window.confirm(`Xóa lịch sử "${item.keyword}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/history/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Xóa lịch sử thất bại.");
      await loadHistory();
    } catch (err) {
      setError(err.message || "Không xóa được lịch sử.");
    }
  };

  const pins = result?.similar_pins || result?.pins || [];

  const displayPins = useMemo(() => {
    if (!pins.length) return [];
    let list = [...pins];
    const q = (filterText || "").trim().toLowerCase();
    if (q) list = list.filter((p) =>
      (p.title || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)
    );
    return sortPins(list, sortBy);
  }, [pins, filterText, sortBy]);

  const imageHistory = (history || []).filter(h => h.id.includes("image_upload") || h.keyword?.startsWith("image_upload"));

  return (
    <>
      {loading && (
        <LoadingOverlay title="Đang xử lý..." subtitle="Upload ảnh và tìm pin tương tự, khoảng 30–60 giây." />
      )}

      <div className="flex gap-4 h-full overflow-hidden p-4">
        {/* Left panel: form + history */}
        <div className="w-64 shrink-0 flex flex-col gap-3 overflow-hidden">
          <p className="font-semibold text-sm text-gray-900">Tìm pin tương tự</p>

          {/* Image dropzone */}
          <ImageDropzone
            file={imageFile}
            preview={imagePreview}
            onChange={handleFile}
            style={{ aspectRatio: "3/4", minHeight: 160, maxHeight: 220 }}
            className="shrink-0"
          />

          {/* Scroll rounds */}
          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-gray-600 whitespace-nowrap">Số trang kết quả</label>
            <input
              type="number" min={1} max={10} value={scrollRounds}
              onChange={(e) => setScrollRounds(Math.max(1, Math.min(10, Number(e.target.value))))}
              className="w-16 border border-gray-300 rounded px-2 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-[#e60023]"
            />
            <span className="text-xs text-gray-400">~{scrollRounds * 25} pin</span>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 shrink-0">
              {error}
            </div>
          )}

          <Button variant="pinterest" onClick={handleSubmit} disabled={loading} className="w-full shrink-0">
            📌 Upload & Tìm pin tương tự
          </Button>

          {/* History button */}
          <Button variant="outline" className="w-full shrink-0" onClick={() => setHistoryModalOpen(true)}>
            📂 Lịch sử
            {imageHistory.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{imageHistory.length}</span>
            )}
          </Button>
        </div>

        {/* Right panel: results */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {result && (
            <div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-3 text-sm">
                {result.pin_id ? (
                  <>
                    <p className="font-bold text-emerald-700 mb-1">✅ Pin đã tạo thành công!</p>
                    <p className="text-gray-700">ID: <strong>{result.pin_id}</strong></p>
                    <a href={result.pin_url} target="_blank" rel="noreferrer"
                      className="text-[#e60023] font-semibold break-all hover:underline text-xs">
                      {result.pin_url}
                    </a>
                  </>
                ) : (
                  <p className="font-bold text-emerald-700">📌 Lịch sử: {result.keyword}</p>
                )}
                <p className="text-gray-600 mt-1">Tổng: <strong>{pins.length}</strong> pin tương tự</p>
              </div>

              {pins.length > 0 && (
                <>
                  {/* Filter bar */}
                  <div className="flex flex-wrap gap-3 items-center mb-3">
                    <div className="min-w-[190px] flex-1">
                      <Label htmlFor="img-filter-pins">Lọc theo tên / mô tả</Label>
                      <Input id="img-filter-pins" type="text" value={filterText}
                        onChange={(e) => setFilterText(e.target.value)} placeholder="Nhập từ khóa..." />
                    </div>
                    <div className="min-w-[200px]">
                      <Label htmlFor="img-sort-pins">Sắp xếp theo</Label>
                      <Select id="img-sort-pins" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        {SORT_OPTIONS.filter(o => o.sources === null || o.sources.includes("pinterest"))
                          .map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </Select>
                    </div>
                    {filterText.trim() && (
                      <span className="text-xs text-gray-500 self-end pb-1">
                        Hiển thị {displayPins.length} / {pins.length} pin
                      </span>
                    )}
                  </div>

                  {/* Pin grid */}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5 pb-4">
                    {displayPins.map((pin, i) => (
                      <PinCard key={pin.pin_url || i} pin={pin} />
                    ))}
                  </div>
                </>
              )}
              {pins.length === 0 && <p className="text-gray-400 text-sm">Không có pin tương tự nào.</p>}
            </div>
          )}

          {!result && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-2">
              <div className="text-5xl">📌</div>
              <p>Upload ảnh để tìm các pin tương tự trên Pinterest</p>
            </div>
          )}
        </div>
      </div>

      {/* History modal */}
      <HistoryModal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        title="Lịch sử upload ảnh"
        count={imageHistory.length}
      >
        {imageHistory.length > 0 && imageHistory.map((item) => (
          <HistoryRow key={item.id} item={item}
            onLoad={(id) => { loadHistoryDetail(id); setHistoryModalOpen(false); }}
            onDownload={downloadHistoryCsv}
            onDelete={deleteHistory}
          />
        ))}
      </HistoryModal>
    </>
  );
}
