import React, { useMemo, useState, useEffect } from "react";
import { API_BASE, SORT_OPTIONS, matchesSource } from "../constants";
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

const CRAWL_SOURCES = [
  { id: "pinterest", label: "Pinterest", emoji: "📌" },
  { id: "instagram", label: "Instagram", emoji: "📷" },
  { id: "tiktok", label: "TikTok", emoji: "🎵" },
  { id: "reddit", label: "Reddit", emoji: "📰" },
  { id: "youtube", label: "YouTube", emoji: "▶️" },
];

function HistoryRow({ item, loadHistoryDetail, downloadHistoryCsv, setError, loadHistory }) {
  const onDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Xóa lịch sử crawl "${item.keyword}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/history/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Xóa lịch sử thất bại.");
      }
      await loadHistory();
    } catch (err) {
      console.error(err);
      setError(err.message || "Không xóa được lịch sử.");
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => loadHistoryDetail(item.id)}
        className="text-left w-full cursor-pointer"
      >
        <p className="text-[0.72rem] font-semibold text-gray-900 leading-snug">
          {item.keyword} ({item.total}){[
            item.pinterest_count > 0 && ` 📌${item.pinterest_count}`,
            item.instagram_count > 0 && ` 📷${item.instagram_count}`,
            item.tiktok_count > 0 && ` 🎵${item.tiktok_count}`,
            item.reddit_count > 0 && ` 📰${item.reddit_count}`,
            item.youtube_count > 0 && ` ▶️${item.youtube_count}`,
          ].filter(Boolean).join(" ")}
        </p>
        <p className="text-[0.65rem] text-gray-400">{item.created_at}</p>
      </button>
      <div className="flex gap-1.5">
        <Button
          variant="outline-sky" size="xs"
          type="button"
          onClick={(e) => { e.stopPropagation(); downloadHistoryCsv(item); }}
        >
          Tải CSV
        </Button>
        <Button
          variant="outline-red" size="xs"
          type="button"
          onClick={onDelete}
        >
          Xóa
        </Button>
      </div>
    </div>
  );
}

export default function CrawlPage({
  keyword, setKeyword, loading, setLoading,
  error, setError, result, setResult,
  history, loadHistory, historyLoading,
  initialHistoryId, onInitConsumed,
  pickContext, onPickOriginal,
}) {
  // Auto-load history effect
  useEffect(() => {
    if (initialHistoryId) {
      loadHistoryDetail(initialHistoryId);
      onInitConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHistoryId]);
  const [searchImageFile, setSearchImageFile] = useState(null);
  const [searchImagePreview, setSearchImagePreview] = useState(null);
  const [searchImageHistoryId, setSearchImageHistoryId] = useState("");
  const [searchImageLoading, setSearchImageLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterContentType, setFilterContentType] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [searchPrompt, setSearchPrompt] = useState("");
  const [searchPromptHistoryId, setSearchPromptHistoryId] = useState("");
  const [searchPromptLoading, setSearchPromptLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [crawlSources, setCrawlSources] = useState(() => CRAWL_SOURCES.map((s) => s.id));
  const [limitPerSource, setLimitPerSource] = useState("");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [pinterestSettingsOpen, setPinterestSettingsOpen] = useState(false);
  const [pinterestScrollRounds, setPinterestScrollRounds] = useState(5);
  const [pinterestHeadless, setPinterestHeadless] = useState(true);
  const [pinterestMode, setPinterestMode] = useState("default"); // "default" | "saves" | "repins"
  const [pinterestSavesMin, setPinterestSavesMin] = useState(100);
  const [pinterestRepinsMin, setPinterestRepinsMin] = useState(50);


  const isBusy = loading || searchImageLoading || searchPromptLoading;

  const isAllSources = crawlSources.length === CRAWL_SOURCES.length;
  const crawlSourcesLabel = isAllSources
    ? "Tất cả platform"
    : CRAWL_SOURCES.filter((s) => crawlSources.includes(s.id))
      .map((s) => `${s.emoji} ${s.label}`)
      .join(", ");

  const toggleCrawlSource = (id) => {
    setCrawlSources((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const next = Array.from(set);
      // Tránh trạng thái "không chọn gì" -> coi như chọn tất cả
      if (next.length === 0) return CRAWL_SOURCES.map((s) => s.id);
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    const trimmed = keyword.trim();
    if (!trimmed) { setError("Vui lòng nhập keyword."); return; }
    const parsedLimit = Number.parseInt(limitPerSource, 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : "max";
    const limitDisplay = safeLimit === "max" ? "max" : safeLimit;
    setStatusMessage(`Đang crawl theo keyword... (${crawlSourcesLabel}, ~${limitDisplay} mỗi nguồn)`);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: trimmed,
          sources: isAllSources ? null : crawlSources,
          limit_per_source: safeLimit,
          pinterest_scroll_rounds: pinterestScrollRounds,
          pinterest_headless: pinterestHeadless,
          pinterest_mode: pinterestMode,
          pinterest_saves_min: pinterestSavesMin,
          pinterest_repins_min: pinterestRepinsMin,
        }),
      });
      if (!res.ok) throw new Error(await res.text() || `Request failed: ${res.status}`);
      const data = await res.json();
      if (data.status === "queued") {
        setStatusMessage("✅ Task đã được thêm vào hàng đợi. Vui lòng kiểm tra Bảng Task để xem tiến độ.");
        setTimeout(() => setStatusMessage(""), 8000);
      } else {
        setResult(data);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Có lỗi xảy ra.");
    } finally {
      setLoading(false);
      if (!statusMessage.includes("✅")) setStatusMessage("");
    }
  };

  const handleSearchByImage = async (e) => {
    e.preventDefault();
    setError(""); setResult(null);
    if (!searchImageHistoryId) { setError("Vui lòng chọn một lịch sử crawl."); return; }
    if (!searchImageFile) { setError("Vui lòng chọn ảnh cần so sánh."); return; }
    setStatusMessage("Đang tìm ảnh giống (so sánh với lịch sử)...");
    setSearchImageLoading(true);
    try {
      const formData = new FormData();
      formData.append("history_id", searchImageHistoryId);
      formData.append("file", searchImageFile);
      const res = await fetch(`${API_BASE}/api/search_by_image`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text() || `Lỗi: ${res.status}`);
      const data = await res.json();
      setResult(data);
      setKeyword(data.keyword || "");
    } catch (err) {
      console.error(err);
      setError(err.message || "Có lỗi khi tìm theo ảnh.");
    } finally {
      setSearchImageLoading(false);
      setStatusMessage("");
    }
  };

  const handleSearchByPrompt = async (e) => {
    e.preventDefault();
    setError(""); setResult(null);
    if (!searchPromptHistoryId) { setError("Vui lòng chọn một lịch sử crawl."); return; }
    if (!searchPrompt.trim()) { setError("Vui lòng nhập mô tả ảnh cần tìm."); return; }
    setStatusMessage("Đang tìm theo mô tả ảnh...");
    setSearchPromptLoading(true);
    try {
      const formData = new FormData();
      formData.append("history_id", searchPromptHistoryId);
      formData.append("prompt", searchPrompt.trim());
      const res = await fetch(`${API_BASE}/api/search_by_prompt`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text() || `Lỗi: ${res.status}`);
      const data = await res.json();
      setResult(data);
      setKeyword(data.keyword || "");
    } catch (err) {
      console.error(err);
      setError(err.message || "Có lỗi khi tìm theo prompt.");
    } finally {
      setSearchPromptLoading(false);
      setStatusMessage("");
    }
  };

  const loadHistoryDetail = async (id) => {
    setError("");
    setStatusMessage("Đang tải lịch sử...");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history/${id}`);
      if (!res.ok) throw new Error(`Lỗi tải lịch sử: ${res.status}`);
      const data = await res.json();
      setResult(data);
      setKeyword(data.keyword || "");
    } catch (err) {
      console.error(err);
      setError(err.message || "Không tải được lịch sử.");
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  const downloadHistoryCsv = (item) => _downloadHistoryCsv(item, API_BASE, setError);

  const hasSimilarity = result?.pins?.[0]?.similarity_score != null;
  const hasConfidence = result?.pins?.[0]?.confidence_score != null;

  const displayPins = useMemo(() => {
    if (!result?.pins?.length) return [];
    let list = [...result.pins];
    const q = (filterText || "").trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
    }
    if (filterSource) {
      list = list.filter((p) => matchesSource(p.source, filterSource));
    }
    if (filterContentType && filterSource === "instagram") {
      list = list.filter((p) => (p.content_type || "photo") === filterContentType);
    }
    return sortPins(list, sortBy);
  }, [result?.pins, filterText, filterSource, filterContentType, sortBy]);

  const historyCountStr = (item) => [
    item.pinterest_count > 0 && ` P:${item.pinterest_count}`,
    item.instagram_count > 0 && ` 📷${item.instagram_count}`,
    item.tiktok_count > 0 && ` T:${item.tiktok_count}`,
    item.reddit_count > 0 && ` R:${item.reddit_count}`,
    item.youtube_count > 0 && ` Y:${item.youtube_count}`,
  ].filter(Boolean).join("");

  return (
    <>
      {/* Loading overlay */}
      {isBusy && (
        <LoadingOverlay title={statusMessage} subtitle="Vui lòng chờ, không thao tác thêm." />
      )}

      {/* Search forms */}
      <div className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.8fr)] gap-4 p-4 pb-0">
        {/* Crawl keyword form */}
        <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 p-4 bg-gray-50">
          <p className="text-sm font-semibold text-gray-900 mb-3">Crawl theo keyword</p>

          <div className="mb-3">
            <Label htmlFor="keyword">Keyword</Label>
            <Input
              id="keyword" type="text" value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="vd: dog, cat, living room decor..."
            />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <p className="text-xs font-semibold text-gray-700">Chọn platform để crawl</p>
              <Button
                type="button" size="xs"
                variant={isAllSources ? "default" : "outline"}
                onClick={() => setCrawlSources(CRAWL_SOURCES.map((s) => s.id))}
                aria-pressed={isAllSources}
              >
                Tất cả
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CRAWL_SOURCES.map((s) => (
                <React.Fragment key={s.id}>
                  <Button
                    type="button" size="xs"
                    variant={(isAllSources || crawlSources.includes(s.id)) ? "outline-sky" : "outline"}
                    onClick={() => toggleCrawlSource(s.id)}
                    aria-pressed={isAllSources || crawlSources.includes(s.id)}
                  >
                    {s.emoji} {s.label}
                  </Button>
                  {s.id === "pinterest" && (
                    <Button
                      variant="ghost"
                      type="button"
                      title="Cài đặt crawl Pinterest"
                      onClick={() => setPinterestSettingsOpen(v => !v)}
                      className={`h-7 px-2 text-sm cursor-pointer transition-colors rounded-full ${
                        pinterestSettingsOpen ? "text-pink-500 hover:bg-pink-100" : "text-gray-400 hover:text-gray-600"
                      }`}
                    >⚙️</Button>
                  )}
                </React.Fragment>
              ))}

              {/* Pinterest settings panel */}
              {pinterestSettingsOpen && (
                <div className="w-full mt-1 p-3 bg-pink-50 border border-pink-200 rounded-lg flex flex-col gap-3">
                  <p className="text-[0.7rem] font-semibold text-pink-700">⚙️ Cài đặt crawl Pinterest</p>

                  {/* Mode */}
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[0.7rem] font-medium text-gray-600">Chế độ lọc</p>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-700 select-none">
                      <input type="radio" name="p_mode" value="default" checked={pinterestMode === "default"}
                        onChange={() => setPinterestMode("default")} className="accent-pink-500 cursor-pointer" />
                      Mặc định — quy trình gốc
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-700 select-none">
                      <input type="radio" name="p_mode" value="saves" checked={pinterestMode === "saves"}
                        onChange={() => setPinterestMode("saves")} className="accent-pink-500 cursor-pointer mt-0.5" />
                      <span>
                        Theo <strong>saves</strong> — chỉ lấy related của pin có saves ≥ ngưỡng
                        {pinterestMode === "saves" && (
                          <span className="inline-flex items-center gap-1 ml-2">
                            <span className="text-gray-400">saves_min:</span>
                            <input type="number" min={0} value={pinterestSavesMin}
                              onChange={e => setPinterestSavesMin(Number(e.target.value) || 0)}
                              className="w-20 rounded border border-pink-200 bg-white px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-pink-300" />
                          </span>
                        )}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-700 select-none">
                      <input type="radio" name="p_mode" value="repins" checked={pinterestMode === "repins"}
                        onChange={() => setPinterestMode("repins")} className="accent-pink-500 cursor-pointer mt-0.5" />
                      <span>
                        Theo <strong>re-pins</strong> — chỉ lấy related của pin có repin ≥ ngưỡng
                        {pinterestMode === "repins" && (
                          <span className="inline-flex items-center gap-1 ml-2">
                            <span className="text-gray-400">repins_min:</span>
                            <input type="number" min={0} value={pinterestRepinsMin}
                              onChange={e => setPinterestRepinsMin(Number(e.target.value) || 0)}
                              className="w-20 rounded border border-pink-200 bg-white px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-pink-300" />
                          </span>
                        )}
                      </span>
                    </label>
                  </div>

                </div>
              )}
            </div>
            <p className="text-[0.7rem] text-gray-400 mt-1">
              Đang chọn: <strong className="text-gray-600">{crawlSourcesLabel}</strong>
            </p>
          </div>

          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <Label htmlFor="limit-per-source" className="mb-0">Số lượng mỗi platform (gần đúng)</Label>
            <Input
              id="limit-per-source" type="number" min={1}
              value={limitPerSource}
              onChange={(e) => setLimitPerSource(e.target.value)}
              className="w-20"
            />
            <span className="text-[0.7rem] text-gray-400">
              Ví dụ: 50 ⇒ mỗi nguồn ~50 pin.
            </span>
          </div>

          <Button type="submit" disabled={loading} variant="pink" className="w-full">
            {loading ? "Đang gửi..." : "Gửi keyword để crawl"}
          </Button>
        </form>

        {/* Search by image + prompt */}
        <div className="flex flex-col gap-3">
          <form onSubmit={handleSearchByImage} className="rounded-xl border border-gray-200 p-3.5 bg-white">
            <p className="text-sm font-semibold text-gray-700 mb-2.5">Tìm theo ảnh của bạn</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="min-w-[190px] flex-1">
                <Label htmlFor="search-image-history">Chọn lịch sử crawl</Label>
                <Select id="search-image-history" value={searchImageHistoryId}
                  onChange={(e) => setSearchImageHistoryId(e.target.value)}>
                  <option value="">-- Chọn --</option>
                  {history.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.keyword} ({item.total}){historyCountStr(item)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Ảnh của bạn</Label>
                <ImageDropzone
                  file={searchImageFile}
                  preview={searchImagePreview}
                  onChange={(f) => { setSearchImageFile(f); setSearchImagePreview(URL.createObjectURL(f)); }}
                  style={{ aspectRatio: "4/3", minHeight: 100 }}
                />
              </div>
              <Button type="submit" variant="sky" disabled={searchImageLoading}>
                {searchImageLoading ? "Đang so sánh..." : "Tìm ảnh giống"}
              </Button>
            </div>
          </form>

          <form onSubmit={handleSearchByPrompt} className="rounded-xl border border-gray-200 p-3.5 bg-white">
            <p className="text-sm font-semibold text-gray-700 mb-2.5">🔍 Tìm ảnh theo mô tả</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="min-w-[190px]">
                <Label htmlFor="search-prompt-history">Chọn lịch sử crawl</Label>
                <Select id="search-prompt-history" value={searchPromptHistoryId}
                  onChange={(e) => setSearchPromptHistoryId(e.target.value)}>
                  <option value="">-- Chọn --</option>
                  {history.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.keyword} ({item.total}){historyCountStr(item)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="search-prompt-text">Mô tả ảnh cần tìm</Label>
                <Input id="search-prompt-text" type="text" value={searchPrompt}
                  onChange={(e) => setSearchPrompt(e.target.value)}
                  placeholder="VD: con mèo đen có đốm trắng..." />
              </div>
              <Button type="submit" variant="violet" disabled={searchPromptLoading}>
                {searchPromptLoading ? "Đang tìm..." : "Tìm theo mô tả"}
              </Button>
            </div>
            <p className="text-[0.7rem] text-gray-400 mt-1.5">
              💡 Tự động dịch tiếng Việt → Anh để tìm kiếm chính xác hơn.
            </p>
          </form>
        </div>
      </div>

      {/* History modal */}
      <HistoryModal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        title="Lịch sử crawl"
        count={history.length}
      >
        {history.length > 0 && history.map((item) => (
          <HistoryRow
            key={item.id}
            item={item}
            loadHistoryDetail={(id) => { loadHistoryDetail(id); setHistoryModalOpen(false); }}
            downloadHistoryCsv={downloadHistoryCsv}
            setError={setError}
            loadHistory={loadHistory}
          />
        ))}
      </HistoryModal>

      {/* Pick Original banner */}
      {pickContext?.mode === "pick-original" && (
        <div className="mx-4 mt-3 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
          <span className="text-emerald-600 text-base">🎯</span>
          <p className="flex-1 text-sm text-emerald-800 font-medium">
            Đang chọn Original cho project <strong>{pickContext.projectName}</strong> — click "Chọn làm Original" trên pin bất kỳ.
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-0">
        <Button variant="outline" onClick={() => setHistoryModalOpen(true)}>
          📂 Lịch sử crawl
          {history.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{history.length}</span>
          )}
        </Button>
        {historyLoading && <span className="text-xs text-gray-400 ml-1">Đang tải...</span>}
      </div>

      {/* Results */}
      <div className="p-4">
        {result && (
            <div>
              <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3">
                <div><strong>Keyword:</strong> {result.keyword}</div>
                <div>
                  <strong>Số kết quả:</strong> {result.total}
                  {result.pins_by_source && !result.pins?.[0]?.similarity_score && !result.pins?.[0]?.confidence_score && (
                    <span className="ml-2 text-gray-500 text-[0.9em]">
                      (📌 {result.pins_by_source.pinterest?.length ?? 0} | 📷 {result.pins_by_source.instagram?.length ?? 0} | 🎵 {result.pins_by_source.tiktok?.length ?? 0} | 📰 {result.pins_by_source.reddit?.length ?? 0} | ▶️ {result.pins_by_source.youtube?.length ?? 0})
                    </span>
                  )}
                  {result.pins?.[0]?.similarity_score != null && <span className="ml-2">(xếp theo độ giống ảnh của bạn)</span>}
                  {result.pins?.[0]?.confidence_score != null && <span className="ml-2">(xếp theo độ khớp với mô tả)</span>}
                </div>
                {result.prompt && (
                  <div>
                    <strong>Prompt:</strong> {result.prompt}
                    {result.prompt_translated && result.prompt_translated !== result.prompt && (
                      <span className="ml-2 text-gray-500 text-[0.9em]">(→ {result.prompt_translated})</span>
                    )}
                  </div>
                )}
              </div>

              {result.pins?.length > 0 && (
                <>
                  {/* Filter bar */}
                  <div className="flex flex-wrap gap-3 items-center mb-3">
                    <div className="min-w-[160px]">
                      <Label htmlFor="filter-source">Nguồn</Label>
                      <Select id="filter-source" value={filterSource}
                        onChange={(e) => { setFilterSource(e.target.value); setFilterContentType(""); }}>
                        <option value="">Tất cả</option>
                        <option value="pinterest">Pinterest</option>
                        <option value="instagram">Instagram</option>
                        <option value="tiktok">TikTok</option>
                        <option value="reddit">Reddit</option>
                        <option value="youtube">YouTube</option>
                      </Select>
                    </div>
                    {filterSource === "instagram" && (
                      <div className="min-w-[110px]">
                        <Label htmlFor="filter-ig-type">Loại</Label>
                        <Select id="filter-ig-type" value={filterContentType}
                          onChange={(e) => setFilterContentType(e.target.value)}>
                          <option value="">Tất cả</option>
                          <option value="photo">Photo</option>
                          <option value="reel">Reel</option>
                        </Select>
                      </div>
                    )}
                    <div className="min-w-[190px] flex-1">
                      <Label htmlFor="filter-pins">Lọc theo tên / mô tả</Label>
                      <Input id="filter-pins" type="text" value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder="Nhập từ khóa..." />
                    </div>
                    <div className="min-w-[210px]">
                      <Label htmlFor="sort-pins">Sắp xếp theo</Label>
                      <Select id="sort-pins" value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}>
                        {SORT_OPTIONS.filter((o) => {
                          if (o.value.startsWith("similarity_") && !hasSimilarity) return false;
                          if (o.value.startsWith("confidence_") && !hasConfidence) return false;
                          if (o.sources === null) return true;
                          if (filterSource) return o.sources.includes(filterSource);
                          return displayPins.some((p) => o.sources.includes(p.source));
                        }).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </Select>
                    </div>
                    {(filterText.trim() || filterSource || filterContentType) && (
                      <span className="text-xs text-gray-500 self-end pb-1">
                        Hiển thị {displayPins.length} / {result.pins.length} pin
                      </span>
                    )}
                  </div>

                  {/* Pin grid */}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 pb-4">
                    {displayPins.map((pin, index) => (
                      <PinCard
                        key={`${pin.source || "pin"}-${pin.pin_url || pin.canonical_pin_id}-${index}`}
                        pin={pin}
                        onPick={pickContext?.mode === "pick-original" ? (p) => onPickOriginal(p, pickContext.projectId) : undefined}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
      </div>
    </>
  );
}

