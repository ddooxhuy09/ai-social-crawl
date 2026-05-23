import { useState, useEffect, useCallback } from "react";
import {
  Globe, Plus, RefreshCw, Search, ExternalLink,
  Star, MessageSquare, Loader2, AlertCircle, ChevronDown, ChevronUp,
  Package, Save, Tag, TrendingUp, ShoppingCart, BarChart2, Copy, Check,
} from "lucide-react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";
import { usePolling } from "../../hooks/usePolling";

const STATUS_COLORS = {
  empty:    "bg-gray-100 text-gray-600",
  pending:  "bg-gray-100 text-gray-600",
  running:  "bg-amber-100 text-amber-700 animate-pulse",
  done:     "bg-emerald-100 text-emerald-700",
  error:    "bg-red-100 text-red-700",
};

const STATUS_LABELS = {
  empty:    "Draft",
  pending:  "Pending",
  running:  "Running...",
  done:     "Complete",
  error:    "Error",
};

let _cachedPrompt = null;

async function fetchSystemPrompt() {
  if (_cachedPrompt) return _cachedPrompt;
  try {
    const res = await fetch(`${API_BASE}/api/product-insights/prompt`);
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();
    _cachedPrompt = data.prompt;
  } catch {
    _cachedPrompt = "";
  }
  return _cachedPrompt;
}

function buildAnalysisPrompt(selectedData, systemPrompt) {
  const trend = selectedData.trend_research || {};
  const googleTrends = trend.google_trends || {};
  const tavilyResults = trend.tavily_results || [];

  const productInfo = selectedData.raw_text
    ? `### 1. PRODUCT INFO\n${selectedData.raw_text}`
    : [
        `### 1. PRODUCT INFO`,
        `- Product Name: ${selectedData.product_name || selectedData.name || "N/A"}`,
        `- Price: ${selectedData.price || "N/A"}`,
        `- Ratings: ${selectedData.avg_rating || "N/A"} stars / ${selectedData.total_review_count || "N/A"} reviews`,
        `- Sales: ${selectedData.total_sales || "N/A"}`,
      ].join("\n");

  const reviews = (selectedData.reviews || []).slice(0, 30);
  const reviewLines = reviews.map(r => `- ${(r.text || "").trim()}`).filter(l => l.length > 2);
  const reviewsSection = [`### 2. CUSTOMER REVIEWS`, ...reviewLines].join("\n");

  const regions = (googleTrends.interest_by_region || []).slice(0, 10);
  const regionList = regions.length
    ? regions.map(r => `${r.location} (${r.value ?? r.extracted_value})`).join(", ")
    : "No data";
  const trendsSection = [
    `### 3. GOOGLE TRENDS DATA`,
    `- Keyword: ${googleTrends.keyword || "N/A"}`,
    `- Top Regions: ${regionList}`,
  ].join("\n");

  const allResults = tavilyResults.flatMap(g =>
    (g.results || []).filter(r => (r.score || 0) >= 0.6)
  );
  const webLines = allResults.map(r =>
    `- **${r.title}**\n  ${(r.content || "").slice(0, 250).trim()}\n  URL: ${r.url}`
  );
  const webSection = [`### 4. WEB SIGNALS (TAVILY)`, ...webLines].join("\n\n");

  const productData = [productInfo, reviewsSection, trendsSection, webSection].join("\n\n");
  return `${systemPrompt}\n\n---\n\n${productData}`;
}

const NOISE_WORDS = new Set(["pattern", "bundle", "pdf", "digital", "file", "printable", "download", "set", "pack"]);

function extractBaseKeyword(productName) {
  const segment = productName.split("|")[0].split(" - ")[0].split(",")[0].trim();
  const words = segment.split(/\s+/).filter(w => !NOISE_WORDS.has(w.toLowerCase()));
  return words.slice(0, 4).join(" ").trim() || segment.slice(0, 40);
}

function TrendResearchView({ data }) {
  const { tavily_results = [], google_trends, queried_at } = data;

  // SerpApi TIMESERIES: each point is { date, values: [{extracted_value}] }
  const iotSlice = (google_trends?.interest_over_time || []).slice(-24);
  const getVal = (point) => point?.values?.[0]?.extracted_value ?? 0;
  const maxVal = Math.max(...iotSlice.map(getVal), 1);

  // SerpApi GEO_MAP_0: [{ location, extracted_value }]
  const regions = (google_trends?.interest_by_region || []).slice(0, 10);
  const maxRegionVal = Math.max(...regions.map(r => r.extracted_value ?? 0), 1);

  return (
    <div className="flex flex-col gap-6">
      {queried_at && (
        <p className="text-[11px] text-gray-400">Last updated: {new Date(queried_at).toLocaleString()}</p>
      )}

      {/* Google Trends */}
      {google_trends && (
        <div>
          <h4 className="text-xs font-bold text-gray-600 mb-3 uppercase tracking-wide flex items-center gap-1.5">
            <span>📈</span> Google Trends — &quot;{google_trends.keyword}&quot;
          </h4>
          {google_trends.error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-3">{google_trends.error}</p>
          )}

          {iotSlice.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <p className="text-[11px] text-gray-400 mb-3">
                Interest over time — {iotSlice[0]?.date} → {iotSlice[iotSlice.length - 1]?.date}
              </p>
              <div className="flex items-end gap-0.5 h-20">
                {iotSlice.map((point, i) => {
                  const val = getVal(point);
                  const heightPct = Math.max(3, Math.round((val / maxVal) * 100));
                  return (
                    <div key={i} className="flex-1 h-full flex items-end" title={`${point.date}: ${val}`}>
                      <div
                        className="w-full bg-violet-400 hover:bg-violet-600 transition-colors rounded-sm"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {regions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-500 mb-2">Interest by Region (top 10)</p>
              <div className="flex flex-col gap-1.5">
                {regions.map((r, i) => {
                  const pct = Math.round(((r.extracted_value ?? 0) / maxRegionVal) * 100);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-28 shrink-0 truncate">{r.location}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="bg-violet-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-400 w-8 text-right shrink-0">{r.value ?? r.extracted_value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tavily Web Signals */}
      {tavily_results.length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-600 mb-3 uppercase tracking-wide flex items-center gap-1.5">
            <span>🌐</span> Web Signals
          </h4>
          <div className="flex flex-col gap-5">
            {tavily_results.map((group, gi) => (
              <div key={gi}>
                <p className="text-[11px] font-semibold text-violet-600 bg-violet-50 border border-violet-100 px-2.5 py-1 rounded-lg mb-2.5 inline-block">
                  &quot;{group.query}&quot;
                </p>
                {group.error ? (
                  <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{group.error}</p>
                ) : group.results.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No results found.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {group.results.map((r, ri) => (
                      <div key={ri} className="border border-gray-100 rounded-xl p-3.5 bg-gray-50 hover:border-violet-200 hover:bg-violet-50/20 transition-colors">
                        <a href={r.url} target="_blank" rel="noreferrer"
                          className="text-sm font-semibold text-gray-900 hover:text-violet-600 leading-snug block mb-1">
                          {r.title}
                        </a>
                        <p className="text-[11px] text-violet-500 truncate mb-2">{r.url}</p>
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{r.content}</p>
                        <span className="text-[10px] text-gray-400 mt-1.5 block">relevance: {r.score}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductInsightsPage() {
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedData, setSelectedData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [newProductName, setNewProductName] = useState("");
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [createError, setCreateError] = useState("");

  const [editUrl, setEditUrl] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewSort, setReviewSort] = useState({ col: "", dir: "desc" });

  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState("");
  const [trendsKeyword, setTrendsKeyword] = useState("");
  const [copied, setCopied] = useState(false);
  const [rawText, setRawText] = useState("");
  const [savingRaw, setSavingRaw] = useState(false);

  const showNewProductForm = selectedId === null;

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products`);
      if (!res.ok) throw new Error("Failed");
      setProducts(await res.json());
    } catch (_) {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    setLoadingDetail(true);
    setSelectedData(null);
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products/${id}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setSelectedData(data);
      setEditUrl(data.url || "");
      setEditNotes(data.notes || "");
      setRawText(data.raw_text || "");
      const existingKeyword = data.trend_research?.google_trends?.keyword || "";
      const fallbackKeyword = data.product_name ? extractBaseKeyword(data.product_name) : "";
      setTrendsKeyword(existingKeyword || fallbackKeyword);
      setSaveError("");
      setStartError("");
    } catch (_) {
      setSelectedData(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const activeJob = products.find(p => p.id === selectedId && p.status === "running");
  const isTrendRunning = selectedData?.trend_status === "running";
  const shouldPoll = !!activeJob || isTrendRunning;

  const pollJob = useCallback(async () => {
    if (!shouldPoll || !selectedId) return;
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products/${selectedId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSelectedData(data);
      setEditUrl(data.url || "");
      setEditNotes(data.notes || "");
      if (data.status !== "running") loadProducts();
    } catch (_) {}
  }, [shouldPoll, selectedId, loadProducts]);
  usePolling(pollJob, 3000, [shouldPoll]);

  const handleNewProduct = () => {
    setSelectedId(null);
    setSelectedData(null);
    setNewProductName("");
    setCreateError("");
  };

  const handleCreateProduct = async () => {
    if (!newProductName.trim()) return;
    setCreatingProduct(true);
    setCreateError("");
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProductName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to create product");
      }
      const { id } = await res.json();
      await loadProducts();
      setSelectedId(id);
      setNewProductName("");
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreatingProduct(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: editUrl.trim() || null, notes: editNotes.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to save");
      }
      const data = await res.json();
      setSelectedData(data);
      await loadProducts();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStartResearch = async () => {
    if (!selectedId) return;
    setStarting(true);
    setStartError("");
    try {
      const saveRes = await fetch(`${API_BASE}/api/product-insights/products/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: editUrl.trim() || null, notes: editNotes.trim() || null }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.detail || "Failed to save");
      }
      const res = await fetch(`${API_BASE}/api/product-insights/products/${selectedId}/start`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to start research");
      }
      const data = await res.json();
      setSelectedData(data);
      await loadProducts();
    } catch (e) {
      setStartError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const handleFetchTrend = async () => {
    if (!selectedId) return;
    setTrendLoading(true);
    setTrendError("");
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products/${selectedId}/trend-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trends_keyword: trendsKeyword.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to start trend research");
      }
      const data = await res.json();
      setSelectedData(data);
    } catch (e) {
      setTrendError(e.message);
    } finally {
      setTrendLoading(false);
    }
  };

  const handleSaveManualInfo = async () => {
    if (!selectedId) return;
    setSavingRaw(true);
    try {
      const res = await fetch(`${API_BASE}/api/product-insights/products/${selectedId}/manual-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: rawText }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setSelectedData(data);
    } catch (_) {} finally {
      setSavingRaw(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!selectedData) return;
    const systemPrompt = await fetchSystemPrompt();
    const text = buildAnalysisPrompt(selectedData, systemPrompt);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredReviews = (() => {
    const reviews = selectedData?.reviews || [];
    let list = reviews.filter(r =>
      !reviewSearch ||
      (r.text || "").toLowerCase().includes(reviewSearch.toLowerCase()) ||
      (r.author || "").toLowerCase().includes(reviewSearch.toLowerCase())
    );
    if (reviewSort.col) {
      list = [...list].sort((a, b) => {
        const dir = reviewSort.dir === "asc" ? 1 : -1;
        if (reviewSort.col === "rating") return dir * ((a.rating || 0) - (b.rating || 0));
        if (reviewSort.col === "text") return dir * (a.text || "").localeCompare(b.text || "");
        if (reviewSort.col === "author") return dir * (a.author || "").localeCompare(b.author || "");
        return 0;
      });
    }
    return list;
  })();

  const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 bg-gray-50 focus:bg-white transition-colors resize-none";

  const isRunning = selectedData?.status === "running";
  const isDone = selectedData?.status === "done";

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden bg-gray-50">
      {/* ── Left Sidebar ── */}
      <aside className="w-full md:w-[280px] flex-none border-r border-gray-200 bg-white flex flex-col overflow-hidden md:max-w-[280px] max-h-[200px] md:max-h-none">
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Globe size={15} className="text-violet-500" /> Product Insights
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">Analyze Etsy product reviews & insights</p>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <Button variant="violet" size="sm" onClick={handleNewProduct} className="w-full text-xs">
            <Plus size={13} className="mr-1.5" /> New Product
          </Button>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Products</span>
          <button type="button" onClick={loadProducts} disabled={productsLoading}
            className="text-xs text-violet-500 hover:underline disabled:opacity-50">
            {productsLoading ? "..." : "↻"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col">
          {products.length === 0 && !productsLoading && (
            <p className="text-xs text-gray-400 italic px-4 py-3">No products yet. Create one above.</p>
          )}
          {products.map(item => {
            const isActive = selectedId === item.id;
            return (
              <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setReviewSearch(""); }}
                className={`flex items-center gap-2 px-4 py-2.5 text-left transition-colors border-b border-gray-50 ${
                  isActive
                    ? "bg-violet-50 border-l-2 border-l-violet-500 text-violet-700"
                    : "hover:bg-gray-50 border-l-2 border-l-transparent text-gray-700"
                }`}>
                <Package size={13} className={isActive ? "text-violet-500" : "text-gray-400"} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium truncate ${isActive ? "text-violet-700" : "text-gray-800"}`}>
                    {item.name || `Product #${item.id}`}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate">{item.created_at ? new Date(item.created_at).toLocaleDateString() : ""}</p>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[item.status] || "bg-gray-100 text-gray-500"}`}>
                  {STATUS_LABELS[item.status] || item.status}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto">
        {showNewProductForm ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-full max-w-xl px-6">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 flex flex-col gap-5">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Package size={18} className="text-violet-500" /> Create New Product
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">Give your product a name to get started. You can add details after creation.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Product Name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Baby Headband Crochet Pattern"
                    className={inputCls}
                    value={newProductName}
                    onChange={e => setNewProductName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !creatingProduct && handleCreateProduct()}
                    autoFocus
                  />
                </div>

                {createError && (
                  <p className="text-sm text-red-600 flex items-center gap-2 font-medium bg-red-50 px-3 py-2 rounded-lg">
                    <AlertCircle size={14} /> {createError}
                  </p>
                )}

                <Button
                  variant="violet"
                  className="w-full font-semibold"
                  disabled={!newProductName.trim() || creatingProduct}
                  onClick={handleCreateProduct}
                >
                  {creatingProduct ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" /> Creating...</>
                  ) : (
                    "Create Product"
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-4xl mx-auto flex flex-col gap-5">
            {loadingDetail && !selectedData ? (
              <div className="flex items-center justify-center h-64">
                <p className="text-sm text-gray-400 animate-pulse flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading product...
                </p>
              </div>
            ) : selectedData ? (
              <>
                {/* ── Sticky Header Bar ── */}
                <div className="sticky top-0 z-20 -mx-6 -mt-0 px-6 py-3 bg-white/80 backdrop-blur-md border-b border-gray-200 mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package size={15} className="text-violet-500 shrink-0" />
                    <h2 className="text-sm font-bold text-gray-900 truncate">
                      {selectedData.product_name || selectedData.name || "Untitled Product"}
                    </h2>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[selectedData.status] || "bg-gray-100 text-gray-500"}`}>
                      {STATUS_LABELS[selectedData.status] || selectedData.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedData.trend_status === "done" && (
                      <Button variant="violet" size="sm" onClick={handleCopyPrompt} className="text-xs">
                        {copied
                          ? <><Check size={13} className="mr-1.5 text-emerald-500" /> Copied!</>
                          : <><Copy size={13} className="mr-1.5" /> Copy Analysis Prompt</>
                        }
                      </Button>
                    )}
                  </div>
                </div>

                {/* ── Product Header ── */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                  <div className="flex items-start gap-4">
                    {selectedData.product_image && (
                      <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 shrink-0">
                        <img src={selectedData.product_image} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold text-gray-900 leading-snug">
                        {selectedData.product_name || selectedData.name || "Untitled Product"}
                      </h2>
                      {selectedData.shop_name && (
                        <p className="text-xs text-gray-500 mt-1">
                          by <span className="font-semibold text-violet-600">{selectedData.shop_name}</span>
                        </p>
                      )}
                      {selectedData.url && (
                        <a href={selectedData.url} target="_blank" rel="noreferrer"
                          className="text-[11px] text-violet-500 hover:underline flex items-center gap-1 mt-1">
                          <ExternalLink size={10} /> View on Etsy
                        </a>
                      )}
                      {selectedData.product_description && (
                        <p className="text-sm text-gray-500 mt-2 leading-relaxed">{selectedData.product_description}</p>
                      )}
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${STATUS_COLORS[selectedData.status] || "bg-gray-100 text-gray-500"}`}>
                      {STATUS_LABELS[selectedData.status] || selectedData.status}
                    </span>
                  </div>

                  {/* ── Product Stats ── */}
                  {(selectedData.price || selectedData.avg_rating || selectedData.total_sales || selectedData.total_review_count) && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      {selectedData.price && (
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-100">
                          <ShoppingCart size={13} className="text-gray-400" />
                          {selectedData.price}
                          {selectedData.original_price && (
                            <span className="text-xs text-gray-400 line-through font-normal ml-1">{selectedData.original_price}</span>
                          )}
                          {selectedData.on_sale && (
                            <span className="text-[10px] font-semibold text-white bg-red-500 rounded-full px-1.5 py-0.5 ml-1">SALE</span>
                          )}
                        </span>
                      )}
                      {selectedData.avg_rating && (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                          <Star size={13} className="text-amber-400 fill-amber-400" />
                          {selectedData.avg_rating}
                          {selectedData.total_review_count && (
                            <span className="text-xs text-gray-400 font-normal">({Number(selectedData.total_review_count).toLocaleString()} reviews)</span>
                          )}
                        </span>
                      )}
                          {selectedData.total_sales && (
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                          <TrendingUp size={13} className="text-emerald-500" />
                          {selectedData.total_sales} sales
                        </span>
                      )}
                    </div>
                  )}

                  {/* ── Tags ── */}
                  {selectedData.tags?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Tag size={11} className="text-gray-400 mt-1 shrink-0" />
                      {selectedData.tags.map((tag, i) => (
                        <span key={i} className="text-[11px] font-medium text-violet-700 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* ── Image Gallery ── */}
                  {selectedData.image_urls?.length > 1 && (
                    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                      {selectedData.image_urls.map((img, i) => (
                        <div key={i} className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 shrink-0">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedData.notes && (
                    <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                      <p className="text-xs font-semibold text-amber-700 mb-0.5">Notes</p>
                      <p className="text-sm text-amber-800">{selectedData.notes}</p>
                    </div>
                  )}

                  {isRunning && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-amber-600">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="font-medium">Crawling reviews... This may take a few minutes.</span>
                    </div>
                  )}
                </div>

                {/* ── Reviews ── */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
                    <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                      <MessageSquare size={15} className="text-violet-500" />
                      Reviews
                      <span className="bg-violet-50 text-violet-600 text-xs px-2 py-0.5 rounded-full font-semibold">
                        {(selectedData.reviews || []).length}
                      </span>
                    </h3>
                    <div className="relative">
                      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search reviews..."
                        value={reviewSearch}
                        onChange={e => setReviewSearch(e.target.value)}
                        className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-violet-300"
                      />
                    </div>
                  </div>

                  {(selectedData.reviews || []).length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                      <p className="text-sm text-gray-400">
                        {isRunning ? "Reviews will appear here as they are crawled..." : "No reviews yet. Add an Etsy URL and start research."}
                      </p>
                    </div>
                  ) : filteredReviews.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                      <p className="text-sm text-gray-400">No reviews match your search.</p>
                    </div>
                  ) : (
                    <div className="overflow-y-auto max-h-[500px]">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left cursor-pointer select-none hover:bg-gray-100"
                              onClick={() => setReviewSort(p => p.col === "author" ? { col: "author", dir: p.dir === "asc" ? "desc" : "asc" } : { col: "author", dir: "asc" })}>
                              Author {reviewSort.col === "author" && (reviewSort.dir === "asc" ? <ChevronUp size={11} className="inline" /> : <ChevronDown size={11} className="inline" />)}
                            </th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center cursor-pointer select-none hover:bg-gray-100 w-20"
                              onClick={() => setReviewSort(p => p.col === "rating" ? { col: "rating", dir: p.dir === "asc" ? "desc" : "asc" } : { col: "rating", dir: "desc" })}>
                              Rating {reviewSort.col === "rating" && (reviewSort.dir === "asc" ? <ChevronUp size={11} className="inline" /> : <ChevronDown size={11} className="inline" />)}
                            </th>
                            <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left cursor-pointer select-none hover:bg-gray-100"
                              onClick={() => setReviewSort(p => p.col === "text" ? { col: "text", dir: p.dir === "asc" ? "desc" : "asc" } : { col: "text", dir: "asc" })}>
                              Review {reviewSort.col === "text" && (reviewSort.dir === "asc" ? <ChevronUp size={11} className="inline" /> : <ChevronDown size={11} className="inline" />)}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {filteredReviews.map((review, i) => (
                            <tr key={i} className="hover:bg-violet-50/30 transition-colors">
                              <td className="px-4 py-2.5 align-top">
                                <span className="text-xs font-medium text-gray-700">{review.author || "Anonymous"}</span>
                              </td>
                              <td className="px-4 py-2.5 align-top text-center">
                                {review.rating ? (
                                  <span className="inline-flex items-center gap-0.5 text-xs">
                                    <Star size={11} className="text-amber-400 fill-amber-400" />
                                    <span className="font-semibold text-gray-700">{review.rating}</span>
                                  </span>
                                ) : <span className="text-gray-300">&mdash;</span>}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-gray-600 leading-relaxed">
                                {review.text}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Product Details Form ── */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
                  <h3 className="text-sm font-bold text-gray-700">Product Details</h3>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Etsy Product URL</label>
                    <input
                      type="url"
                      placeholder="https://www.etsy.com/listing/..."
                      className={inputCls}
                      value={editUrl}
                      onChange={e => setEditUrl(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Additional Notes</label>
                    <textarea
                      className={inputCls}
                      style={{ minHeight: 80 }}
                      placeholder="Any specific aspects you want to focus on..."
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      disabled={isRunning}
                    />
                  </div>

                  {saveError && (
                    <p className="text-sm text-red-600 flex items-center gap-2 font-medium bg-red-50 px-3 py-2 rounded-lg">
                      <AlertCircle size={14} /> {saveError}
                    </p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="font-semibold"
                      disabled={isRunning || saving}
                      onClick={handleSave}
                    >
                      {saving ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={13} className="mr-1.5" />}
                      Save
                    </Button>
                    <Button
                      variant="violet"
                      className="font-semibold"
                      disabled={!editUrl.trim() || isRunning || starting}
                      onClick={handleStartResearch}
                    >
                      {starting ? (
                        <><Loader2 size={14} className="mr-2 animate-spin" /> Starting...</>
                      ) : isDone ? (
                        "Re-run Research"
                      ) : (
                        "Start Research"
                      )}
                    </Button>
                  </div>

                  {startError && (
                    <p className="text-sm text-red-600 flex items-center gap-2 font-medium bg-red-50 px-3 py-2 rounded-lg">
                      <AlertCircle size={14} /> {startError}
                    </p>
                  )}

                  {isRunning && (
                    <div className="flex items-center gap-2 text-sm text-amber-600">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="font-medium">Crawling reviews... This may take a few minutes.</span>
                    </div>
                  )}
                </div>

                {/* ── Manual Product Info ── */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3">
                  <h3 className="text-sm font-bold text-gray-700">Manual Product Info / Raw Data</h3>
                  <textarea
                    className={inputCls}
                    style={{ minHeight: 120 }}
                    placeholder={"Paste any raw product data here...\ne.g. product title, price, reviews, sales stats, etc."}
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                  />
                  <div>
                    <Button variant="outline" size="sm" disabled={savingRaw} onClick={handleSaveManualInfo} className="text-xs">
                      {savingRaw ? <><Loader2 size={13} className="mr-1.5 animate-spin" /> Saving...</> : <><Save size={13} className="mr-1.5" /> Save</>}
                    </Button>
                  </div>
                </div>

                {/* ── Trend Research ── */}
                {isDone && (
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                        <BarChart2 size={15} className="text-violet-500" />
                        Trend Research
                        {selectedData.trend_status === "done" && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">Done</span>
                        )}
                        {selectedData.trend_status === "running" && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full animate-pulse">Running...</span>
                        )}
                        {selectedData.trend_status === "error" && (
                          <span className="text-[10px] bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full">Error</span>
                        )}
                      </h3>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={selectedData.trend_status === "running" || trendLoading}
                          onClick={handleFetchTrend}
                          className="text-xs"
                        >
                          {selectedData.trend_status === "running" || trendLoading ? (
                            <><Loader2 size={13} className="mr-1.5 animate-spin" /> Researching...</>
                          ) : selectedData.trend_status === "done" ? (
                            <><RefreshCw size={13} className="mr-1.5" /> Re-fetch</>
                          ) : (
                            <><TrendingUp size={13} className="mr-1.5" /> Fetch Trend Data</>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                        Target Keyword for Google Trends
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. amigurumi crochet bunny"
                        className={inputCls}
                        value={trendsKeyword}
                        onChange={e => setTrendsKeyword(e.target.value)}
                        disabled={selectedData.trend_status === "running" || trendLoading}
                      />
                      <p className="text-[11px] text-gray-400 mt-1">
                        Auto-filled from product title. Edit for better results (shorter = broader signal).
                      </p>
                    </div>

                    {trendError && (
                      <p className="text-sm text-red-600 flex items-center gap-2 font-medium bg-red-50 px-3 py-2 rounded-lg">
                        <AlertCircle size={14} /> {trendError}
                      </p>
                    )}
                    {selectedData.trend_status === "error" && selectedData.trend_error && (
                      <p className="text-sm text-red-600 flex items-center gap-2 font-medium bg-red-50 px-3 py-2 rounded-lg">
                        <AlertCircle size={14} /> {selectedData.trend_error}
                      </p>
                    )}

                    {selectedData.trend_status === "running" && (
                      <div className="flex items-center gap-2 text-sm text-amber-600">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="font-medium">Fetching trend data from Tavily and Google Trends...</span>
                      </div>
                    )}

                    {selectedData.trend_status === "idle" && !trendError && (
                      <p className="text-xs text-gray-400">Click "Fetch Trend Data" to search for external trend signals.</p>
                    )}

                    {selectedData.trend_research && selectedData.trend_status === "done" && (
                      <TrendResearchView data={selectedData.trend_research} />
                    )}
                  </div>
                )}

                {/* ── AI Insights ── */}
                {selectedData.insights && (
                  <div className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-2xl border border-violet-100 shadow-sm p-5">
                    <h3 className="text-sm font-bold text-violet-900 flex items-center gap-2 mb-3">
                      <Star size={15} className="text-violet-500" /> AI Design Insights
                    </h3>
                    <div className="text-sm text-violet-800 leading-relaxed whitespace-pre-wrap">{selectedData.insights}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-64">
                <p className="text-sm text-gray-400">Select a product from the sidebar.</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
