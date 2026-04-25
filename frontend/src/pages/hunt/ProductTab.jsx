import React, { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import ProductFilterBar from "./ProductFilterBar";

export default function ProductTab() {
  const [openingHenull, setOpeningHenull] = useState(false);
  const [productResults, setProductResults] = useState(null);
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
  const [productTagModal, setProductTagModal] = useState(null);

  useEffect(() => { loadProductHistory(); }, []);

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
    if (productCountry) rows = rows.filter((r) => r.ships_from === productCountry);
    if (productLabels.includes("Etsy Pick")) rows = rows.filter((r) => r.is_pick === 1 || r.is_pick === "1");
    if (productLabels.includes("BestSeller")) rows = rows.filter((r) => r.is_bestsell === 1 || r.is_bestsell === "1");
    if (productProductTypes.length > 0) {
      rows = rows.filter((r) => {
        const isDigital = (r.hightlights || "").toLowerCase().includes("digital download");
        return productProductTypes.includes(isDigital ? "Digital" : "Physical");
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

  const wkBadge = (n) => {
    const num = Number(n);
    if (!num) return null;
    return num > 0
      ? <span className="ml-1 rounded px-1 py-0.5 text-[0.62rem]" style={{ background: "rgb(240,248,233)", color: "rgb(122,199,86)" }}>↑{num.toLocaleString()}</span>
      : <span className="ml-1 rounded px-1 py-0.5 text-[0.62rem]" style={{ background: "rgb(255,240,240)", color: "rgb(220,80,80)" }}>↓{Math.abs(num).toLocaleString()}</span>;
  };

  return (
    <div>
      {/* History button */}
      <div className="mb-4 flex gap-2 items-center flex-wrap">
        <Button variant="outline" onClick={() => { setProductHistoryModalOpen(true); loadProductHistory(); }}>
          📂 Lịch sử sản phẩm
          {productHistory.length > 0 && (
            <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{productHistory.length}</span>
          )}
        </Button>
        <Button
          variant="outline"
          disabled={openingHenull}
          onClick={async () => {
            setOpeningHenull(true);
            try { await fetch(`${API_BASE}/api/open_henull?mode=product`, { method: "POST" }); }
            catch (_) {}
            finally { setOpeningHenull(false); }
          }}
        >
          {openingHenull ? "⏳ Đang mở..." : "🌐 Mở HEnull"}
        </Button>
      </div>

      {/* History modal */}
      {productHistoryModalOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setProductHistoryModalOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold text-gray-900">Lịch sử Etsy product</p>
                {productHistory.length > 0 && <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{productHistory.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="xs" onClick={loadProductHistory} disabled={productHistoryLoading}>
                  {productHistoryLoading ? "Đang tải..." : "Tải lại"}
                </Button>
                <button type="button" onClick={() => setProductHistoryModalOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-lg leading-none cursor-pointer px-1">✕</button>
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
                      <div key={item.filename}
                        className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-all ${isActive ? "border-sky-400 bg-sky-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                        <button type="button" className="flex-1 text-left cursor-pointer min-w-0"
                          onClick={() => loadProductHistoryDetail(item.filename)}>
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-sky-700" : "text-gray-900"}`}>{displayName}</p>
                          <p className="text-[0.68rem] text-gray-400 mt-0.5">{displayDate} · {item.size_kb} KB</p>
                        </button>
                        <div className="flex gap-1.5 shrink-0">
                          <a href={`${API_BASE}/api/etsy_hunt/product_history/${item.filename}/download`}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors no-underline cursor-pointer"
                            download>CSV</a>
                          <button type="button" onClick={() => deleteProductHistory(item.filename)}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors cursor-pointer">Xóa</button>
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

      {productError && (
        <div className="mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{productError}</div>
      )}

      {productLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
          <Spinner className="w-4 h-4" />
          Đang tải sản phẩm...
        </div>
      )}

      {!productLoading && productResults && (() => {
        const totalNum = productResults?.data?.product_num ?? productResults?.product_num ?? 0;
        const searchKeyLabel = productResults?.search_key || "";
        return (
          <div>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-sm text-gray-600">
                {searchKeyLabel && <span className="mr-2 font-medium text-sky-700">"{searchKeyLabel}"</span>}
                Tổng: <span className="font-semibold">{totalNum.toLocaleString()}</span> sản phẩm
                {productActiveFilterCount > 0 && <span className="ml-2 text-sky-600">· Hiển thị: {productFilteredRows.length}</span>}
              </p>
            </div>

            <ProductFilterBar
              filters={productFilters} setFilters={setProductFilters}
              releaseTime={productReleaseTime} setReleaseTime={setProductReleaseTime}
              country={productCountry} setCountry={setProductCountry}
              labels={productLabels} setLabels={setProductLabels}
              productTypes={productProductTypes} setProductTypes={setProductProductTypes}
              availableCountries={productAvailableCountries}
            />

            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 text-left border-b border-gray-200 font-semibold" style={{ minWidth: 380 }}>Product</th>
                    <th className="border-b border-gray-200" style={{ width: 8 }}></th>
                    {[{ col: "monthly_sales", label: "7-Day Sales" }, { col: "sales_total", label: "Total Sales" }].map(({ col, label }) => (
                      <th key={col}
                        className="px-4 py-3 text-center border-b border-gray-200 whitespace-nowrap font-semibold cursor-pointer select-none hover:bg-gray-100 transition-colors"
                        style={{ minWidth: 110 }}
                        onClick={() => setProductSort((s) => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }))}>
                        {label}
                        <span className="ml-1 text-gray-400 font-normal">
                          {productSort.col === col ? (productSort.dir === "desc" ? "▼" : "▲") : "↕"}
                        </span>
                      </th>
                    ))}
                    {[{ col: "reviews", label: "Total Reviews", sub: "7-Day" }, { col: "favorites", label: "Total Favorites", sub: "7-Day" }].map(({ col, label, sub }) => (
                      <th key={col}
                        className="px-4 py-3 text-center border-b border-gray-200 whitespace-nowrap font-semibold cursor-pointer select-none hover:bg-gray-100 transition-colors"
                        style={{ minWidth: 130 }}
                        onClick={() => setProductSort((s) => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }))}>
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
                    let releaseDisplay = p.release_time || "";
                    if (releaseDisplay) {
                      const d = new Date(releaseDisplay);
                      if (!isNaN(d.getTime()))
                        releaseDisplay = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    }
                    return (
                      <tr key={p.product_id || i} className={`border-b border-gray-100 hover:bg-sky-50 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"}`}>
                        <td className="px-4 py-3 align-top">
                          <div className="flex gap-3">
                            {p.logo_url ? (
                              <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                                <img src={p.logo_url} alt="" style={{ width: 65, height: 65 }} className="object-cover rounded border border-gray-100" loading="lazy" />
                              </a>
                            ) : <div style={{ width: 65, height: 65, flexShrink: 0 }} className="rounded border border-gray-100 bg-gray-100" />}
                            <div className="flex flex-col gap-1 min-w-0">
                              <a href={p.product_url} target="_blank" rel="noopener noreferrer"
                                className="text-sky-700 hover:underline font-medium line-clamp-2 leading-snug text-sm" title={p.title}>{p.title}</a>
                              <div className="flex flex-wrap gap-1 items-center">
                                {(p.is_bestsell === 1 || p.is_bestsell === "1") && (
                                  <span className="rounded px-1.5 py-0.5 text-[0.62rem] font-semibold" style={{ background: "rgb(255,243,224)", color: "rgb(215,135,0)" }}>BestSeller</span>
                                )}
                                {(p.is_pick === 1 || p.is_pick === "1") && (
                                  <span className="rounded px-1.5 py-0.5 text-[0.62rem] font-semibold" style={{ background: "rgb(232,244,255)", color: "rgb(37,130,210)" }}>Etsy Pick</span>
                                )}
                                {tags.length > 0 && (
                                  <button type="button" onClick={() => setProductTagModal(tags)}
                                    className="rounded px-1.5 py-0.5 text-[0.62rem] bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors cursor-pointer whitespace-nowrap">
                                    🏷️ {tags.length} tags
                                  </button>
                                )}
                                {p.ships_from && <span className="rounded px-1.5 py-0.5 text-[0.62rem] bg-blue-50 text-blue-500">{p.ships_from}</span>}
                                {p.store_name && <span className="rounded px-1.5 py-0.5 text-[0.62rem] bg-purple-50 text-purple-500 max-w-[120px] truncate">{p.store_name}</span>}
                              </div>
                              <div className="font-semibold text-sm" style={{ color: "#7a8dba" }}>
                                {p.price ? `$${Number(p.price).toFixed(2)}` : ""}
                                {p.currency_code && p.currency_code !== "USD" && <span className="text-xs ml-1 text-gray-400">{p.currency_code}</span>}
                              </div>
                              {releaseDisplay && <div className="text-[0.65rem] text-gray-400">Release on: {releaseDisplay}</div>}
                            </div>
                          </div>
                        </td>
                        <td></td>
                        <td className="px-4 py-3 text-center align-middle whitespace-nowrap font-semibold text-gray-700">{Number(p.monthly_sales).toLocaleString()}</td>
                        <td className="px-4 py-3 text-center align-middle whitespace-nowrap font-semibold text-gray-700">{Number(p.sales_total).toLocaleString()}</td>
                        <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                          <span className="font-semibold text-gray-700">{Number(p.reviews).toLocaleString()}</span>
                          {wkBadge(p.reviews_weekly)}
                        </td>
                        <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                          <span className="font-semibold text-gray-700">{Number(p.favorites).toLocaleString()}</span>
                          {wkBadge(p.favorites_weekly)}
                        </td>
                        <td className="px-4 py-3 text-center align-middle">
                          {p.product_url && (
                            <a href={p.product_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center justify-center text-gray-400 hover:text-sky-600 transition-colors" title="Open on Etsy">
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

      {/* Tag modal */}
      {productTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setProductTagModal(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800 text-sm">Tags ({productTagModal.length})</h3>
              <button type="button" onClick={() => setProductTagModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer">✕</button>
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
