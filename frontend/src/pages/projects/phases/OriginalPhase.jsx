import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "../../../constants";
import ManualUploadModal from "../../../components/ManualUploadModal";

const HENULL_POLL_MS = 5000;

export default function OriginalPhase({ project, saveProject, onAddTaskToQueue, onNavigate }) {
  const original = project.original || {};

  // ── HEnull open & status watch ───────────────────────────────────────────────
  const [openingHenull, setOpeningHenull] = useState(false);
  const [henullMsg, setHenullMsg] = useState("");
  const [henullWatching, setHenullWatching] = useState(false);
  const [henullCrawling, setHenullCrawling] = useState(false);
  const henullPollRef = useRef({ lastSeenNewest: null });

  const handleOpenHenull = async () => {
    setOpeningHenull(true);
    setHenullMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${project.id}/original/open-henull`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Lỗi mở HEnull");
      setHenullMsg("✅ Browser đã mở trên VPS. Đăng nhập HEnull → search keyword để bắt đầu crawl.");
      try {
        const h = await fetch(`${API_BASE}/api/etsy_hunt/history?project_id=${project.id}`);
        const list = await h.json();
        henullPollRef.current.lastSeenNewest = list?.[0]?.filename ?? null;
      } catch (_) {}
      setHenullWatching(true);
    } catch (e) {
      setHenullMsg(`❌ ${e.message}`);
    } finally {
      setOpeningHenull(false);
    }
  };

  useEffect(() => {
    if (!henullWatching) return;
    const poll = async () => {
      try {
        const sRes = await fetch(`${API_BASE}/api/etsy_hunt/status?project_id=${project.id}`);
        const s = await sRes.json();
        setHenullCrawling(s.state === "crawling" || s.state === "crawling_products");
        // detect new CSV
        const hRes = await fetch(`${API_BASE}/api/etsy_hunt/history?project_id=${project.id}`);
        const list = await hRes.json();
        const newest = list?.[0]?.filename ?? null;
        if (newest && newest !== henullPollRef.current.lastSeenNewest) {
          henullPollRef.current.lastSeenNewest = newest;
          setHuntHistory(list);
        }
      } catch (_) {}
    };
    const id = setInterval(poll, HENULL_POLL_MS);
    return () => clearInterval(id);
  }, [henullWatching]);

  // ── Crawl History Browser ───────────────────────────────────────────────────
  const [crawlHistory, setCrawlHistory] = useState([]);
  const [crawlHistoryLoading, setCrawlHistoryLoading] = useState(false);

  const [crawlOpen, setCrawlOpen] = useState(false);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);

  const handleManualUploadConfirm = (items) => {
    if (!items || items.length === 0) return;
    const item = items[0];
    saveProject({ ...project, original: { ...original, original_item: { ...item, source: "manual" }, status: "done" } });
  };

  const loadCrawlHistory = useCallback(async () => {
    setCrawlHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history?project_id=${project.id}`);
      setCrawlHistory(await res.json());
    } catch (_) {}
    setCrawlHistoryLoading(false);
  }, [project.id]);

  const handleToggleCrawlHistory = () => {
    const nextOpen = !crawlOpen;
    setCrawlOpen(nextOpen);
    if (nextOpen && crawlHistory.length === 0 && !crawlHistoryLoading) {
      loadCrawlHistory();
    }
  };

  // ── Keyword history ──────────────────────────────────────────────────────────
  const [huntHistory, setHuntHistory] = useState([]);
  const [huntHistoryLoading, setHuntHistoryLoading] = useState(false);
  const [huntDetail, setHuntDetail] = useState(null);      // { filename, rows[] }
  const [huntDetailLoading, setHuntDetailLoading] = useState(false);
  const [huntFilter, setHuntFilter] = useState("");
  const [huntSelectedRowIds, setHuntSelectedRowIds] = useState(new Set());
  const [addingToQueue, setAddingToQueue] = useState(false);
  const [addQueueMsg, setAddQueueMsg] = useState("");

  const loadHuntHistory = useCallback(async () => {
    setHuntHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history?project_id=${project.id}`);
      setHuntHistory(await res.json());
    } catch (_) {}
    setHuntHistoryLoading(false);
  }, []);

  // ── Product DB history state & functions ────────────────────────────────────
  const [productHistory, setProductHistory] = useState([]);
  const [productHistoryLoading, setProductHistoryLoading] = useState(false);
  const [productDetail, setProductDetail] = useState(null);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [productDetailModalOpen, setProductDetailModalOpen] = useState(false);
  const [productSelectedIds, setProductSelectedIds] = useState(new Set());
  const [savingProducts, setSavingProducts] = useState(false);
  const [saveProductsMsg, setSaveProductsMsg] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [productSort, setProductSort] = useState({ col: "monthly_sales", dir: "desc" });

  const [productOpen, setProductOpen] = useState(false);

  const loadProductHistory = useCallback(async () => {
    setProductHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/product_history?project_id=${project.id}`);
      setProductHistory(await res.json());
    } catch (_) {}
    setProductHistoryLoading(false);
  }, []);

  const handleToggleProductHistory = () => {
    const nextOpen = !productOpen;
    setProductOpen(nextOpen);
    if (nextOpen && productHistory.length === 0 && !productHistoryLoading) {
      loadProductHistory();
    }
  };

  const loadProductDetail = async (filename) => {
    if (productDetailLoading) return;
    setProductDetailLoading(true);
    setProductDetail(null);
    setProductFilter("");
    setProductSelectedIds(new Set());
    setSaveProductsMsg("");
    setProductSort({ col: "monthly_sales", dir: "desc" });
    setProductDetailModalOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/product_history/${filename}?project_id=${project.id}`);
      const data = await res.json();
      const list = Array.isArray(data?.rows) ? data.rows : [];
      setProductDetail({ filename, list });
    } catch (_) {}
    setProductDetailLoading(false);
  };

  const etsy_products = original?.etsy_products || [];

  const handleSaveProductToProject = async () => {
    if (!productDetail || productSelectedIds.size === 0) return;
    const items = productDetail.list.filter(r => productSelectedIds.has(r.id || r.product_id || r.title));
    if (!items.length) return;
    setSavingProducts(true);
    setSaveProductsMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${project.id}/original/products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Lỗi lưu sản phẩm");
      const data = await res.json();
      setSaveProductsMsg(`✅ Đã thêm ${data.added} sản phẩm vào dự án!`);
      const newEtsyProducts = [...etsy_products];
      const existingIds = new Set(newEtsyProducts.map(p => p.id || p.product_id || p.title));
      items.forEach(item => {
        const uid = item.id || item.product_id || item.title;
        if (!existingIds.has(uid)) newEtsyProducts.push(item);
      });
      saveProject({ ...project, original: { ...original, etsy_products: newEtsyProducts } });
      setProductSelectedIds(new Set());
    } catch (e) {
      setSaveProductsMsg(`❌ ${e.message}`);
    }
    setSavingProducts(false);
  };

  const loadHuntDetail = async (filename) => {
    if (huntDetail?.filename === filename) { setHuntDetail(null); return; }
    setHuntDetailLoading(true);
    setHuntDetail(null);
    setHuntFilter("");
    setHuntSelectedRowIds(new Set());
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}?project_id=${project.id}`);
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setHuntDetail({ filename, rows: rows.map((r, i) => ({ ...r, _rowId: `${filename}::${i}` })) });
    } catch (_) {}
    setHuntDetailLoading(false);
  };

  const handleAddToQueue = async () => {
    if (!huntDetail || huntSelectedRowIds.size === 0) return;
    const keywords = huntDetail.rows
      .filter(r => huntSelectedRowIds.has(r._rowId))
      .map(r => r.keyword || r.Keyword)
      .filter(Boolean);
    if (!keywords.length) return;
    setAddingToQueue(true);
    setAddQueueMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${project.id}/keyword-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, source_file: huntDetail.filename }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Lỗi thêm vào queue");
      const data = await res.json();
      saveProject({ ...project, redesign: { ...(project.redesign || {}), keyword_tasks: data.tasks } });
      setAddQueueMsg(`✅ Đã thêm ${data.added} keyword vào Task Queue (bỏ qua ${keywords.length - data.added} trùng)`);
      setHuntSelectedRowIds(new Set());
    } catch (e) {
      setAddQueueMsg(`❌ ${e.message}`);
    }
    setAddingToQueue(false);
  };

  // ── Etsy product & social ────────────────────────────────────────────────────
  const [selectedEtsyIds, setSelectedEtsyIds] = useState(new Set(original.selected_etsy_ids || []));
  const [crawling, setCrawling] = useState(false);
  const [stagedKeywords, setStagedKeywords] = useState([]);
  const [generatingKeywords, setGeneratingKeywords] = useState(false);
  const [visibleEtsyCount, setVisibleEtsyCount] = useState(5);

  const original_item = original.original_item || null;
  const hunt_keywords = original.hunt_keywords || [];

  const handlePrepareCrawl = async () => {
    const selected = etsy_products.filter(p => selectedEtsyIds.has(p.id || p.product_id || p.title));
    if (selected.length === 0) return;
    setGeneratingKeywords(true);
    const staged = [];
    try {
      for (const product of selected) {
        let kw = product.title || product.name || original.keyword || "";
        
        // Use Gemini to optimize the keyword if the title is too long
        if (kw.length > 30) {
          try {
            const res = await fetch(`${API_BASE}/api/projects/${project.id}/original/generate-keyword`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: kw })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.keyword) kw = data.keyword;
            }
          } catch (e) {
            console.error("Gemini extraction error:", e);
          }
        }
        staged.push({ id: product.id || product.product_id || product.title, title: product.title || product.name, keyword: kw });
      }
      setStagedKeywords(staged);
    } finally {
      setGeneratingKeywords(false);
    }
  };

  const handleConfirmCrawl = async () => {
    if (stagedKeywords.length === 0) return;
    setCrawling(true);
    try {
      for (const item of stagedKeywords) {
        await onAddTaskToQueue(
          { id: `orig-crawl-${item.id}-${Date.now()}`, title: `Crawl: ${item.keyword}`, linked_page: "crawl", linked_keyword: item.keyword, status: "todo" },
          project.id, project.name, "original",
        );
      }
      saveProject({ ...project, original: { ...original, selected_etsy_ids: Array.from(selectedEtsyIds), status: "crawling" } });
      setStagedKeywords([]);
    } finally {
      setCrawling(false);
    }
  };

  const statusColor = {
    empty: "text-gray-400", searching: "text-sky-500",
    crawling: "text-amber-500", selecting: "text-violet-500", done: "text-emerald-500",
  };

  const filteredRows = (huntDetail?.rows ?? []).filter(r =>
    !huntFilter || (r.keyword || r.Keyword || "").toLowerCase().includes(huntFilter.toLowerCase())
  );
  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every(r => huntSelectedRowIds.has(r._rowId));

  const filteredProductRows = (() => {
    let rows = (productDetail?.list ?? []).filter(r =>
      !productFilter || (r.title || r.name || "").toLowerCase().includes(productFilter.toLowerCase())
    );
    if (productSort.col) {
      rows = [...rows].sort((a, b) => {
        const dir = productSort.dir === "desc" ? -1 : 1;
        return dir * ((Number(a[productSort.col]) || 0) - (Number(b[productSort.col]) || 0));
      });
    }
    return rows;
  })();
  const allProductFilteredSelected = filteredProductRows.length > 0 && filteredProductRows.every(r => productSelectedIds.has(r.id || r.product_id || r.title));

  return (
    <div className="p-5 flex flex-col gap-6 max-w-4xl">
      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-gray-800">🎯 Original Phase</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 ${statusColor[original.status] || "text-gray-400"}`}>
          {original.status || "empty"}
        </span>
      </div>

      {/* ── HEnull ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button" onClick={handleOpenHenull} disabled={openingHenull}
            className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-semibold hover:bg-violet-600 disabled:opacity-50 transition-colors"
          >
            {openingHenull ? "⏳ Đang mở..." : "🌐 Mở HEnull"}
          </button>
          {henullWatching && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              henullCrawling ? "bg-amber-100 text-amber-700 animate-pulse" : "bg-gray-100 text-gray-500"
            }`}>
              {henullCrawling ? "⏳ HEnull đang crawl keywords..." : "👁 Đang theo dõi"}
            </span>
          )}
          <span className="text-xs text-gray-400">Mở → đăng nhập → search keyword để lấy token.</span>
        </div>
        {henullMsg && (
          <p className={`text-xs px-3 py-1.5 rounded-lg border ${henullMsg.startsWith("✅") ? "text-emerald-700 bg-emerald-50 border-emerald-100" : "text-red-600 bg-red-50 border-red-100"}`}>
            {henullMsg}
          </p>
        )}
      </section>


      {/* ── Product DB History ── */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleToggleProductHistory}
          className="flex items-center gap-2 text-left group w-fit"
        >
          <span
            className="text-[10px] text-gray-400 transition-transform duration-150"
            style={{ display: "inline-block", transform: productOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          >▶</span>
          <h3 className="text-sm font-bold text-gray-700 group-hover:text-gray-900">🛍 Product DB History</h3>
          {productHistoryLoading && <span className="text-xs text-sky-500 animate-pulse">Loading...</span>}
        </button>

        {productOpen && (
          <div className="flex flex-col gap-3 pl-4">
            <div className="flex justify-end">
              <button type="button" onClick={loadProductHistory}
                className="text-xs text-sky-500 hover:underline disabled:opacity-50"
                disabled={productHistoryLoading}>
                ↻ Refresh
              </button>
            </div>

            {productHistory.length === 0 && !productHistoryLoading && (
              <p className="text-xs text-gray-400 italic">Chưa có lịch sử. Mở Product DB trong tab Hunt để tạo lịch sử.</p>
            )}

            {/* Product DB file list */}
            {productHistory.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {productHistory.map((h, idx) => {
                  const nameMatch = h.filename.match(/etsy_products_(.+?)_(\d{8}_\d{6})\.csv$/);
                  const displayName = nameMatch ? nameMatch[1] : h.filename.replace(".csv", "");
                  return (
                    <button key={h.filename || idx} type="button" onClick={() => loadProductDetail(h.filename)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all text-sm ${
                        productDetail?.filename === h.filename
                          ? "border-sky-400 bg-sky-50 text-sky-700"
                          : "border-gray-200 hover:bg-gray-50 text-gray-700"
                      }`}>
                      <span>🛍</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{displayName}</p>
                        <p className="text-xs text-gray-400 truncate">{h.filename}</p>
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">{h.size_kb ? `${h.size_kb} KB` : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {productDetailLoading && (
              <p className="text-xs text-gray-400 animate-pulse px-1">Loading products...</p>
            )}
          </div>
        )}
      </section>

      {/* ── Etsy product list ── */}
      {etsy_products.length > 0 && !original_item && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">Sản phẩm Etsy nổi bật</h3>
            {etsy_products.length > 5 && (
              <button
                type="button"
                onClick={() => setVisibleEtsyCount(v => v === 5 ? etsy_products.length : 5)}
                className="text-xs font-semibold text-sky-600 hover:text-sky-700 bg-sky-50 px-3 py-1.5 rounded-full transition-colors"
              >
                {visibleEtsyCount === 5 ? `Xem tất cả ${etsy_products.length}` : "Thu gọn"}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">Chọn sản phẩm bạn muốn để AI tạo bộ từ khoá và crawl mạng xã hội (Pinterest, IG...):</p>
          <div className="flex flex-col gap-2">
            {etsy_products.slice(0, visibleEtsyCount).map((p, i) => {
              const pid = p.id || p.product_id || p.title;
              const checked = selectedEtsyIds.has(pid);
              return (
                <label key={i} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${checked ? "border-sky-400 bg-sky-50 shadow-sm ring-1 ring-sky-100" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input type="checkbox" checked={checked} className="accent-sky-500 w-4 h-4 shrink-0" onChange={() => {
                    setSelectedEtsyIds(prev => { const next = new Set(prev); checked ? next.delete(pid) : next.add(pid); return next; });
                  }} />
                  {p.image ? (
                    <img src={p.image} alt="" className="w-14 h-14 object-cover rounded-lg shrink-0 border border-gray-100 shadow-sm" />
                  ) : (
                    <div className="w-14 h-14 bg-gray-100 rounded-lg shrink-0 flex items-center justify-center text-gray-400 text-xs">No img</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${checked ? "text-sky-900" : "text-gray-800"}`}>{p.title || p.name || "Product"}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {p.monthly_sales && <span className="flex items-center gap-1">📈 {p.monthly_sales}/mo</span>}
                      {p.price && <span className="font-medium text-gray-700">${parseFloat(p.price).toFixed(2)}</span>}
                      {p.favorites && <span className="flex items-center gap-1">❤️ {p.favorites}</span>}
                    </div>
                  </div>
                </label>
              );
            })}
            
            {visibleEtsyCount === 5 && etsy_products.length > 5 && (
              <div className="flex justify-center mt-1">
                 <button type="button" onClick={() => setVisibleEtsyCount(etsy_products.length)} className="text-xs text-gray-400 font-medium hover:text-sky-600">
                    +{etsy_products.length - 5} sản phẩm khác...
                 </button>
              </div>
            )}

            {stagedKeywords.length === 0 ? (
              <button type="button" onClick={handlePrepareCrawl}
                disabled={selectedEtsyIds.size === 0 || generatingKeywords}
                className="self-start px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 transition-colors">
                {generatingKeywords ? "⏳ Đang tạo keyword với AI..." : `✨ Generate Keywords (${selectedEtsyIds.size} sp)`}
              </button>
            ) : (
              <div className="flex flex-col gap-3 p-4 border border-amber-200 bg-amber-50 rounded-xl mt-2 max-w-lg">
                <div className="text-sm font-bold text-amber-800">Review & Edit Keywords</div>
                {stagedKeywords.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <span className="text-xs text-amber-700 font-medium truncate" title={item.title}>{item.title}</span>
                    <input 
                      type="text" 
                      className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                      value={item.keyword}
                      onChange={(e) => {
                        const next = [...stagedKeywords];
                        next[idx].keyword = e.target.value;
                        setStagedKeywords(next);
                      }}
                    />
                  </div>
                ))}
                <div className="flex items-center gap-3 mt-2">
                  <button type="button" onClick={handleConfirmCrawl}
                    disabled={crawling}
                    className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                    {crawling ? "⏳ Đang thêm..." : "✅ Confirm & Add to Task Queue"}
                  </button>
                  <button type="button" onClick={() => setStagedKeywords([])}
                    disabled={crawling}
                    className="px-4 py-2 text-sm text-amber-700 hover:text-amber-900 hover:bg-amber-100 rounded-lg font-semibold transition-colors">
                    Hủy bỏ
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Manual upload modal ── */}
      <ManualUploadModal
        open={manualUploadOpen}
        onClose={() => setManualUploadOpen(false)}
        onConfirm={handleManualUploadConfirm}
        multiple={false}
      />

      {/* ── Crawl History → navigate to pick Original ── */}
      {!original_item && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleCrawlHistory}
              className="flex items-center gap-2 text-left group w-fit"
            >
            <span
              className="text-[10px] text-gray-400 transition-transform duration-150"
              style={{ display: "inline-block", transform: crawlOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            >▶</span>
            <h3 className="text-sm font-bold text-gray-700 group-hover:text-gray-900">📂 Crawl History</h3>
            {crawlHistoryLoading && <span className="text-xs text-sky-500 animate-pulse">Loading...</span>}
          </button>
            <button
              type="button"
              onClick={() => setManualUploadOpen(true)}
              className="flex items-center gap-1 text-xs font-medium text-violet-600 border border-violet-300 hover:bg-violet-50 px-2.5 py-1 rounded-lg transition-colors"
            >
              📷 Upload thủ công
            </button>
          </div>

          {crawlOpen && (
            <div className="flex flex-col gap-3 pl-4">
              <div className="flex justify-end">
                <button type="button" onClick={loadCrawlHistory} disabled={crawlHistoryLoading}
                  className="text-xs text-sky-500 hover:underline disabled:opacity-50">
                  ↻ Refresh
                </button>
              </div>

              {crawlHistory.length === 0 && !crawlHistoryLoading && (
                <div className="text-xs text-gray-400 italic bg-gray-50 rounded-xl px-4 py-3 text-center">
                  Chưa có lịch sử crawl. Thêm keyword vào Task Queue và chạy để crawl.
                </div>
              )}

              {crawlHistory.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {crawlHistory.map(h => {
                    const total = (h.pinterest || 0) + (h.instagram || 0) + (h.tiktok || 0) + (h.youtube || 0);
                    return (
                      <button key={h.id} type="button"
                        onClick={() => onNavigate?.("crawl", h.keyword, h.id, { projectId: project.id, projectName: project.name, mode: "pick-original" })}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-200 text-left text-sm hover:bg-emerald-50 hover:border-emerald-300 transition-all group">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 truncate group-hover:text-emerald-700">{h.keyword}</p>
                          <p className="text-xs text-gray-400">{h.created_at?.slice(0, 16).replace("T", " ")} · {total} pins</p>
                        </div>
                        {h.pinterest > 0 && <span className="text-xs bg-red-50 text-red-400 px-2 py-0.5 rounded-full shrink-0">📌 {h.pinterest}</span>}
                        {h.youtube > 0  && <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full shrink-0">▶ {h.youtube}</span>}
                        {h.tiktok > 0   && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">♪ {h.tiktok}</span>}
                        <span className="text-xs text-emerald-500 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Chọn pin →</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Original item (done) ── */}
      {original_item && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-emerald-700">✅ Original Product</h3>
          <div className="flex gap-4 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50">
            {(original_item.thumbnail || original_item.image_url) && (
              <img src={original_item.thumbnail || original_item.image_url} alt=""
                className="w-24 h-24 object-cover rounded-xl shrink-0 border border-emerald-200" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800">{original_item.title || original_item.name || "Original Item"}</p>
              <p className="text-xs text-gray-500 mt-1 truncate">{original_item.url || ""}</p>
              <p className="text-xs text-gray-400 mt-1">{original_item.source || ""}</p>
            </div>
            <button type="button"
              onClick={() => saveProject({ ...project, original: { ...original, original_item: null, status: "selecting" } })}
              className="text-xs text-gray-400 hover:text-red-500 self-start">✕ Đổi</button>
          </div>
          {hunt_keywords.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>📊 {hunt_keywords.length} keywords từ HEnull</span>
              <button type="button" onClick={() => onNavigate && onNavigate("hunt")} className="text-sky-600 hover:underline">Xem →</button>
            </div>
          )}
        </section>
      )}

      {original.status === "crawling" && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⏳ Đang crawl social trong queue. Khi hoàn thành, vào tab Crawl để xem kết quả rồi lưu vào phase này.
        </div>
      )}

      {/* ── Product Detail Modal ── */}
      {productDetailModalOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setProductDetailModalOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[1000px] max-w-full max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">🛍 {productDetail?.filename ?? "Loading..."}</p>
                {productDetail && (
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                    {productDetail.list.length} products
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {productDetail && (
                  <>
                    <button type="button" onClick={handleSaveProductToProject}
                      disabled={productSelectedIds.size === 0 || savingProducts}
                      className="px-3 py-1 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 disabled:opacity-50 transition-colors">
                      {savingProducts ? "⏳..." : `📥 Save to Project (${productSelectedIds.size})`}
                    </button>
                    <a href={`${API_BASE}/api/etsy_hunt/product_history/${productDetail.filename}/download`}
                      className="px-3 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors no-underline"
                      download>⬇ CSV</a>
                  </>
                )}
                <button type="button" onClick={() => setProductDetailModalOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1">✕</button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="px-5 py-2.5 border-b border-gray-100 shrink-0 flex items-center gap-3 flex-wrap">
              <input
                className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                placeholder="Lọc sản phẩm..."
                value={productFilter}
                onChange={e => setProductFilter(e.target.value)}
              />
              <span className="text-xs text-gray-400">
                {filteredProductRows.length} / {productDetail?.list.length ?? 0}
                {productSelectedIds.size > 0 && (
                  <span className="ml-2 text-sky-600 font-semibold">· {productSelectedIds.size} selected</span>
                )}
              </span>
              {saveProductsMsg && (
                <span className={`text-xs font-medium ${saveProductsMsg.startsWith("✅") ? "text-emerald-600" : "text-red-500"}`}>
                  {saveProductsMsg}
                </span>
              )}
            </div>

            {/* Table */}
            {productDetailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
              </div>
            ) : productDetail && (
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-gray-50">
                    <tr>
                      <th className="w-9 px-2.5 py-2 border-b border-gray-200 text-center">
                        <input type="checkbox" className="cursor-pointer accent-sky-500"
                          checked={allProductFilteredSelected}
                          onChange={e => setProductSelectedIds(e.target.checked
                            ? new Set(filteredProductRows.map(r => r.id || r.product_id || r.title))
                            : new Set()
                          )}
                        />
                      </th>
                      <th className="w-10 px-2 py-2 border-b border-gray-200 text-right text-gray-400">#</th>
                      <th className="px-3 py-2 border-b border-gray-200 text-left font-semibold text-gray-700" style={{ minWidth: 320 }}>Product</th>
                      {[
                        { col: "monthly_sales", label: "7-Day Sales" },
                        { col: "sales_total",   label: "Total Sales" },
                        { col: "reviews",       label: "Reviews" },
                        { col: "favorites",     label: "Favorites" },
                        { col: "views",         label: "Views" },
                      ].map(({ col, label }) => (
                        <th key={col}
                          onClick={() => setProductSort(s => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }))}
                          className="px-3 py-2 border-b border-gray-200 text-right cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap font-semibold text-gray-700">
                          {label} {productSort.col === col ? (productSort.dir === "desc" ? "▼" : "▲") : "↕"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProductRows.map((r, i) => {
                      const uid = r.id || r.product_id || r.title || String(i);
                      const checked = productSelectedIds.has(uid);
                      const bg = i % 2 === 0 ? "bg-white" : "bg-gray-50";
                      const tags = Array.isArray(r.tags) ? r.tags : [];
                      return (
                        <tr key={uid} className={`${bg} cursor-pointer hover:bg-sky-50 ${checked ? "!bg-sky-50" : ""}`}
                          onClick={() => setProductSelectedIds(prev => {
                            const next = new Set(prev);
                            checked ? next.delete(uid) : next.add(uid);
                            return next;
                          })}>
                          <td className="px-2.5 py-2 border-b border-gray-100 text-center">
                            <input type="checkbox" checked={checked} readOnly className="accent-sky-500 pointer-events-none" />
                          </td>
                          <td className="px-2 py-2 border-b border-gray-100 text-right text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2 border-b border-gray-100">
                            <div className="flex items-center gap-2.5">
                              {(r.logo_url || r.image)
                                ? <img src={r.logo_url || r.image} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
                                : <div className="w-10 h-10 bg-gray-100 rounded shrink-0 flex items-center justify-center text-gray-300 text-lg">📷</div>
                              }
                              <div className="min-w-0">
                                <p className="font-medium text-gray-800 line-clamp-2 leading-tight">{r.title || r.name || ""}</p>
                                {tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {tags.slice(0, 4).map((t, ti) => (
                                      <span key={ti} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t}</span>
                                    ))}
                                    {tags.length > 4 && <span className="text-[10px] text-gray-400">+{tags.length - 4}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          {["monthly_sales", "sales_total", "reviews", "favorites", "views"].map(col => (
                            <td key={col} className="px-3 py-2 border-b border-gray-100 text-right text-gray-600 whitespace-nowrap">
                              {r[col] != null ? Number(r[col]).toLocaleString() : "—"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
