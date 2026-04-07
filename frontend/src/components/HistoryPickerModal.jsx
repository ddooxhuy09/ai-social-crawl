import { useState, useEffect, useMemo } from "react";
import { API_BASE, SORT_OPTIONS, matchesSource } from "../constants";
import { PinStats } from "./PinCard";

const SOURCE_OPTIONS = [
  { value: "", label: "Tất cả nguồn" },
  { value: "pinterest", label: "📌 Pinterest" },
  { value: "instagram", label: "📷 Instagram" },
  { value: "tiktok", label: "🎵 TikTok" },
  { value: "reddit", label: "📰 Reddit" },
  { value: "youtube", label: "▶️ YouTube" },
];

export default function HistoryPickerModal({ historyId, historyKeyword, selectedPins, onTogglePin, onClose }) {
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [filterText, setFilterText] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterContentType, setFilterContentType] = useState("");
  const [sortBy, setSortBy] = useState("default");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`${API_BASE}/api/history/${historyId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => setPins(data.pins || []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [historyId]);

  const hasSimilarity = pins[0]?.similarity_score != null;
  const hasConfidence = pins[0]?.confidence_score != null;

  const displayPins = useMemo(() => {
    let list = [...pins];
    const q = filterText.trim().toLowerCase();
    if (q) list = list.filter(p => (p.title || "").toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q));
    if (filterSource) list = list.filter(p => matchesSource(p.source, filterSource));
    if (filterContentType && filterSource === "instagram") list = list.filter(p => (p.content_type || "photo") === filterContentType);
    const num = v => (typeof v === "number" ? v : parseInt(v, 10) || 0);
    if (sortBy !== "default") {
      list.sort((a, b) => {
        switch (sortBy) {
          case "title_asc": return (a.title || "").localeCompare(b.title || "");
          case "title_desc": return (b.title || "").localeCompare(a.title || "");
          case "likes_desc": return num(b.like_count) - num(a.like_count);
          case "likes_asc": return num(a.like_count) - num(b.like_count);
          case "saves_desc": return num(b.save_count) - num(a.save_count);
          case "repins_desc": return num(b.repin_count) - num(a.repin_count);
          case "views_desc": return num(b.view_count) - num(a.view_count);
          case "views_asc": return num(a.view_count) - num(b.view_count);
          case "similarity_desc": return (b.similarity_score ?? 0) - (a.similarity_score ?? 0);
          case "confidence_desc": return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
          default: return 0;
        }
      });
    }
    return list;
  }, [pins, filterText, filterSource, filterContentType, sortBy]);

  const isSelected = pin => selectedPins.some(p => p.image_url === pin.image_url);
  const selIndex = pin => selectedPins.findIndex(p => p.image_url === pin.image_url);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-base font-semibold text-gray-900">
              📂 {historyKeyword}
            </p>
            {!loading && (
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                {pins.length} pins
              </span>
            )}
            {selectedPins.length > 0 && (
              <span className="text-xs font-semibold text-sky-700 bg-sky-100 rounded-full px-2.5 py-0.5">
                {selectedPins.length} đã chọn
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedPins.length > 0 && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors"
              >
                ✓ Xong ({selectedPins.length})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 items-end px-5 py-3 border-b border-gray-100 shrink-0 bg-gray-50">
          {/* Source filter */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs font-medium text-gray-500">Nguồn</label>
            <select
              value={filterSource}
              onChange={e => { setFilterSource(e.target.value); setFilterContentType(""); }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Instagram content type */}
          {filterSource === "instagram" && (
            <div className="flex flex-col gap-1 min-w-[100px]">
              <label className="text-xs font-medium text-gray-500">Loại</label>
              <select
                value={filterContentType}
                onChange={e => setFilterContentType(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <option value="">Tất cả</option>
                <option value="photo">Photo</option>
                <option value="reel">Reel</option>
              </select>
            </div>
          )}

          {/* Text filter */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-xs font-medium text-gray-500">Tìm kiếm</label>
            <input
              type="text"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              placeholder="Lọc theo tên / mô tả..."
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
            />
          </div>

          {/* Sort */}
          <div className="flex flex-col gap-1 min-w-[180px]">
            <label className="text-xs font-medium text-gray-500">Sắp xếp</label>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-300"
            >
              {SORT_OPTIONS.filter(o => {
                if (o.value.startsWith("similarity_") && !hasSimilarity) return false;
                if (o.value.startsWith("confidence_") && !hasConfidence) return false;
                if (o.sources === null) return true;
                if (filterSource) return o.sources?.includes(filterSource);
                return true;
              }).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {(filterText.trim() || filterSource || filterContentType) && (
            <span className="text-xs text-gray-400 self-end pb-1.5">
              {displayPins.length} / {pins.length} pin
            </span>
          )}
        </div>

        {/* Pin grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">
              Đang tải ảnh...
            </div>
          )}
          {error && (
            <div className="text-sm text-red-500 text-center py-8">{error}</div>
          )}
          {!loading && !error && displayPins.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-8">Không có ảnh phù hợp.</div>
          )}
          {!loading && !error && displayPins.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {displayPins.map((pin, idx) => {
                const selected = isSelected(pin);
                const sIdx = selIndex(pin);
                return (
                  <button
                    key={`${pin.source}-${pin.image_url}-${idx}`}
                    type="button"
                    onClick={() => onTogglePin(pin)}
                    className={`relative flex flex-col rounded-xl overflow-hidden border-2 transition-all text-left bg-white group ${
                      selected
                        ? "border-sky-500 ring-2 ring-sky-200 shadow-md"
                        : "border-transparent hover:border-gray-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="relative w-full aspect-square shrink-0">
                      {/* Image */}
                      <div className="absolute inset-0 bg-gray-100">
                        <img
                          src={pin.image_url}
                          alt={pin.title || ""}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>

                      {/* Selection overlay */}
                      {selected && (
                        <div className="absolute inset-0 bg-sky-500/20 flex items-start justify-end p-1.5 z-10">
                          <span className="w-6 h-6 rounded-full bg-sky-500 text-white text-xs font-bold flex items-center justify-center shadow">
                            {sIdx + 1}
                          </span>
                        </div>
                      )}

                      {/* Hover overlay (unselected) */}
                      {!selected && (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-start justify-end p-1.5 z-10">
                          <span className="w-6 h-6 rounded-full bg-white/80 text-gray-500 text-xs font-bold flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity">
                            +
                          </span>
                        </div>
                      )}

                      {/* Source badge */}
                      {pin.source && (
                        <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/50 to-transparent z-10">
                          <p className="text-white text-[10px] truncate">{pin.title || pin.source}</p>
                        </div>
                      )}
                    </div>
                    
                    {/* Parameters info */}
                    <div className="px-2.5 py-2 flex flex-col gap-1 w-full flex-1">
                      <div className="flex flex-wrap gap-0.5">
                        <PinStats pin={pin} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400">
            Click ảnh để chọn/bỏ chọn. Ảnh đầu tiên được chọn ở panel trước sẽ là Main Image.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold transition-colors"
          >
            ✓ Xong {selectedPins.length > 0 ? `(${selectedPins.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
