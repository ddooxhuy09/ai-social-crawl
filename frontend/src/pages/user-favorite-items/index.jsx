import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload, RefreshCw, X,
  Users, FileJson, Activity, AlertCircle, ShoppingBag, Store, ExternalLink, Play, ChevronDown, ChevronUp, Calendar
} from "lucide-react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";
import { usePolling } from "../../hooks/usePolling";

const formatMonth = (m) => {
  if (!m) return "All Months";
  const [mm, yyyy] = m.split("/");
  return new Date(parseInt(yyyy), parseInt(mm) - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

export default function UserFavoriteItemsPage() {
  // CSV upload
  const [isDragging, setIsDragging]   = useState(false);
  const [csvFile, setCsvFile]         = useState(null);
  const [parsing, setParsing]         = useState(false);
  const [parseError, setParseError]   = useState("");

  // Background crawl
  const [sessionId, setSessionId]         = useState(null);
  const [crawling, setCrawling]           = useState(false);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [recrawlingId, setRecrawlingId]   = useState(null);

  // Saved buyer files
  const [availableFiles, setAvailableFiles] = useState([]);
  const [loadingFiles, setLoadingFiles]     = useState(false);
  const [selectedIds, setSelectedIds]       = useState(new Set());

  // Month filter (shared between both tables)
  const [availableMonths, setAvailableMonths] = useState([]);
  const [selectedMonth, setSelectedMonth]     = useState("");
  const [monthInput, setMonthInput]           = useState("");

  // Aggregate tables
  const [aggregateData, setAggregateData]     = useState(null);
  const [loadingAggregate, setLoadingAggregate] = useState(false);
  const [itemSort, setItemSort]               = useState({ key: "user_count", desc: true });
  const [shopSort, setShopSort]               = useState({ key: "user_count", desc: true });
  const [itemMinUsers, setItemMinUsers]       = useState(1);
  const [itemMinInput, setItemMinInput]       = useState(1);
  const [shopMinUsers, setShopMinUsers]       = useState(1);
  const [shopMinInput, setShopMinInput]       = useState(1);

  const selectedMonthRef = useRef("");
  useEffect(() => { selectedMonthRef.current = selectedMonth; }, [selectedMonth]);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch(`${API_BASE}/api/user-favorites/files`);
      if (res.ok) setAvailableFiles(await res.json());
    } catch (_) {}
    finally { setLoadingFiles(false); }
  }, []);

  const loadMonths = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/user-favorites/months`);
      if (res.ok) setAvailableMonths(await res.json());
    } catch (_) {}
  }, []);

  const loadAggregate = useCallback(async () => {
    setLoadingAggregate(true);
    const month = selectedMonthRef.current;
    try {
      const url = month
        ? `${API_BASE}/api/user-favorites/aggregate?month=${encodeURIComponent(month)}`
        : `${API_BASE}/api/user-favorites/aggregate`;
      const res = await fetch(url);
      if (res.ok) setAggregateData(await res.json());
    } catch (_) {}
    finally { setLoadingAggregate(false); }
  }, []);

  useEffect(() => { loadFiles(); loadMonths(); }, [loadFiles, loadMonths]);

  // ── Poll crawl session ────────────────────────────────────────────────────
  const pollStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${API_BASE}/api/user-favorites/status/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      setSessionStatus(data);
      if (data.status === "done" || data.status === "error") {
        setSessionId(null);
        setCrawling(false);
        setRecrawlingId(null);
        loadFiles();
        loadMonths();
        loadAggregate();
      }
    } catch (_) {}
  }, [sessionId, loadFiles, loadMonths, loadAggregate]);

  usePolling(pollStatus, 2000, [sessionId]);

  // ── File upload ───────────────────────────────────────────────────────────
  const handleFileDrop = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please upload a .csv file.");
      return;
    }
    setCsvFile(file);
    setParseError("");
  };

  const handleUpload = async () => {
    if (!csvFile) return;
    setParsing(true);
    setParseError("");
    setSessionStatus(null);
    try {
      const form = new FormData();
      form.append("file", csvFile);
      const parseRes = await fetch(`${API_BASE}/api/user-favorites/parse-csv`, { method: "POST", body: form });
      const parseData = await parseRes.json();
      if (!parseRes.ok) throw new Error(parseData.detail || "Failed to parse CSV.");
      if (!parseData.buyers?.length) throw new Error("No Buyer User IDs found in this file.");

      const startRes = await fetch(`${API_BASE}/api/user-favorites/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyers: parseData.buyers }),
      });
      if (!startRes.ok) throw new Error("Failed to start crawl session.");
      const { session_id } = await startRes.json();
      setSessionId(session_id);
      setCrawling(true);
      setCsvFile(null);
    } catch (e) {
      setParseError(e.message);
    } finally {
      setParsing(false);
    }
  };

  // ── Multi-select helpers ──────────────────────────────────────────────────
  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === availableFiles.length
      ? new Set()
      : new Set(availableFiles.map(f => f.buyer_id)));
  };

  const toggleSelectOne = (buyer_id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(buyer_id) ? next.delete(buyer_id) : next.add(buyer_id);
      return next;
    });
  };

  const handleRecrawlSelected = async (opts) => {
    if (crawling || recrawlingId || selectedIds.size === 0) return;
    setRecrawlingId("__batch__");
    try {
      const startRes = await fetch(`${API_BASE}/api/user-favorites/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_ids: [...selectedIds], ...opts }),
      });
      if (!startRes.ok) throw new Error("Failed to start.");
      const { session_id } = await startRes.json();
      setSessionId(session_id);
      setCrawling(true);
      setSelectedIds(new Set());
    } catch (_) {
      setRecrawlingId(null);
    }
  };

  // ── Sort helpers ──────────────────────────────────────────────────────────
  const toggleSort = (state, setState, key) =>
    setState(prev => prev.key === key ? { key, desc: !prev.desc } : { key, desc: true });

  const SortIcon = ({ sortState, col }) => {
    if (sortState.key !== col) return <ChevronDown size={12} className="text-slate-300 inline ml-0.5" />;
    return sortState.desc
      ? <ChevronDown size={12} className="text-orange-500 inline ml-0.5" />
      : <ChevronUp   size={12} className="text-orange-500 inline ml-0.5" />;
  };

  const sortedItems = aggregateData?.items
    ? [...aggregateData.items]
        .filter(item => item.user_count >= itemMinUsers)
        .sort((a, b) => {
          const va = itemSort.key === "listing_id" ? a.listing_id : a.user_count;
          const vb = itemSort.key === "listing_id" ? b.listing_id : b.user_count;
          return itemSort.desc ? vb - va : va - vb;
        })
    : [];

  const sortedShops = aggregateData?.shops
    ? [...aggregateData.shops]
        .filter(shop => shop.user_count >= shopMinUsers)
        .sort((a, b) => {
          const va = shopSort.key === "shop_name" ? a.shop_name.toLowerCase() : a.user_count;
          const vb = shopSort.key === "shop_name" ? b.shop_name.toLowerCase() : b.user_count;
          if (shopSort.key === "shop_name") return shopSort.desc ? vb.localeCompare(va) : va.localeCompare(vb);
          return shopSort.desc ? vb - va : va - vb;
        })
    : [];

  // Progress bar helpers
  const totalCrawl      = sessionStatus?.buyer_ids?.length || 0;
  const currentCrawl    = sessionStatus?.current_index || 0;
  const progressPercent = totalCrawl > 0 ? Math.round((currentCrawl / totalCrawl) * 100) : 0;
  const lastLogLine     = sessionStatus?.logs?.at(-1) ?? "";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white overflow-auto">
      <div className="flex-1 p-6 grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6 items-start">

        {/* ── LEFT COLUMN ── */}
        <div className="flex flex-col gap-4 sticky top-4">

          {/* Upload Card */}
          <div className="bg-white rounded-2xl p-5 border border-gray-200">
            <h2 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
              <Upload size={15} className="text-orange-500" /> Import Target Audience
            </h2>

            {!csvFile ? (
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); handleFileDrop(e.dataTransfer.files[0]); }}
                onClick={() => document.getElementById("ufi-csv-input").click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-300 bg-gray-50/50"
                }`}
              >
                <Upload size={20} className="text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-700">Drop Etsy CSV here</p>
                <p className="text-xs text-gray-400 mt-1">Auto-extracts Buyer User IDs + Sale Date</p>
                <input id="ufi-csv-input" type="file" accept=".csv" className="hidden" onChange={e => handleFileDrop(e.target.files[0])} />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="truncate">
                    <p className="text-sm font-semibold text-gray-800">{csvFile.name}</p>
                    <p className="text-xs text-gray-400">{(csvFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setCsvFile(null)}><X size={15} /></Button>
                </div>
                <Button onClick={handleUpload} disabled={parsing} className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold h-10 rounded-lg text-sm">
                  {parsing ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Play size={14} className="mr-2" />}
                  {parsing ? "Preparing..." : "Start Crawling"}
                </Button>
              </div>
            )}
            {parseError && (
              <p className="mt-3 text-sm text-red-600 flex items-center gap-2 font-medium bg-red-50 p-2 rounded-lg">
                <AlertCircle size={14}/>{parseError}
              </p>
            )}

            {crawling && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-semibold text-violet-600 flex items-center gap-1"><Activity size={12} className="animate-pulse" /> Crawling live</span>
                  <span className="text-xs font-mono text-gray-400">{currentCrawl} / {totalCrawl}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 transition-all duration-300 rounded-full" style={{ width: `${progressPercent}%` }}/>
                </div>
                {lastLogLine && <p className="mt-2 text-[11px] font-mono bg-gray-800 text-green-400 px-2 py-1.5 rounded-md truncate"> $ {lastLogLine}</p>}
              </div>
            )}
          </div>

          {/* Audience Database */}
          <div className="bg-white rounded-2xl border border-gray-200 flex flex-col max-h-[380px] overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Users size={15} className="text-blue-500"/> Audience Database
                <span className="bg-blue-50 text-blue-600 text-xs px-2 py-0.5 rounded-full font-semibold">{availableFiles.length}</span>
              </h2>
              <Button variant="ghost" onClick={loadFiles} className="text-gray-400 hover:bg-gray-50 rounded-lg p-1.5 h-auto">
                <RefreshCw size={13} className={loadingFiles ? "animate-spin" : ""}/>
              </Button>
            </div>

            {availableFiles.length === 0 ? (
              <div className="flex justify-center items-center gap-2 opacity-40 py-10">
                <FileJson size={28} className="text-gray-300"/>
                <span className="text-sm text-gray-400">No data collected yet.</span>
              </div>
            ) : (
              <div className="overflow-y-auto custom-scrollbar flex-1">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                    <tr>
                      <th className="pl-4 pr-2 py-2.5 w-8">
                        <input type="checkbox"
                          checked={availableFiles.length > 0 && selectedIds.size === availableFiles.length}
                          ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < availableFiles.length; }}
                          onChange={toggleSelectAll}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 cursor-pointer accent-indigo-600"
                        />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Buyer User ID</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider"><ShoppingBag size={12} className="inline mr-1"/>Items</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider"><Store size={12} className="inline mr-1"/>Shops</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {availableFiles.map(f => {
                      const isSelected = selectedIds.has(f.buyer_id);
                      return (
                        <tr key={f.buyer_id} onClick={() => toggleSelectOne(f.buyer_id)} className={`cursor-pointer transition-colors ${isSelected ? "bg-indigo-50/60" : "hover:bg-gray-50"}`}>
                          <td className="pl-4 pr-2 py-2.5" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelectOne(f.buyer_id)}
                              className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 cursor-pointer accent-indigo-600"/>
                          </td>
                          <td className="px-4 py-2.5 font-medium text-violet-600 text-sm" onClick={e => e.stopPropagation()}>
                            <a href={`https://www.etsy.com/people/${f.buyer_id}`} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
                              {f.buyer_id} <ExternalLink size={11} className="text-gray-400"/>
                            </a>
                          </td>
                          <td className="px-4 py-2.5">
                            {f.total_items > 0
                              ? <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded border border-indigo-100 font-semibold">{f.total_items}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {f.total_shops > 0
                              ? <span className="bg-orange-50 text-orange-700 text-xs px-2 py-0.5 rounded border border-orange-100 font-semibold">{f.total_shops}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {selectedIds.size > 0 && (
              <div className="border-t border-indigo-100 bg-indigo-50 px-4 py-2.5 flex items-center gap-3">
                <span className="text-xs font-bold text-indigo-600">{selectedIds.size} selected</span>
                <div className="flex-1" />
                {recrawlingId === "__batch__" ? (
                  <span className="flex items-center gap-1.5 text-xs text-violet-500 font-semibold">
                    <RefreshCw size={12} className="animate-spin" /> Crawling batch...
                  </span>
                ) : (
                  <>
                    <button onClick={() => handleRecrawlSelected({ crawl_items: false, crawl_shops: true })} disabled={!!(crawling || recrawlingId)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <Store size={11} /> Fetch Shops for {selectedIds.size}
                    </button>
                    <button onClick={() => handleRecrawlSelected({ crawl_items: true, crawl_shops: true })} disabled={!!(crawling || recrawlingId)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      <RefreshCw size={11} /> Re-crawl All
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="p-1.5 rounded-md text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 transition-colors" title="Clear selection">
                      <X size={13} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="flex flex-col gap-4">

          {/* Shared Month Filter */}
          <div className="bg-white rounded-2xl border border-gray-200 px-4 py-3 flex items-center gap-3">
            <Calendar size={15} className="text-violet-500 shrink-0" />
            <span className="text-sm font-bold text-gray-700">Filter by Month</span>
            {selectedMonth && (
              <span className="text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">
                {formatMonth(selectedMonth)}
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <select
                value={monthInput}
                onChange={e => setMonthInput(e.target.value)}
                className="text-xs font-semibold text-gray-700 rounded-lg px-2 py-1.5 border border-gray-200 outline-none focus:border-violet-400 bg-white"
              >
                <option value="">All Months</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>{formatMonth(m)}</option>
                ))}
              </select>
              <button
                onClick={() => { setSelectedMonth(monthInput); }}
                className="text-xs font-semibold px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
              >
                Apply
              </button>
              {selectedMonth && (
                <button
                  onClick={() => { setSelectedMonth(""); setMonthInput(""); }}
                  className="text-xs font-semibold px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Favorite Items Table */}
          <div className="bg-white rounded-2xl border border-gray-200 flex flex-col max-h-[480px] overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <ShoppingBag size={15} className="text-indigo-500"/> Favorite Items
                <span className="bg-indigo-50 text-indigo-600 text-xs px-2 py-0.5 rounded-full font-semibold">{sortedItems.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 font-medium">Min users</label>
                <input type="number" min={1} value={itemMinInput}
                  onChange={e => setItemMinInput(Math.max(1, Number(e.target.value)))}
                  onKeyDown={e => e.key === "Enter" && setItemMinUsers(itemMinInput)}
                  className="w-14 text-center text-sm font-semibold text-gray-800 rounded-lg px-2 py-1 border border-gray-200 outline-none focus:border-indigo-400"
                />
                <button onClick={() => { if (!aggregateData) loadAggregate(); setItemMinUsers(itemMinInput); }}
                  className="text-xs font-semibold px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  Confirm
                </button>
                <Button variant="ghost" onClick={loadAggregate} className="text-gray-400 hover:bg-gray-50 rounded-lg p-1.5 h-auto">
                  <RefreshCw size={13} className={loadingAggregate ? "animate-spin" : ""}/>
                </Button>
              </div>
            </div>

            {!aggregateData ? (
              <div className="flex justify-center items-center gap-2 opacity-40 py-10">
                <ShoppingBag size={28} className="text-gray-300"/>
                <span className="text-sm text-gray-400">Set "Min users" and click Confirm to load data.</span>
              </div>
            ) : aggregateData.items.length === 0 ? (
              <div className="flex justify-center items-center gap-2 opacity-40 py-10">
                <ShoppingBag size={28} className="text-gray-300"/>
                <span className="text-sm text-gray-400">No item data yet.</span>
              </div>
            ) : (
              <div className="overflow-y-auto custom-scrollbar flex-1">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none" onClick={() => toggleSort(itemSort, setItemSort, "listing_id")}>
                        Item <SortIcon sortState={itemSort} col="listing_id" />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-24" onClick={() => toggleSort(itemSort, setItemSort, "user_count")}>
                        Users <SortIcon sortState={itemSort} col="user_count" />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">User List</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedItems.map(item => (
                      <tr key={item.listing_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <a href={item.listing_url} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 group">
                            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 shrink-0">
                              {item.image_url
                                ? <img src={item.image_url} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                                : <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">No img</div>
                              }
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-800 group-hover:text-indigo-600 leading-snug line-clamp-2">
                                {item.title || `Listing ${item.listing_id}`}
                              </p>
                              {(item.price || item.currency) && (
                                <p className="text-xs text-green-700 font-bold mt-0.5">{item.currency}{item.price}</p>
                              )}
                              {item.shop_name && <p className="text-[10px] text-gray-400 mt-0.5">{item.shop_name}</p>}
                              {item.review_rating && (
                                <p className="text-[10px] text-amber-500 mt-0.5">★ {item.review_rating}{item.review_count ? ` (${item.review_count})` : ""}</p>
                              )}
                            </div>
                          </a>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded border border-indigo-100 font-bold">{item.user_count}</span>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <div className="flex flex-wrap gap-1">
                            {item.users.slice(0, 5).map(u => (
                              <span key={u} className="px-1.5 py-0.5 text-[10px] bg-white border border-gray-200 rounded text-gray-600 font-medium">{u}</span>
                            ))}
                            {item.users.length > 5 && <span className="text-[10px] text-gray-400 self-center">+{item.users.length - 5}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Favorite Shops Table */}
          <div className="bg-white rounded-2xl border border-gray-200 flex flex-col max-h-[480px] overflow-hidden">
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Store size={15} className="text-orange-500"/> Favorite Shops
                <span className="bg-orange-50 text-orange-600 text-xs px-2 py-0.5 rounded-full font-semibold">{sortedShops.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 font-medium">Min users</label>
                <input type="number" min={1} value={shopMinInput}
                  onChange={e => setShopMinInput(Math.max(1, Number(e.target.value)))}
                  onKeyDown={e => e.key === "Enter" && setShopMinUsers(shopMinInput)}
                  className="w-14 text-center text-sm font-semibold text-gray-800 rounded-lg px-2 py-1 border border-gray-200 outline-none focus:border-orange-400"
                />
                <button onClick={() => { if (!aggregateData) loadAggregate(); setShopMinUsers(shopMinInput); }}
                  className="text-xs font-semibold px-3 py-1 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
                  Confirm
                </button>
              </div>
            </div>

            {!aggregateData ? (
              <div className="flex justify-center items-center gap-2 opacity-40 py-10">
                <Store size={28} className="text-gray-300"/>
                <span className="text-sm text-gray-400">Set "Min users" and click Confirm to load data.</span>
              </div>
            ) : aggregateData.shops.length === 0 ? (
              <div className="flex justify-center items-center gap-2 opacity-40 py-10">
                <Store size={28} className="text-gray-300"/>
                <span className="text-sm text-gray-400">No shop data yet.</span>
              </div>
            ) : (
              <div className="overflow-y-auto custom-scrollbar flex-1">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none" onClick={() => toggleSort(shopSort, setShopSort, "shop_name")}>
                        Shop <SortIcon sortState={shopSort} col="shop_name" />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-24" onClick={() => toggleSort(shopSort, setShopSort, "user_count")}>
                        Users <SortIcon sortState={shopSort} col="user_count" />
                      </th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">User List</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedShops.map(shop => (
                      <tr key={shop.shop_name} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5">
                          <a href={shop.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 group">
                            <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 border border-gray-200 shrink-0">
                              {shop.avatar_url
                                ? <img src={shop.avatar_url} alt="" className="w-full h-full object-cover" />
                                : <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400 font-bold">{shop.shop_name[0]}</div>
                              }
                            </div>
                            <span className="text-xs font-semibold text-orange-600 group-hover:underline">{shop.shop_name}</span>
                            <ExternalLink size={10} className="text-gray-400 shrink-0" />
                          </a>
                        </td>
                        <td className="px-4 py-2.5 align-middle">
                          <span className="bg-orange-50 text-orange-700 text-xs px-2 py-0.5 rounded border border-orange-100 font-bold">{shop.user_count}</span>
                        </td>
                        <td className="px-4 py-2.5 align-middle">
                          <div className="flex flex-wrap gap-1">
                            {shop.users.slice(0, 5).map(u => (
                              <span key={u} className="px-1.5 py-0.5 text-[10px] bg-white border border-gray-200 rounded text-gray-600 font-medium">{u}</span>
                            ))}
                            {shop.users.length > 5 && <span className="text-[10px] text-gray-400 self-center">+{shop.users.length - 5}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
        .custom-scrollbar:hover::-webkit-scrollbar-thumb { background: #d1d5db; }
      `}} />
    </div>
  );
}
