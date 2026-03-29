import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, HUNT_FILTERS, PRODUCT_FILTERS, CLASSIFY_FILTERS } from "../constants";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { LoadingOverlay } from "../components/ui/loading-overlay";
import { Spinner } from "../components/ui/spinner";

/** Delay (ms) giữa mỗi keyword khi crawl nhiều keyword — tránh bị block / phát hiện bot */
const CRAWL_KEYWORD_DELAY_MS = 6000;
/** Poll mỗi N ms để kiểm tra HEnull script đã lưu CSV xong chưa */
const HENULL_POLL_INTERVAL_MS = 10000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const PRODUCT_SORT_OPTIONS = [
  { value: "1:1", label: "Monthly Sales ↓" },
  { value: "1:0", label: "Monthly Sales ↑" },
  { value: "2:1", label: "Favorites ↓" },
  { value: "3:1", label: "Reviews ↓" },
  { value: "4:1", label: "Total Sales ↓" },
];

export default function HuntPage({ setResult, loadHistory }) {
  const [huntTab, setHuntTab] = useState("keyword"); // "keyword" | "product"

  // ── Keyword DB state ──────────────────────────────────────────────────────
  const [huntHistory, setHuntHistory] = useState([]);
  const [huntHistoryLoading, setHuntHistoryLoading] = useState(false);
  const [huntDetail, setHuntDetail] = useState(null);
  const [huntDetailLoading, setHuntDetailLoading] = useState(false);
  const [huntFilter, setHuntFilter] = useState("");
  const [huntSort, setHuntSort] = useState({ col: "", dir: "desc" });
  const [huntSelectedRowIds, setHuntSelectedRowIds] = useState(() => new Set());
  const [huntFilters, setHuntFilters] = useState({});
  const [huntOpenFilter, setHuntOpenFilter] = useState(null);
  const [huntDraft, setHuntDraft] = useState({});
  const [classifyFilters, setClassifyFilters] = useState({});
  const [classifyOpenFilter, setClassifyOpenFilter] = useState(null);
  const [classifyDraft, setClassifyDraft] = useState({});
  const [classifySort, setClassifySort] = useState({ col: "", dir: "desc" });
  const [huntCrawling, setHuntCrawling] = useState(false);
  const [huntCrawlProgress, setHuntCrawlProgress] = useState({ current: 0, total: 0, keyword: "", waiting: false });
  const [huntHistoryModalOpen, setHuntHistoryModalOpen] = useState(false);
  const [henullOverlayVisible, setHenullOverlayVisible] = useState(false);
  const [henullOverlayMode, setHenullOverlayMode] = useState(null); // "instructions" only (no "running")
  const [henullStarting, setHenullStarting] = useState(false);
  const [henullCompleteNotice, setHenullCompleteNotice] = useState(null);
  const [henullWatching, setHenullWatching] = useState(false);
  const [henullStatusState, setHenullStatusState] = useState("idle"); // "idle" | "crawling" (từ script etsy_hunt)
  const henullPollRef = useRef({ intervalId: null, lastSeenNewest: null, tick: 0 });
  const productCrawlingRef = useRef(false); // true while etsy_hunt is crawling products

  // ── Product DB state ──────────────────────────────────────────────────────
  const [productSearchKey, setProductSearchKey] = useState("");
  const [productSortStr, setProductSortStr] = useState("1:1"); // "sort_by:desc"
  const [productPageNum, setProductPageNum] = useState(1);
  const [productResults, setProductResults] = useState(null); // {code, data:{product_num, list}}
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState(null);
  const [productFilters, setProductFilters] = useState({});
  const [productReleaseTime, setProductReleaseTime] = useState("");
  const [productCountry, setProductCountry] = useState("");
  const [productLabels, setProductLabels] = useState([]);
  const [productProductTypes, setProductProductTypes] = useState([]);
  const [productHistory, setProductHistory] = useState([]);
  const [productHistoryLoading, setProductHistoryLoading] = useState(false);
  const [productHistoryModalOpen, setProductHistoryModalOpen] = useState(false);
  const [productLoadedFilename, setProductLoadedFilename] = useState(null);
  const [productSort, setProductSort] = useState({ col: null, dir: "desc" });
  const [productTagModal, setProductTagModal] = useState(null); // array of tags to show

  const handleOpenHenull = async () => {
    setHenullStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/open_henull`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.novnc_url) window.open(data.novnc_url, "_blank");
        setHenullOverlayVisible(true);
        setHenullOverlayMode("instructions");
      }
    } catch (_) {
    } finally {
      setHenullStarting(false);
    }
  };

  /** Đóng overlay, bắt đầu polling; không giữ overlay "đang chạy" vì lúc nào script thực sự crawl (sau khi user search) frontend không biết. */
  const dismissHenullOverlayAndStartWatching = async () => {
    setHenullOverlayVisible(false);
    setHenullOverlayMode(null);
    setHenullCompleteNotice(null);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history`);
      const list = await res.json();
      henullPollRef.current.lastSeenNewest = list?.[0]?.filename ?? null;
    } catch (_) {
      henullPollRef.current.lastSeenNewest = null;
    }
    setHenullWatching(true);
  };

  const loadHuntHistory = async () => {
    setHuntHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history`);
      setHuntHistory(await res.json());
    } catch (_) {}
    setHuntHistoryLoading(false);
  };

  const loadProductHistory = async () => {
    setProductHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/product_history`);
      setProductHistory(await res.json());
    } catch (_) {}
    setProductHistoryLoading(false);
  };

  const loadProductHistoryDetail = async (filename) => {
    setProductHistoryModalOpen(false);
    setProductLoading(true);
    setProductError(null);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/product_history/${filename}`);
      const data = await res.json();
      const NUM_FIELDS = ["price", "sales_total", "monthly_sales", "reviews", "favorites",
        "store_rating", "reviews_weekly", "favorites_weekly", "reviews_month", "favorites_month", "total_sales"];
      const list = (data.rows || []).map((r) => {
        const item = { ...r };
        NUM_FIELDS.forEach((f) => { if (item[f] !== undefined && item[f] !== "") item[f] = Number(item[f]) || 0; });
        if (item.tags && typeof item.tags === "string") {
          try { item.tags = JSON.parse(item.tags); } catch (_) { item.tags = item.tags.split("|").map((t) => t.trim()).filter(Boolean); }
        }
        return item;
      });
      const nameMatch = filename.match(/etsy_products_(.+?)_\d{8}_\d{6}\.csv$/);
      const searchKey = nameMatch ? nameMatch[1] : filename.replace(".csv", "");
      setProductResults({ data: { product_num: list.length, list }, search_key: searchKey });
      setProductLoadedFilename(filename);
    } catch (_) {
      setProductError("Không thể tải file lịch sử.");
    }
    setProductLoading(false);
  };

  const deleteProductHistory = async (filename) => {
    if (!window.confirm(`Xóa "${filename}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/etsy_hunt/product_history/${filename}`, { method: "DELETE" });
      if (productLoadedFilename === filename) { setProductResults(null); setProductLoadedFilename(null); }
      await loadProductHistory();
    } catch (_) {}
  };

  const deleteHuntHistory = async (filename) => {
    if (!window.confirm(`Xóa "${filename}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}`, { method: "DELETE" });
      if (huntDetail?.filename === filename) setHuntDetail(null);
      await loadHuntHistory();
    } catch (_) {}
  };

  const [classifyingFile, setClassifyingFile] = useState(null);
  const [classifyResult, setClassifyResult] = useState(null); // {filename, rows}

  const handleClassify = async (filename) => {
    setClassifyingFile(filename);
    setClassifyResult(null);
    setHuntHistoryModalOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}/classify`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setClassifyResult(data);
    } catch (e) {
      alert(`Phân loại thất bại: ${e.message}`);
    } finally {
      setClassifyingFile(null);
    }
  };

  const loadHuntDetail = async (filename) => {
    setHuntDetailLoading(true);
    setHuntDetail(null);
    setHuntFilter("");
    setHuntSort({ col: "", dir: "desc" });
    setHuntSelectedRowIds(new Set());
    setClassifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}`);
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const withId = rows.map((r, idx) => ({ ...r, _rowId: `${filename}::${idx}` }));
      setHuntDetail({ ...data, rows: withId });

      // Auto-load saved classification if exists
      const clsRes = await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}/classify`);
      if (clsRes.ok) {
        setClassifyResult(await clsRes.json());
      }
    } catch (_) {}
    setHuntDetailLoading(false);
  };

  const toggleHuntRow = (rowId) => {
    setHuntSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const handleCrawlSelected = async () => {
    if (!huntDetail || huntSelectedRowIds.size === 0) return;
    const selectedKeywords = huntDetail.rows
      .filter((r) => huntSelectedRowIds.has(r._rowId))
      .map((r) => r.keyword)
      .filter(Boolean);
    if (selectedKeywords.length === 0) return;

    setHuntCrawling(true);
    setHuntCrawlProgress({ current: 0, total: selectedKeywords.length, keyword: "" });

    for (let i = 0; i < selectedKeywords.length; i++) {
      const kw = selectedKeywords[i];
      setHuntCrawlProgress({ current: i + 1, total: selectedKeywords.length, keyword: kw, waiting: false });
      try {
        await fetch(`${API_BASE}/api/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: kw }),
        });
      } catch (_) {}
    }

    setHuntCrawling(false);
    setHuntCrawlProgress({ current: 0, total: 0, keyword: "", waiting: false });
    alert("✅ Toàn bộ keyword đã được thêm vào hàng đợi xử lý tuần tự!");
  };

  useEffect(() => { loadHuntHistory(); loadProductHistory(); }, []);

  useEffect(() => {
    if (!henullWatching) return;
    const poll = async () => {
      try {
        const statusRes = await fetch(`${API_BASE}/api/etsy_hunt/status`);
        const statusData = await statusRes.json();
        const state = statusData.state;
        if (state === "crawling_products") {
          productCrawlingRef.current = true;
          setProductLoading(true);
          setHenullStatusState("crawling_products");
        } else {
          setHenullStatusState(state === "crawling" ? "crawling" : "idle");
          if (productCrawlingRef.current && state === "idle") {
            productCrawlingRef.current = false;
            setProductLoading(false);
            loadProductResults();
            loadProductHistory();
          }
        }

        henullPollRef.current.tick = (henullPollRef.current.tick || 0) + 1;
        const every = Math.max(1, HENULL_POLL_INTERVAL_MS / 2000);
        if (henullPollRef.current.tick % every === 0) {
          const historyRes = await fetch(`${API_BASE}/api/etsy_hunt/history`);
          const list = await historyRes.json();
          const newest = list?.[0]?.filename ?? null;
          if (newest && newest !== henullPollRef.current.lastSeenNewest) {
            setHenullCompleteNotice({ filename: list[0].filename, created_at: list[0].created_at });
            setHenullWatching(false);
            setHenullStatusState("idle");
            loadHuntHistory();
          }
        }
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, 2000);
    henullPollRef.current.intervalId = id;
    return () => {
      clearInterval(henullPollRef.current.intervalId);
      henullPollRef.current.intervalId = null;
      henullPollRef.current.tick = 0;
    };
  }, [henullWatching]);

  const huntActiveFilterCount = Object.keys(huntFilters).length;

  // ── Product DB helpers ──────────────────────────────────────────────────────
  const loadProductResults = async () => {
    setProductLoading(true);
    setProductError(null);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/product_results`);
      if (res.ok) {
        const data = await res.json();
        setProductResults({ data: { product_num: data.total, list: data.list }, search_key: data.search_key });
        setProductSearchKey(data.search_key || "");
      } else if (res.status !== 404) {
        const err = await res.json().catch(() => ({}));
        setProductError(err.detail || `Lỗi ${res.status}`);
      }
    } catch (_) {}
    setProductLoading(false);
  };

  // Auto-load removed — products are only loaded via history click or active crawl.

  const searchProducts = async (page = 1) => {
    const [sortBy, descVal] = productSortStr.split(":").map(Number);
    setProductLoading(true);
    setProductError(null);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_key: productSearchKey.trim(),
          category: "", price: "", sales_weekly: "", sales: "",
          favorites: "", favorites_weekly: "", reviews: "", reviews_weekly: "",
          product_type: "", is_raving: 0, is_pick: 0, is_bestsell: 0,
          listed_time: "", country: "",
          is_first: page === 1 ? "true" : "false",
          currency_code: "USD", is_batch: 0,
          sort_by: sortBy, desc: descVal,
          page_num: page, page_size: 20, is_switch_view: "false",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setProductError(err.detail || `Lỗi ${res.status}`);
      } else {
        const data = await res.json();
        setProductResults(data);
        setProductPageNum(page);
      }
    } catch (e) {
      setProductError(String(e));
    } finally {
      setProductLoading(false);
    }
  };

  const productActiveFilterCount = Object.keys(productFilters).length + (productReleaseTime ? 1 : 0) + (productCountry ? 1 : 0) + productLabels.length + productProductTypes.length;

  const productFilteredRows = useMemo(() => {
    const list = productResults?.data?.list ?? productResults?.list ?? [];
    if (!list.length) return list;
    let rows = list;
    for (const [key, [min, max]] of Object.entries(productFilters)) {
      rows = rows.filter((r) => {
        const v = parseFloat(r[key]) || 0;
        if (min != null && v < min) return false;
        if (max != null && v > max) return false;
        return true;
      });
    }
    if (productReleaseTime) {
      const days = parseInt(productReleaseTime, 10);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      rows = rows.filter((r) => {
        if (!r.release_time) return true;
        const d = new Date(r.release_time);
        return !isNaN(d.getTime()) && d >= cutoff;
      });
    }
    if (productCountry) {
      rows = rows.filter((r) => r.ships_from === productCountry);
    }
    if (productLabels.includes("Etsy Pick")) {
      rows = rows.filter((r) => r.is_pick === 1 || r.is_pick === "1");
    }
    if (productLabels.includes("BestSeller")) {
      rows = rows.filter((r) => r.is_bestsell === 1 || r.is_bestsell === "1");
    }
    if (productProductTypes.length > 0) {
      rows = rows.filter((r) => {
        const h = (r.hightlights || "").toLowerCase();
        const isDigital = h.includes("digital download");
        const t = isDigital ? "Digital" : "Physical";
        return productProductTypes.includes(t);
      });
    }
    if (productSort.col) {
      rows = [...rows].sort((a, b) => {
        const va = parseFloat(a[productSort.col]) || 0;
        const vb = parseFloat(b[productSort.col]) || 0;
        return productSort.dir === "asc" ? va - vb : vb - va;
      });
    }
    return rows;
  }, [productResults, productFilters, productReleaseTime, productCountry, productLabels, productProductTypes, productSort]);

  const productAvailableCountries = useMemo(() => {
    const list = productResults?.data?.list ?? productResults?.list ?? [];
    const set = new Set(list.map((p) => p.ships_from).filter(Boolean));
    return [...set].sort();
  }, [productResults]);

  const huntFilteredRows = useMemo(() => {
    if (!huntDetail) return [];
    let rows = huntDetail.rows;
    if (huntFilter.trim()) {
      const q = huntFilter.toLowerCase();
      rows = rows.filter((r) => (r.keyword || "").toLowerCase().includes(q));
    }
    for (const [key, [min, max]] of Object.entries(huntFilters)) {
      rows = rows.filter((r) => {
        const v = parseFloat(r[key]) || 0;
        if (min != null && v < min) return false;
        if (max != null && v > max) return false;
        return true;
      });
    }
    if (huntSort.col) {
      rows = [...rows].sort((a, b) => {
        const va = parseFloat(a[huntSort.col]) || 0;
        const vb = parseFloat(b[huntSort.col]) || 0;
        return huntSort.dir === "asc" ? va - vb : vb - va;
      });
    }
    return rows;
  }, [huntDetail, huntFilter, huntFilters, huntSort]);

  const classifyActiveFilterCount = Object.keys(classifyFilters).length;

  const classifyFilteredRows = useMemo(() => {
    if (!classifyResult) return [];
    let rows = classifyResult.rows;
    if (huntFilter.trim()) {
      const q = huntFilter.toLowerCase();
      rows = rows.filter((r) => (r.keyword || "").toLowerCase().includes(q));
    }
    for (const [key, [min, max]] of Object.entries(classifyFilters)) {
      rows = rows.filter((r) => {
        const v = parseFloat(r[key]) || 0;
        if (min != null && v < min) return false;
        if (max != null && v > max) return false;
        return true;
      });
    }
    if (classifySort.col) {
      rows = [...rows].sort((a, b) => {
        const va = parseFloat(a[classifySort.col]) || 0;
        const vb = parseFloat(b[classifySort.col]) || 0;
        return classifySort.dir === "asc" ? va - vb : vb - va;
      });
    }
    return rows;
  }, [classifyResult, huntFilter, classifyFilters, classifySort]);

  return (
    <div className="p-4">
      {/* Loading overlay — crawling multiple keywords */}
      {huntCrawling && (
        <LoadingOverlay
          title={
            huntCrawlProgress.waiting
              ? `Đang chờ ${Math.round(CRAWL_KEYWORD_DELAY_MS / 1000)}s trước keyword tiếp theo...`
              : `Đang crawl ${huntCrawlProgress.current}/${huntCrawlProgress.total}${huntCrawlProgress.keyword ? ` — "${huntCrawlProgress.keyword}"` : ""}`
          }
          subtitle="Vui lòng chờ, không thao tác thêm."
          spinnerColor="#10b981"
        />
      )}

      {/* Loading overlay — crawling products from HEnull */}
      {henullStatusState === "crawling_products" && (
        <LoadingOverlay
          title="Script HEnull đang crawl sản phẩm..."
          subtitle="Crawl p=1 → p=100 (xem tiến trình trong terminal). Sẽ tự đóng khi xong."
          spinnerColor="#6366f1"
        />
      )}

      {/* Henull overlay */}
      {(henullStarting || henullOverlayVisible || (henullWatching && henullStatusState === "crawling")) && (
        <div
          className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center"
          style={{ cursor: henullStarting || henullStatusState === "crawling" ? "wait" : "default" }}
          role="dialog" aria-modal="true" aria-labelledby="henull-overlay-title"
        >
          <div
            className="bg-white rounded-2xl px-8 py-7 shadow-2xl text-center"
            style={{ maxWidth: henullWatching && henullStatusState === "crawling" ? "380px" : "420px", pointerEvents: henullStatusState === "crawling" ? "none" : "auto" }}
          >
            {henullStarting ? (
              <>
                <Spinner className="mx-auto mb-4" />
                <p id="henull-overlay-title" className="text-base font-semibold text-gray-900">Đang khởi chạy HEnull...</p>
              </>
            ) : henullWatching && henullStatusState === "crawling" ? (
              <>
                <Spinner className="mx-auto mb-4" />
                <p id="henull-overlay-title" className="text-base font-semibold text-gray-900 mb-2">Script HEnull đang chạy</p>
                <p className="text-sm text-gray-700 mb-2">Crawl p=1 → p=100 (xem tiến trình trong terminal).</p>
                <p className="text-sm text-gray-500">Vui lòng chờ. Sẽ tự đóng khi crawl xong và lưu CSV.</p>
              </>
            ) : (
              <>
                <p id="henull-overlay-title" className="text-lg font-bold text-gray-900 mb-3">Đã khởi chạy HEnull (Etsy Hunt)</p>
                <div className="text-sm text-gray-700 text-left mb-4 leading-relaxed">
                  Tab noVNC vừa mở — đây là màn hình VPS. Làm lần lượt:
                  <ul className="mt-2 ml-4 list-disc space-y-1">
                    <li>Bấm <b>Connect</b>, nhập mật khẩu: <b className="text-violet-600 select-all">123456</b></li>
                    <li>Đăng nhập HEnull trong browser trên màn hình VPS</li>
                    <li>Vào Etsy Keyword Tool và search keyword</li>
                    <li>Script sẽ tự bắt API → đóng browser → crawl p=1..100 và lưu CSV</li>
                  </ul>
                  Bấm &quot;Đã hiểu&quot; để đóng. Overlay sẽ hiện lại khi script bắt đầu crawl (vòng for).
                </div>
                <Button variant="sky" onClick={dismissHenullOverlayAndStartWatching}>Đã hiểu</Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Complete notice */}
      {henullCompleteNotice && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-emerald-800 font-semibold">
            ✅ Crawl xong! Đã lưu: {henullCompleteNotice.filename}
            {henullCompleteNotice.created_at && (
              <span className="font-normal text-emerald-700 ml-1.5">({henullCompleteNotice.created_at})</span>
            )}
          </p>
          <Button variant="outline" size="xs" onClick={() => setHenullCompleteNotice(null)}>Đóng</Button>
        </div>
      )}

      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {[{ key: "keyword", label: "🔑 Keyword DB" }, { key: "product", label: "🛍 Product DB" }].map((tab) => (
          <button
            key={tab.key} type="button"
            onClick={() => setHuntTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              huntTab === tab.key
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >{tab.label}</button>
        ))}
      </div>

      {/* ── KEYWORD TAB ─────────────────────────────────────────────────────── */}
      {huntTab === "keyword" && (<>
      {/* Open HEnull + History button */}
      <div className="mb-4 flex gap-2 items-center flex-wrap">
        <Button variant="sky" disabled={henullStarting} onClick={handleOpenHenull}>
          {henullStarting ? "Đang mở..." : "Mở HEnull (Etsy Hunt)"}
        </Button>
        <Button
          variant="outline"
          onClick={() => { setHuntHistoryModalOpen(true); loadHuntHistory(); }}
        >
          📂 Lịch sử
          {huntHistory.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{huntHistory.length}</span>
          )}
        </Button>
        <button
          type="button"
          onClick={() => {
            if (huntDetail) {
              handleClassify(huntDetail.filename);
            } else {
              setHuntHistoryModalOpen(true);
              loadHuntHistory();
            }
          }}
          disabled={!!classifyingFile}
          className="px-3 py-1.5 rounded-full border border-violet-300 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold flex items-center gap-1"
        >
          {classifyingFile ? "⏳ Đang phân loại..." : "🤖 AI Classify"}
        </button>
        <span className="text-xs text-gray-500">
          Đăng nhập HEnull, search keyword, script tự crawl p=1..100 và lưu CSV.
        </span>
      </div>

      {/* History modal */}
      {huntHistoryModalOpen && (
        <div
          className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setHuntHistoryModalOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold text-gray-900">Lịch sử Etsy keyword</p>
                {huntHistory.length > 0 && (
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{huntHistory.length}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="xs" onClick={loadHuntHistory} disabled={huntHistoryLoading}>
                  {huntHistoryLoading ? "Đang tải..." : "Tải lại"}
                </Button>
                <button
                  type="button" onClick={() => setHuntHistoryModalOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-lg leading-none cursor-pointer px-1"
                >✕</button>
              </div>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto flex-1 p-4">
              {huntHistoryLoading && huntHistory.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">Đang tải...</p>
              ) : huntHistory.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">Chưa có lịch sử nào.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {huntHistory.map((item) => {
                    const isActive = huntDetail?.filename === item.filename;
                    const nameMatch = item.filename.match(/etsy_keywords_(.+?)_(\d{8}_\d{6})\.csv$/);
                    const displayName = nameMatch ? nameMatch[1] : item.filename.replace(".csv", "");
                    const displayDate = nameMatch
                      ? (() => { const d = nameMatch[2]; return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} ${d.slice(9,11)}:${d.slice(11,13)}`; })()
                      : item.created_at;
                    return (
                      <div
                        key={item.filename}
                        className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-all ${
                          isActive ? "border-sky-400 bg-sky-50" : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <button
                          type="button"
                          className="flex-1 text-left cursor-pointer min-w-0"
                          onClick={() => { loadHuntDetail(item.filename); setHuntHistoryModalOpen(false); }}
                        >
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-sky-700" : "text-gray-900"}`}>{displayName}</p>
                          <p className="text-[0.68rem] text-gray-400 mt-0.5">{displayDate} · {item.size_kb} KB</p>
                        </button>
                        <div className="flex gap-1.5 shrink-0">
                          <a
                            href={`${API_BASE}/api/etsy_hunt/history/${item.filename}/download`}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors no-underline cursor-pointer"
                            download
                          >CSV</a>
                          <button
                            type="button"
                            onClick={() => handleClassify(item.filename)}
                            disabled={classifyingFile === item.filename}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >{classifyingFile === item.filename ? "⏳" : "🤖 AI"}</button>
                          <button
                            type="button"
                            onClick={() => deleteHuntHistory(item.filename)}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
                          >Xóa</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Classify loading overlay */}
      {classifyingFile && (
        <div className="mx-4 mt-3 p-3 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-sm font-medium flex items-center gap-2">
          <span className="animate-spin">⏳</span>
          Đang phân loại từ khóa với AI... (có thể mất 1-2 phút)
        </div>
      )}

      {/* Classify Result Table */}
      {classifyResult && !classifyingFile && (() => {
        const NER_COLS = [
          "Màu sắc", "Kích thước", "Hoa văn", "Khác",
          "Chất liệu", "Tính năng/hiệu quả", "Đối tượng",
          "Phong cách/kiểu dáng", "Cảnh",
          "Từ theo mùa/sự kiện đặc biệt", "Dòng sản phẩm/mô hình bổ sung",
        ];
        const METRIC_COLS = ["keyword", "score", "is_long_tail", "favorites", "competition", "sales"];
        return (
          <div className="mx-4 mt-4 mb-6">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-gray-800 whitespace-nowrap">🤖 Kết quả phân loại AI</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">{classifyResult.filename} · {classifyFilteredRows.length}/{classifyResult.total} từ khóa</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={huntFilter}
                  onChange={(e) => setHuntFilter(e.target.value)}
                  placeholder="Lọc từ khóa..."
                  className="text-xs border border-gray-200 rounded px-2 py-1 w-40 focus:outline-none focus:border-violet-400"
                />
                <button type="button" onClick={() => setClassifyResult(null)}
                  className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 whitespace-nowrap">✕ Đóng</button>
              </div>
            </div>
            <FilterBar
              huntFilters={classifyFilters} setHuntFilters={setClassifyFilters}
              huntOpenFilter={classifyOpenFilter} setHuntOpenFilter={setClassifyOpenFilter}
              huntDraft={classifyDraft} setHuntDraft={setClassifyDraft}
              huntActiveFilterCount={classifyActiveFilterCount}
              filtersConfig={CLASSIFY_FILTERS}
            />
            <div className="overflow-auto rounded-xl border border-gray-200 shadow-sm" style={{ maxHeight: "70vh" }}>
              <table className="text-[0.7rem] border-collapse w-full" style={{ minWidth: 1400 }}>
                <thead className="sticky top-0 z-10">
                  {/* Row 1: top-level groups */}
                  <tr>
                    <th rowSpan={3} className="border border-gray-300 bg-gray-100 px-2 py-1 text-center font-bold whitespace-nowrap">STT</th>
                    {METRIC_COLS.map(c => {
                      const sortable = c !== "keyword" && c !== "is_long_tail";
                      return (
                        <th key={c} rowSpan={3}
                          onClick={sortable ? () => setClassifySort((prev) => prev.col === c ? { col: c, dir: prev.dir === "desc" ? "asc" : "desc" } : { col: c, dir: "desc" }) : undefined}
                          className={`border border-gray-300 bg-gray-100 px-2 py-1 text-center font-bold whitespace-nowrap capitalize ${sortable ? "cursor-pointer select-none hover:bg-gray-200" : ""}`}>
                          {c}{sortable && classifySort.col === c ? (classifySort.dir === "desc" ? " ▼" : " ▲") : ""}
                        </th>
                      );
                    })}
                    <th colSpan={4} className="border border-gray-300 px-2 py-1 text-center font-bold" style={{ background: "#BDD7EE" }}>Thuộc tính biến thể</th>
                    <th colSpan={7} className="border border-gray-300 px-2 py-1 text-center font-bold" style={{ background: "#BDD7EE" }}>Từ khóa thuộc tính</th>
                  </tr>
                  {/* Row 2: sub-groups */}
                  <tr>
                    <th rowSpan={2} className="border border-gray-300 px-2 py-1 text-center font-semibold" style={{ background: "#FCE4D6" }}>Màu sắc</th>
                    <th colSpan={2} className="border border-gray-300 px-2 py-1 text-center font-semibold" style={{ background: "#FCE4D6" }}>Thông số kỹ thuật</th>
                    <th rowSpan={2} className="border border-gray-300 px-2 py-1 text-center font-semibold" style={{ background: "#FCE4D6" }}>Khác</th>
                    {["Chất liệu","Tính năng/hiệu quả","Đối tượng","Phong cách/kiểu dáng","Cảnh","Từ theo mùa/sự kiện đặc biệt","Dòng sản phẩm/mô hình bổ sung"].map(c => (
                      <th key={c} rowSpan={2} className="border border-gray-300 px-2 py-1 text-center font-semibold whitespace-nowrap" style={{ background: "#FCE4D6" }}>{c}</th>
                    ))}
                  </tr>
                  {/* Row 3: leaf columns */}
                  <tr>
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold" style={{ background: "#D9D9D9" }}>Kích thước</th>
                    <th className="border border-gray-300 px-2 py-1 text-center font-semibold" style={{ background: "#D9D9D9" }}>Hoa văn</th>
                  </tr>
                </thead>
                <tbody>
                  {classifyFilteredRows.map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="border border-gray-200 px-2 py-1 text-center text-gray-400">{idx + 1}</td>
                      {METRIC_COLS.map(c => (
                        <td key={c} className="border border-gray-200 px-2 py-1 text-gray-700 whitespace-nowrap">{row[c] ?? ""}</td>
                      ))}
                      {NER_COLS.map(attr => (
                        <td key={attr} className={`border border-gray-200 px-2 py-1 text-center ${row[attr] ? "text-violet-700 font-medium" : "text-gray-300"}`}>
                          {row[attr] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Hunt Detail */}
      {huntDetailLoading && (
        <p className="text-xs text-gray-400 py-3">Đang tải dữ liệu...</p>
      )}

      {huntDetail && !huntDetailLoading && !classifyResult && (() => {
        const cols = huntDetail.rows.length > 0 ? Object.keys(huntDetail.rows[0]) : [];
        const numCols = cols.filter((c) => c !== "keyword" && c !== "_rowId");
        const CHECK_W = 42;
        const STT_W = 56;
        const KEY_LEFT = CHECK_W + STT_W;
        const allVisibleSelected =
          huntFilteredRows.length > 0 &&
          huntFilteredRows.every((r) => huntSelectedRowIds.has(r._rowId));
        const toggleAllVisible = () => {
          setHuntSelectedRowIds((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) {
              huntFilteredRows.forEach((r) => next.delete(r._rowId));
            } else {
              huntFilteredRows.forEach((r) => next.add(r._rowId));
            }
            return next;
          });
        };

        return (
          <div>
            {/* Detail header */}
            <div className="flex gap-2 items-center mb-3 flex-wrap">
              <p className="text-sm font-semibold text-gray-900">
                {huntDetail.filename} &mdash; {huntDetail.total} keywords
              </p>
              <Input
                type="text" placeholder="Lọc keyword..." value={huntFilter}
                onChange={(e) => setHuntFilter(e.target.value)}
                className="w-44"
              />
              <span className="text-xs text-gray-500">
                Hiển thị: {huntFilteredRows.length}
                {huntSelectedRowIds.size > 0 && (
                  <span className="ml-1.5 text-sky-500 font-semibold">| Đã chọn: {huntSelectedRowIds.size}</span>
                )}
              </span>
              {huntSelectedRowIds.size > 0 && (
                <Button variant="emerald" size="sm" disabled={huntCrawling} onClick={handleCrawlSelected}>
                  {huntCrawling
                    ? `⏳ Crawling ${huntCrawlProgress.current}/${huntCrawlProgress.total}...`
                    : `🔍 Crawl ${huntSelectedRowIds.size} keywords`}
                </Button>
              )}
              {huntCrawling && huntCrawlProgress.keyword && (
                <span className="text-xs text-gray-500">→ {huntCrawlProgress.keyword}</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleClassify(huntDetail.filename)}
                  disabled={!!classifyingFile}
                  className="px-3 py-1.5 rounded-full border border-violet-300 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                >
                  {classifyingFile === huntDetail.filename ? "⏳ Đang phân loại..." : "🤖 AI Classify"}
                </button>
                <a
                  href={`${API_BASE}/api/etsy_hunt/history/${huntDetail.filename}/download`}
                  className="px-3 py-1.5 rounded-full border border-gray-300 text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 no-underline transition-colors"
                >
                  Tải CSV
                </a>
              </div>
            </div>

            {/* Filter bar */}
            <FilterBar
              huntFilters={huntFilters} setHuntFilters={setHuntFilters}
              huntOpenFilter={huntOpenFilter} setHuntOpenFilter={setHuntOpenFilter}
              huntDraft={huntDraft} setHuntDraft={setHuntDraft}
              huntActiveFilterCount={huntActiveFilterCount}
            />

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-2.5 py-2 text-center border-b border-gray-200 sticky left-0 bg-gray-50 z-[3]" style={{ width: CHECK_W, minWidth: CHECK_W }}>
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="cursor-pointer" aria-label="Chọn tất cả" />
                    </th>
                    <th className="px-2.5 py-2 text-right border-b border-gray-200 sticky bg-gray-50 z-[2] whitespace-nowrap" style={{ left: CHECK_W, width: STT_W, minWidth: STT_W }}>#</th>
                    <th className="px-2.5 py-2 text-left border-b border-gray-200 sticky bg-gray-50 z-[1]" style={{ left: KEY_LEFT, minWidth: 200 }}>keyword</th>
                    {numCols.map((col) => (
                      <th key={col}
                        onClick={() => setHuntSort((prev) => prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" })}
                        className="px-2.5 py-2 text-right border-b border-gray-200 cursor-pointer whitespace-nowrap select-none hover:bg-gray-100">
                        {col} {huntSort.col === col ? (huntSort.dir === "desc" ? "▼" : "▲") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {huntFilteredRows.map((row, i) => {
                    const rowBg = i % 2 === 0 ? "bg-white" : "bg-gray-50";
                    return (
                      <tr key={row._rowId || i} className={rowBg}>
                        <td className={`px-2.5 py-1.5 border-b border-gray-100 text-center sticky left-0 z-[3] ${rowBg}`} style={{ width: CHECK_W, minWidth: CHECK_W }}>
                          <input type="checkbox" checked={huntSelectedRowIds.has(row._rowId)} onChange={() => toggleHuntRow(row._rowId)} className="cursor-pointer" />
                        </td>
                        <td className={`px-2.5 py-1.5 border-b border-gray-100 text-right sticky z-[2] whitespace-nowrap text-gray-400 ${rowBg}`} style={{ left: CHECK_W, width: STT_W, minWidth: STT_W }}>
                          {i + 1}
                        </td>
                        <td className={`px-2.5 py-1.5 border-b border-gray-100 sticky z-[1] font-medium ${rowBg}`} style={{ left: KEY_LEFT, minWidth: 200 }}>
                          {row.keyword || ""}
                        </td>
                        {numCols.map((col) => (
                          <td key={col} className="px-2.5 py-1.5 text-right border-b border-gray-100 whitespace-nowrap">
                            {isNaN(row[col]) ? row[col] : Number(row[col]).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      </>)}

      {/* ── PRODUCT TAB ─────────────────────────────────────────────────────── */}
      {huntTab === "product" && (
        <div>
          {/* Open HEnull + History */}
          <div className="mb-4 flex gap-2 items-center flex-wrap">
            <Button variant="sky" disabled={henullStarting} onClick={handleOpenHenull}>
              {henullStarting ? "Đang mở..." : "Mở HEnull (Etsy Hunt)"}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setProductHistoryModalOpen(true); loadProductHistory(); }}
            >
              📂 Lịch sử
              {productHistory.length > 0 && (
                <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{productHistory.length}</span>
              )}
            </Button>
            <span className="text-xs text-gray-500">Đăng nhập HEnull → vào Product Research → search sản phẩm. Script sẽ tự crawl và hiển thị kết quả.</span>
          </div>

          {/* Product history modal */}
          {productHistoryModalOpen && (
            <div
              className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
              onClick={(e) => { if (e.target === e.currentTarget) setProductHistoryModalOpen(false); }}
            >
              <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-gray-900">Lịch sử Etsy product</p>
                    {productHistory.length > 0 && (
                      <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{productHistory.length}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="xs" onClick={loadProductHistory} disabled={productHistoryLoading}>
                      {productHistoryLoading ? "Đang tải..." : "Tải lại"}
                    </Button>
                    <button
                      type="button" onClick={() => setProductHistoryModalOpen(false)}
                      className="text-gray-400 hover:text-gray-700 text-lg leading-none cursor-pointer px-1"
                    >✕</button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-4">
                  {productHistoryLoading && productHistory.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">Đang tải...</p>
                  ) : productHistory.length === 0 ? (
                    <p className="text-xs text-gray-400 py-4 text-center">Chưa có lịch sử nào.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {productHistory.map((item) => {
                        const nameMatch = item.filename.match(/etsy_products_(.+?)_(\d{8}_\d{6})\.csv$/);
                        const displayName = nameMatch ? nameMatch[1] : item.filename.replace(".csv", "");
                        const displayDate = nameMatch
                          ? (() => { const d = nameMatch[2]; return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} ${d.slice(9,11)}:${d.slice(11,13)}`; })()
                          : item.created_at;
                        const isActive = productLoadedFilename === item.filename;
                        return (
                          <div
                            key={item.filename}
                            className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-all ${
                              isActive ? "border-sky-400 bg-sky-50" : "border-gray-200 bg-white hover:bg-gray-50"
                            }`}
                          >
                            <button
                              type="button"
                              className="flex-1 text-left cursor-pointer min-w-0"
                              onClick={() => loadProductHistoryDetail(item.filename)}
                            >
                              <p className={`text-sm font-semibold truncate ${isActive ? "text-sky-700" : "text-gray-900"}`}>{displayName}</p>
                              <p className="text-[0.68rem] text-gray-400 mt-0.5">{displayDate} · {item.size_kb} KB</p>
                            </button>
                            <div className="flex gap-1.5 shrink-0">
                              <a
                                href={`${API_BASE}/api/etsy_hunt/product_history/${item.filename}/download`}
                                className="text-[0.68rem] px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors no-underline cursor-pointer"
                                download
                              >CSV</a>
                              <button
                                type="button"
                                onClick={() => deleteProductHistory(item.filename)}
                                className="text-[0.68rem] px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors cursor-pointer"
                              >Xóa</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {productError && (
            <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{productError}</div>
          )}

          {/* Loading spinner (only for quick loads, not the full crawl which has its own overlay) */}
          {productLoading && henullStatusState !== "crawling_products" && (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
              <Spinner className="w-4 h-4" />
              Đang tải sản phẩm...
            </div>
          )}

          {/* Results */}
          {!productLoading && productResults && (() => {
            const totalNum = productResults?.data?.product_num ?? productResults?.product_num ?? 0;
            const searchKeyLabel = productResults?.search_key || productSearchKey;
            return (
              <div>
                {/* Summary + filter bar + pagination */}
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <p className="text-sm text-gray-600">
                    {searchKeyLabel && <span className="mr-2 font-medium text-sky-700">"{searchKeyLabel}"</span>}
                    Tổng: <span className="font-semibold">{totalNum.toLocaleString()}</span> sản phẩm
                    {productActiveFilterCount > 0 && (
                      <span className="ml-2 text-sky-600">· Hiển thị: {productFilteredRows.length}</span>
                    )}
                  </p>
                </div>

                {/* Filter bar */}
                <ProductFilterBar
                  filters={productFilters}
                  setFilters={setProductFilters}
                  releaseTime={productReleaseTime}
                  setReleaseTime={setProductReleaseTime}
                  country={productCountry}
                  setCountry={setProductCountry}
                  labels={productLabels}
                  setLabels={setProductLabels}
                  productTypes={productProductTypes}
                  setProductTypes={setProductProductTypes}
                  availableCountries={productAvailableCountries}
                />

                {/* Product table */}
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 text-left border-b border-gray-200 font-semibold" style={{ minWidth: 380 }}>Product</th>
                        <th className="border-b border-gray-200" style={{ width: 8 }}></th>
                        {[
                          { col: "monthly_sales", label: "7-Day Sales" },
                          { col: "sales_total", label: "Total Sales" },
                        ].map(({ col, label }) => (
                          <th
                            key={col}
                            className="px-4 py-3 text-center border-b border-gray-200 whitespace-nowrap font-semibold cursor-pointer select-none hover:bg-gray-100 transition-colors"
                            style={{ minWidth: 110 }}
                            onClick={() => setProductSort(s => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }))}
                          >
                            {label}
                            <span className="ml-1 text-gray-400 font-normal">
                              {productSort.col === col ? (productSort.dir === "desc" ? "▼" : "▲") : "↕"}
                            </span>
                          </th>
                        ))}
                        {[
                          { col: "reviews", label: "Total Reviews", sub: "7-Day" },
                          { col: "favorites", label: "Total Favorites", sub: "7-Day" },
                        ].map(({ col, label, sub }) => (
                          <th
                            key={col}
                            className="px-4 py-3 text-center border-b border-gray-200 whitespace-nowrap font-semibold cursor-pointer select-none hover:bg-gray-100 transition-colors"
                            style={{ minWidth: 130 }}
                            onClick={() => setProductSort(s => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }))}
                          >
                            <div>{label}</div>
                            <div className="text-[0.62rem] font-normal text-gray-400 normal-case tracking-normal">({sub})</div>
                            <span className="text-gray-400 font-normal">
                              {productSort.col === col ? (productSort.dir === "desc" ? "▼" : "▲") : "↕"}
                            </span>
                          </th>
                        ))}
                        <th className="px-4 py-3 text-center border-b border-gray-200 font-semibold" style={{ width: 64 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productFilteredRows.map((p, i) => {
                        const tags = Array.isArray(p.tags) ? p.tags : [];
                        const wkBadge = (n) => {
                          const num = Number(n);
                          if (!num) return null;
                          return num > 0
                            ? <span className="ml-1 rounded px-1 py-0.5 text-[0.62rem]" style={{ background: "rgb(240,248,233)", color: "rgb(122,199,86)" }}>↑{num.toLocaleString()}</span>
                            : <span className="ml-1 rounded px-1 py-0.5 text-[0.62rem]" style={{ background: "rgb(255,240,240)", color: "rgb(220,80,80)" }}>↓{Math.abs(num).toLocaleString()}</span>;
                        };
                        let releaseDisplay = p.release_time || "";
                        if (releaseDisplay) {
                          const d = new Date(releaseDisplay);
                          if (!isNaN(d.getTime())) {
                            releaseDisplay = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                          }
                        }
                        return (
                          <tr key={p.product_id || i} className={`border-b border-gray-100 hover:bg-sky-50 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}>
                            {/* Product cell */}
                            <td className="px-4 py-3 align-top">
                              <div className="flex gap-3">
                                {p.logo_url ? (
                                  <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                                    <img src={p.logo_url} alt="" style={{ width: 65, height: 65 }} className="object-cover rounded border border-gray-100" loading="lazy" />
                                  </a>
                                ) : <div style={{ width: 65, height: 65, flexShrink: 0 }} className="rounded border border-gray-100 bg-gray-100" />}
                                <div className="flex flex-col gap-1 min-w-0">
                                  <a
                                    href={p.product_url} target="_blank" rel="noopener noreferrer"
                                    className="text-sky-700 hover:underline font-medium line-clamp-2 leading-snug text-sm"
                                    title={p.title}
                                  >{p.title}</a>
                                  <div className="flex flex-wrap gap-1 items-center">
                                    {(p.is_bestsell === 1 || p.is_bestsell === "1") && (
                                      <span className="rounded px-1.5 py-0.5 text-[0.62rem] font-semibold" style={{ background: "rgb(255,243,224)", color: "rgb(215,135,0)" }}>BestSeller</span>
                                    )}
                                    {(p.is_pick === 1 || p.is_pick === "1") && (
                                      <span className="rounded px-1.5 py-0.5 text-[0.62rem] font-semibold" style={{ background: "rgb(232,244,255)", color: "rgb(37,130,210)" }}>Etsy Pick</span>
                                    )}
                                    {tags.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setProductTagModal(tags)}
                                        className="rounded px-1.5 py-0.5 text-[0.62rem] bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap"
                                      >🏷️ {tags.length} tags</button>
                                    )}
                                    {p.ships_from && (
                                      <span className="rounded px-1.5 py-0.5 text-[0.62rem] bg-blue-50 text-blue-500">{p.ships_from}</span>
                                    )}
                                    {p.store_name && (
                                      <span className="rounded px-1.5 py-0.5 text-[0.62rem] bg-purple-50 text-purple-500 max-w-[120px] truncate">{p.store_name}</span>
                                    )}
                                  </div>
                                  <div className="font-semibold text-sm" style={{ color: "#7a8dba" }}>
                                    {p.price ? `$${Number(p.price).toFixed(2)}` : ""}
                                    {p.currency_code && p.currency_code !== "USD" && (
                                      <span className="text-xs ml-1 text-gray-400">{p.currency_code}</span>
                                    )}
                                  </div>
                                  {releaseDisplay && (
                                    <div className="text-[0.65rem] text-gray-400">Release on: {releaseDisplay}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            {/* Spacer */}
                            <td></td>
                            {/* 7-Day Sales */}
                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap font-semibold text-gray-700">
                              {Number(p.monthly_sales).toLocaleString()}
                            </td>
                            {/* Total Sales */}
                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap font-semibold text-gray-700">
                              {Number(p.sales_total).toLocaleString()}
                            </td>
                            {/* Total Reviews + 7-day badge */}
                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                              <span className="font-semibold text-gray-700">{Number(p.reviews).toLocaleString()}</span>
                              {wkBadge(p.reviews_weekly)}
                            </td>
                            {/* Total Favorites + 7-day badge */}
                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                              <span className="font-semibold text-gray-700">{Number(p.favorites).toLocaleString()}</span>
                              {wkBadge(p.favorites_weekly)}
                            </td>
                            {/* Action */}
                            <td className="px-4 py-3 text-center align-middle">
                              {p.product_url && (
                                <a
                                  href={p.product_url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center text-gray-400 hover:text-sky-600 transition-colors"
                                  title="Open on Etsy"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                  </svg>
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {productFilteredRows.length === 0 && (
                        <tr><td colSpan={7} className="py-10 text-center text-sm text-gray-400">No products found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

              </div>
            );
          })()}
        </div>
      )}

      {/* Tag modal */}
      {productTagModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setProductTagModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800 text-sm">Tags ({productTagModal.length})</h3>
              <button
                type="button"
                onClick={() => setProductTagModal(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer"
              >✕</button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
              {productTagModal.map((tag, i) => (
                <span key={i} className="rounded-full px-2.5 py-1 text-xs bg-gray-100 text-gray-600">{tag}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product filter constants ───────────────────────────────────────────────
const PRODUCT_PRICE_PRESETS = [
  { label: "Unlimited", min: null, max: null },
  { label: "0.01~10", min: 0.01, max: 10 },
  { label: "10.01~30", min: 10.01, max: 30 },
  { label: "30.01~200", min: 30.01, max: 200 },
  { label: "≥200", min: 200, max: null },
];
const PRODUCT_NUM_PRESETS = [
  { label: "All", min: null, max: null },
  { label: "0~10", min: 0, max: 10 },
  { label: "11~30", min: 11, max: 30 },
  { label: "31~200", min: 31, max: 200 },
  { label: ">200", min: 201, max: null },
];
const PRODUCT_FILTER_GROUPS = [
  { key: "price", label: "Price (USD)", subs: [{ field: "price", label: "Price (USD)", presets: PRODUCT_PRICE_PRESETS }] },
  { key: "sales", label: "Sales", subs: [
    { field: "monthly_sales", label: "7-Day Sales:", presets: PRODUCT_NUM_PRESETS },
    { field: "sales_total", label: "Total Sales:", presets: PRODUCT_NUM_PRESETS },
  ]},
  { key: "favorites", label: "Favorites", subs: [
    { field: "favorites_weekly", label: "7-Day Favorites:", presets: PRODUCT_NUM_PRESETS },
    { field: "favorites", label: "Total Favorites:", presets: PRODUCT_NUM_PRESETS },
  ]},
  { key: "reviews", label: "Reviews", subs: [
    { field: "reviews_weekly", label: "7-Day Reviews:", presets: PRODUCT_NUM_PRESETS },
    { field: "reviews", label: "Total Reviews:", presets: PRODUCT_NUM_PRESETS },
  ]},
];
const PRODUCT_FIELD_DISPLAY = {
  price: "Price", monthly_sales: "7D Sales", sales_total: "Total Sales",
  favorites_weekly: "7D Fav", favorites: "Favorites",
  reviews_weekly: "7D Rev", reviews: "Reviews",
};
const RELEASE_TIME_OPTS = [
  { label: "30 Days", value: "30" },
  { label: "180 Days", value: "180" },
  { label: "1 Year", value: "365" },
  { label: "All Time", value: "" },
];
const PRODUCT_TYPE_OPTS = [
  { label: "Physical", value: "Physical" },
  { label: "Digital", value: "Digital" },
];

function ProductFilterBar({
  filters, setFilters,
  releaseTime, setReleaseTime,
  country, setCountry,
  labels, setLabels,
  productTypes, setProductTypes,
  availableCountries,
}) {
  const [openKey, setOpenKey] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [countrySearch, setCountrySearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpenKey(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleGroup = (key) => {
    if (openKey === key) { setOpenKey(null); return; }
    const group = PRODUCT_FILTER_GROUPS.find((g) => g.key === key);
    const init = {};
    group?.subs.forEach((sub) => {
      const cur = filters[sub.field];
      init[sub.field] = { minStr: cur?.[0] != null ? String(cur[0]) : "", maxStr: cur?.[1] != null ? String(cur[1]) : "" };
    });
    setDrafts((prev) => ({ ...prev, ...init }));
    setOpenKey(key);
  };

  const setDraftField = (field, side, val) =>
    setDrafts((prev) => ({ ...prev, [field]: { ...(prev[field] || {}), [side]: val } }));

  const applyPreset = (field, preset) =>
    setDrafts((prev) => ({
      ...prev,
      [field]: {
        minStr: preset.min != null ? String(preset.min) : "",
        maxStr: preset.max != null ? String(preset.max) : "",
      },
    }));

  const isPresetActive = (field, preset) => {
    const d = drafts[field] || {};
    return (
      (preset.min == null ? d.minStr === "" : d.minStr === String(preset.min)) &&
      (preset.max == null ? d.maxStr === "" : d.maxStr === String(preset.max))
    );
  };

  const applyGroup = (key) => {
    const group = PRODUCT_FILTER_GROUPS.find((g) => g.key === key);
    const next = { ...filters };
    group?.subs.forEach((sub) => {
      const d = drafts[sub.field] || {};
      const minV = d.minStr !== "" ? parseFloat(d.minStr) : null;
      const maxV = d.maxStr !== "" ? parseFloat(d.maxStr) : null;
      if (minV != null || maxV != null) next[sub.field] = [minV, maxV];
      else delete next[sub.field];
    });
    setFilters(next);
    setOpenKey(null);
  };

  const resetGroup = (key) => {
    const group = PRODUCT_FILTER_GROUPS.find((g) => g.key === key);
    const next = { ...filters };
    const newDrafts = {};
    group?.subs.forEach((sub) => { delete next[sub.field]; newDrafts[sub.field] = { minStr: "", maxStr: "" }; });
    setFilters(next);
    setDrafts((prev) => ({ ...prev, ...newDrafts }));
  };

  const groupActiveCount = (key) =>
    PRODUCT_FILTER_GROUPS.find((g) => g.key === key)?.subs.filter((s) => filters[s.field]).length || 0;

  const toggleLabel = (lbl) =>
    setLabels((prev) => prev.includes(lbl) ? prev.filter((l) => l !== lbl) : [...prev, lbl]);

  const toggleProductType = (t) =>
    setProductTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const fmtV = (v) => {
    if (v == null) return "";
    if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  };
  const fmtRange = (min, max) =>
    min == null ? `<${fmtV(max)}` : max == null ? `≥${fmtV(min)}` : `${fmtV(min)}~${fmtV(max)}`;

  const chipEntries = [
    ...Object.entries(filters).map(([field, [min, max]]) => ({
      key: field,
      label: `${PRODUCT_FIELD_DISPLAY[field] || field}: ${fmtRange(min, max)}`,
      remove: () => { const n = { ...filters }; delete n[field]; setFilters(n); },
    })),
    ...(country ? [{ key: "_country", label: `Country: ${country}`, remove: () => setCountry("") }] : []),
    ...labels.map((l) => ({ key: `_lbl_${l}`, label: l, remove: () => toggleLabel(l) })),
    ...productTypes.map((t) => ({ key: `_pt_${t}`, label: `Type: ${t}`, remove: () => toggleProductType(t) })),
    ...(releaseTime ? [{ key: "_rt", label: `Listed ≤${releaseTime}d`, remove: () => setReleaseTime("") }] : []),
  ];
  const hasAny = chipEntries.length > 0;

  const filteredCountries = countrySearch
    ? availableCountries.filter((c) => c.toLowerCase().includes(countrySearch.toLowerCase()))
    : availableCountries;

  const renderGroupBtn = (group) => {
    const cnt = groupActiveCount(group.key);
    const isOpen = openKey === group.key;
    return (
      <div key={group.key} className="relative">
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors cursor-pointer ${
            cnt > 0 ? "border-sky-400 bg-sky-50 text-sky-700"
            : isOpen ? "border-gray-400 bg-gray-50 text-gray-800"
            : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {group.label}
          {cnt > 0 && <span className="text-[0.58rem] bg-sky-500 text-white rounded-full px-1 leading-tight">{cnt}</span>}
          <span className={`text-[0.55rem] transition-transform inline-block ${isOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3" style={{ minWidth: 280 }}>
            <p className="text-xs font-semibold text-gray-800 mb-1">{group.label}</p>
            <hr className="mb-2 border-gray-200" />
            {group.subs.map((sub, si) => (
              <div key={sub.field} className={si > 0 ? "mt-3" : ""}>
                <p className="text-[0.68rem] text-gray-400 mb-1">{sub.label}</p>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {sub.presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(sub.field, preset)}
                      className={`text-[0.68rem] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                        isPresetActive(sub.field, preset)
                          ? "bg-sky-500 text-white border-sky-500"
                          : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                      }`}
                    >{preset.label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <input type="number" placeholder="Min" value={drafts[sub.field]?.minStr ?? ""}
                    onChange={(e) => setDraftField(sub.field, "minStr", e.target.value)}
                    className="w-20 px-2 py-0.5 text-[0.68rem] border border-gray-300 rounded focus:outline-none focus:border-sky-400" />
                  <span className="text-gray-400 text-xs">~</span>
                  <input type="number" placeholder="Max" value={drafts[sub.field]?.maxStr ?? ""}
                    onChange={(e) => setDraftField(sub.field, "maxStr", e.target.value)}
                    className="w-20 px-2 py-0.5 text-[0.68rem] border border-gray-300 rounded focus:outline-none focus:border-sky-400" />
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2 mt-2 border-t border-gray-100">
              <button type="button" onClick={() => resetGroup(group.key)} className="text-[0.68rem] text-gray-500 hover:text-gray-700 px-2 cursor-pointer">Reset</button>
              <button type="button" onClick={() => setOpenKey(null)} className="text-[0.68rem] px-2.5 py-0.5 rounded border border-gray-300 hover:bg-gray-50 cursor-pointer">Cancel</button>
              <button type="button" onClick={() => applyGroup(group.key)} className="text-[0.68rem] px-2.5 py-0.5 rounded bg-sky-500 text-white hover:bg-sky-600 cursor-pointer">OK</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="bg-white border border-gray-200 rounded-lg mb-3 text-xs">
      {/* Selected chips */}
      {hasAny && (
        <div className="px-3 py-1.5 flex flex-wrap gap-1 items-center border-b border-gray-100">
          <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0">Selected:</span>
          {chipEntries.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-0.5 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 text-[0.65rem] text-sky-700">
              {chip.label}
              <span onClick={chip.remove} className="cursor-pointer hover:text-sky-900 ml-0.5 font-bold">×</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => { setFilters({}); setReleaseTime(""); setCountry(""); setLabels([]); setProductTypes([]); }}
            className="ml-auto text-[0.65rem] text-gray-400 hover:text-red-500 px-1 cursor-pointer"
          >Reset All</button>
        </div>
      )}
      {/* Basic row: Price | Sales */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-100 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[3rem]">Basic :</span>
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[0])}
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[1])}
      </div>
      {/* Advanced row: Country | Favorites | Reviews | Product Type */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-100 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[4.5rem]">Advanced :</span>
        {/* Country */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenKey(openKey === "_country" ? null : "_country")}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors cursor-pointer ${
              country ? "border-sky-400 bg-sky-50 text-sky-700"
              : openKey === "_country" ? "border-gray-400 bg-gray-50 text-gray-800"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {country || "Country"}
            <span className={`text-[0.55rem] transition-transform inline-block ${openKey === "_country" ? "rotate-180" : ""}`}>▾</span>
          </button>
          {openKey === "_country" && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden" style={{ minWidth: 190 }}>
              <div className="p-2 border-b border-gray-100">
                <input
                  type="text" placeholder="Search..." value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-sky-400"
                />
              </div>
              <div className="max-h-44 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => { setCountry(""); setOpenKey(null); setCountrySearch(""); }}
                  className={`w-full text-left text-xs px-3 py-1.5 cursor-pointer transition-colors ${!country ? "bg-sky-50 text-sky-700 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                >All Countries</button>
                {filteredCountries.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setCountry(c); setOpenKey(null); setCountrySearch(""); }}
                    className={`w-full text-left text-xs px-3 py-1.5 cursor-pointer transition-colors ${country === c ? "bg-sky-50 text-sky-700 font-semibold" : "text-gray-700 hover:bg-gray-50"}`}
                  >{c}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[2])}
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[3])}
        {/* Product Type */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenKey(openKey === "_type" ? null : "_type")}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors cursor-pointer ${
              productTypes.length > 0 ? "border-sky-400 bg-sky-50 text-sky-700"
              : openKey === "_type" ? "border-gray-400 bg-gray-50 text-gray-800"
              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Product Type
            {productTypes.length > 0 && <span className="text-[0.58rem] bg-sky-500 text-white rounded-full px-1 leading-tight">{productTypes.length}</span>}
            <span className={`text-[0.55rem] transition-transform inline-block ${openKey === "_type" ? "rotate-180" : ""}`}>▾</span>
          </button>
          {openKey === "_type" && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1" style={{ minWidth: 140 }}>
              {PRODUCT_TYPE_OPTS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox" checked={productTypes.includes(opt.value)}
                    onChange={() => toggleProductType(opt.value)}
                    className="accent-sky-500"
                  />
                  <span className="text-xs text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Labels row: Etsy Pick | BestSeller */}
      <div className="px-3 py-2 flex items-center gap-3 border-b border-gray-100 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[3rem]">Labels :</span>
        {["Etsy Pick", "BestSeller"].map((lbl) => (
          <label key={lbl} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 select-none">
            <input type="checkbox" checked={labels.includes(lbl)} onChange={() => toggleLabel(lbl)} className="accent-sky-500" />
            {lbl}
          </label>
        ))}
      </div>
      {/* Release Time row: radio buttons */}
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[5.5rem]">Release Time :</span>
        {RELEASE_TIME_OPTS.map((opt) => (
          <label
            key={opt.value}
            className={`cursor-pointer px-2.5 py-1 rounded border text-xs transition-colors select-none ${
              releaseTime === opt.value ? "bg-sky-500 text-white border-sky-500" : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <input type="radio" name="pf_releaseTime" value={opt.value} checked={releaseTime === opt.value}
              onChange={() => setReleaseTime(opt.value)} className="sr-only" />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function FilterBar({ huntFilters, setHuntFilters, huntOpenFilter, setHuntOpenFilter, huntDraft, setHuntDraft, huntActiveFilterCount, filtersConfig }) {
  const config = filtersConfig || HUNT_FILTERS;
  const fmtVal = (v) => {
    if (v == null) return "";
    if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1)}K`;
    return v.toLocaleString();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 mb-3">
      {/* Active filter chips */}
      {huntActiveFilterCount > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center mb-2">
          <span className="text-xs font-semibold text-gray-700">Selected:</span>
          {Object.entries(huntFilters).map(([key, [min, max]]) => {
            const label = config.flatMap((g) => g.rows).find((r) => r.key === key)?.label || key;
            const rangeText = min == null ? `< ${fmtVal(max)}` : max == null ? `≥ ${fmtVal(min)}` : `${fmtVal(min)}~${fmtVal(max)}`;
            return (
              <span key={key} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 text-xs text-blue-700">
                {label}: {rangeText}
                <span
                  onClick={() => setHuntFilters((f) => { const n = { ...f }; delete n[key]; return n; })}
                  className="cursor-pointer font-bold text-blue-300 hover:text-blue-600 ml-0.5"
                >×</span>
              </span>
            );
          })}
          <span
            onClick={() => setHuntFilters({})}
            className="text-xs text-red-500 cursor-pointer hover:text-red-700 ml-1"
          >Clear all</span>
        </div>
      )}

      {/* Filter group buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-gray-700">Filters:</span>
        {config.map((fg) => {
          const isOpen = huntOpenFilter === fg.group;
          const hasActive = fg.rows.some((r) => huntFilters[r.key]);
          return (
            <div key={fg.group} className="relative">
              <button
                type="button"
                onClick={() => {
                  if (isOpen) { setHuntOpenFilter(null); return; }
                  const draft = {};
                  fg.rows.forEach((r) => {
                    if (huntFilters[r.key]) draft[r.key] = [...huntFilters[r.key]];
                    draft[r.key + "_cmin"] = "";
                    draft[r.key + "_cmax"] = "";
                  });
                  setHuntDraft(draft);
                  setHuntOpenFilter(fg.group);
                }}
                className={`flex items-center gap-1 px-3 py-1 rounded text-xs border cursor-pointer transition-colors ${
                  hasActive
                    ? "border-blue-400 bg-blue-50 text-blue-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {fg.label}
                <span className={`text-[0.55rem] transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
              </button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-1 z-[100] bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[340px]">
                  <p className="text-sm font-semibold mb-1.5">{fg.label}</p>
                  <div className="h-px bg-gray-200 mb-2.5" />

                  {fg.rows.map((row) => {
                    const activePreset = huntDraft[row.key];
                    const isAll = !activePreset && !huntDraft[row.key + "_cmin"] && !huntDraft[row.key + "_cmax"];
                    return (
                      <div key={row.key} className="mb-2.5">
                        <p className="text-xs text-gray-400 mb-1.5">{row.label}:</p>
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          <button
                            type="button"
                            onClick={() => setHuntDraft((d) => { const n = { ...d }; delete n[row.key]; n[row.key + "_cmin"] = ""; n[row.key + "_cmax"] = ""; return n; })}
                            className={`px-2.5 py-0.5 rounded border text-xs cursor-pointer transition-colors ${isAll ? "bg-sky-500 border-sky-500 text-white" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                          >
                            All
                          </button>
                          {row.presets.map(([pmin, pmax, plabel]) => {
                            const sel = activePreset && activePreset[0] === pmin && activePreset[1] === pmax;
                            return (
                              <button
                                key={plabel}
                                type="button"
                                onClick={() => setHuntDraft((d) => ({ ...d, [row.key]: [pmin, pmax], [row.key + "_cmin"]: "", [row.key + "_cmax"]: "" }))}
                                className={`px-2.5 py-0.5 rounded border text-xs cursor-pointer transition-colors ${sel ? "bg-sky-500 border-sky-500 text-white" : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}
                              >
                                {plabel}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-1">
                          <input type="number" placeholder="Min" value={huntDraft[row.key + "_cmin"] ?? ""}
                            onChange={(e) => setHuntDraft((d) => ({ ...d, [row.key + "_cmin"]: e.target.value, [row.key]: null }))}
                            className="w-20 px-2 py-1 rounded border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400" />
                          <span className="text-xs text-gray-400">~</span>
                          <input type="number" placeholder="Max" value={huntDraft[row.key + "_cmax"] ?? ""}
                            onChange={(e) => setHuntDraft((d) => ({ ...d, [row.key + "_cmax"]: e.target.value, [row.key]: null }))}
                            className="w-20 px-2 py-1 rounded border border-gray-300 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400" />
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-end gap-1.5 mt-2 pt-2 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        const draft = {};
                        fg.rows.forEach((r) => { draft[r.key + "_cmin"] = ""; draft[r.key + "_cmax"] = ""; });
                        setHuntDraft(draft);
                      }}
                      className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-800 cursor-pointer"
                    >
                      Reset
                    </button>
                    <button type="button" onClick={() => setHuntOpenFilter(null)}
                      className="px-3 py-1 rounded border border-gray-300 text-xs bg-white text-gray-700 hover:bg-gray-50 cursor-pointer">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newFilters = { ...huntFilters };
                        fg.rows.forEach((r) => {
                          const cmin = huntDraft[r.key + "_cmin"];
                          const cmax = huntDraft[r.key + "_cmax"];
                          if (cmin || cmax) {
                            const mn = cmin ? parseFloat(cmin) : null;
                            const mx = cmax ? parseFloat(cmax) : null;
                            if (mn != null || mx != null) newFilters[r.key] = [mn, mx];
                            else delete newFilters[r.key];
                          } else if (huntDraft[r.key]) {
                            newFilters[r.key] = huntDraft[r.key];
                          } else {
                            delete newFilters[r.key];
                          }
                        });
                        setHuntFilters(newFilters);
                        setHuntOpenFilter(null);
                      }}
                      className="px-3 py-1 rounded border-none text-xs bg-sky-500 text-white hover:bg-sky-600 cursor-pointer"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

