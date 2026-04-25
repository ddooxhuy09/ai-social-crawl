import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { LoadingOverlay } from "../../components/ui/loading-overlay";
import FilterBar from "./FilterBar";

const EMOJI_PRESETS = ["📌","📦","🎨","🔑","🏷️","💎","🌟","✨","🎯","👗","🌸","🏠","🐱","🎀","🌈","🧶"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function kwText(kw) {
  return typeof kw === "string" ? kw : (kw?.keyword || "");
}

/** Compound selection key: "l2Idx::l3Idx::kwIdx" */
function kwKey(l2, l3, ki) {
  return `${l2}::${l3}::${ki}`;
}

function parseCompoundKey(key) {
  const [l2, l3, ki] = key.split("::").map(Number);
  return { l2Idx: l2, l3Idx: l3, kwIdx: ki };
}

// ── Open HEnull button ────────────────────────────────────────────────────────

function OpenHenullButton({ mode = "keyword" }) {
  const [opening, setOpening] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        try { await fetch(`${API_BASE}/api/open_henull?mode=${mode}`, { method: "POST" }); }
        catch (_) {}
        finally { setOpening(false); }
      }}
    >
      {opening ? "⏳ Đang mở..." : "🌐 Mở HEnull"}
    </Button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KeywordTab() {
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
  const [huntCrawling, setHuntCrawling] = useState(false);
  const [huntCrawlProgress, setHuntCrawlProgress] = useState({ current: 0, total: 0, keyword: "" });
  const [crawlLimit, setCrawlLimit] = useState("");
  const [huntHistoryModalOpen, setHuntHistoryModalOpen] = useState(false);

  // ── AI Group Search state ─────────────────────────────────────────────────
  const [groupQuery, setGroupQuery] = useState("");
  const [grouping, setGrouping] = useState(false);
  const [groupingProgress, setGroupingProgress] = useState(null);
  const [groupResults, setGroupResults] = useState({});
  const [groupExpanded, setGroupExpanded] = useState({});
  const [groupL3Expanded, setGroupL3Expanded] = useState({});
  const [groupQCollapsed, setGroupQCollapsed] = useState({});
  const [editingGroupName, setEditingGroupName] = useState(null);
  const [groupSaving, setGroupSaving] = useState({});

  // ── Keyword management state ──────────────────────────────────────────────
  const [editingKw, setEditingKw] = useState(null);        // {query,l2Idx,l3Idx,kwIdx,value}
  const [kwSelection, setKwSelection] = useState({});       // {[query]: Set<"l2::l3::ki">}
  const [moveModal, setMoveModal] = useState(null);         // {query,fromL2,fromL3}
  const [createGroupModal, setCreateGroupModal] = useState(null); // {query,mode:'l2'|'l3',l2Idx?}
  const [createGroupName, setCreateGroupName] = useState("");
  const [createGroupIcon, setCreateGroupIcon] = useState("📌");
  const [newKwInputs, setNewKwInputs] = useState({});       // {"q|||l2|||l3" → string}
  const csvInputRef = useRef(null);
  const [csvTarget, setCsvTarget] = useState(null);         // {query,l2Idx,l3Idx}

  const pollJobRef = useRef(null);

  // ── Poll job ──────────────────────────────────────────────────────────────
  const pollJob = (jobId, onDone, onError, onProgress) => {
    if (pollJobRef.current) clearInterval(pollJobRef.current);
    pollJobRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/etsy_hunt/jobs/${jobId}`);
        if (!r.ok) return;
        const job = await r.json();
        if (onProgress) onProgress(job);
        if (job.status === "done") { clearInterval(pollJobRef.current); pollJobRef.current = null; onDone(job.result); }
        else if (job.status === "error") { clearInterval(pollJobRef.current); pollJobRef.current = null; onError(job.error || "Unknown error"); }
      } catch (_) {}
    }, 5000);
  };

  useEffect(() => () => { if (pollJobRef.current) clearInterval(pollJobRef.current); }, []);
  useEffect(() => { loadHuntHistory(); }, []);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadHuntHistory = async () => {
    setHuntHistoryLoading(true);
    try { const res = await fetch(`${API_BASE}/api/etsy_hunt/history`); setHuntHistory(await res.json()); } catch (_) {}
    setHuntHistoryLoading(false);
  };

  const deleteHuntHistory = async (filename) => {
    if (!window.confirm(`Xóa "${filename}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}`, { method: "DELETE" });
      if (huntDetail?.filename === filename) setHuntDetail(null);
      await loadHuntHistory();
    } catch (_) {}
  };

  const loadHuntDetail = async (filename) => {
    setHuntDetailLoading(true);
    setHuntDetail(null); setHuntFilter(""); setHuntSort({ col: "", dir: "desc" });
    setHuntSelectedRowIds(new Set()); setGroupResults({});
    setGroupQuery(""); setGroupExpanded({}); setGroupL3Expanded({}); setGroupQCollapsed({});
    setKwSelection({}); setEditingKw(null);
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}`);
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setHuntDetail({ ...data, rows: rows.map((r, idx) => ({ ...r, _rowId: `${filename}::${idx}` })) });
      const grpRes = await fetch(`${API_BASE}/api/etsy_hunt/history/${filename}/group-search`);
      if (grpRes.ok) setGroupResults(await grpRes.json());
    } catch (_) {}
    setHuntDetailLoading(false);
  };

  // ── Group Search ──────────────────────────────────────────────────────────
  const handleGroupSearch = async () => {
    if (!huntDetail || !groupQuery.trim()) return;
    setGrouping(true); setGroupingProgress(null);
    let isPolling = false;
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history/${huntDetail.filename}/group-search`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: groupQuery.trim() }) });
      if (!res.ok) throw new Error((await res.json()).detail || "Lỗi AI");
      const data = await res.json();
      if (data.job_id) {
        isPolling = true;
        setGroupingProgress({ stage: "queued", done: 0, total: data.total });
        pollJob(data.job_id,
          (result) => {
            setGroupResults(result); setGrouping(false); setGroupingProgress(null);
            const q = data.query; const entry = result[q];
            if (entry?.groups?.length > 0) setGroupExpanded((p) => ({ ...p, [`${q}::${entry.groups[0].group}`]: true }));
            setGroupQCollapsed((p) => ({ ...p, [q]: false }));
          },
          (err) => { alert(`AI Group Search thất bại: ${err}`); setGrouping(false); setGroupingProgress(null); },
          (job) => setGroupingProgress({ stage: job.stage, done: job.done || 0, total: job.total || data.total }),
        );
        return;
      }
      setGroupResults(data);
      const q = groupQuery.trim(); const entry = data[q];
      if (entry?.groups?.length > 0) setGroupExpanded((p) => ({ ...p, [`${q}::${entry.groups[0].group}`]: true }));
      setGroupQCollapsed((p) => ({ ...p, [q]: false }));
    } catch (e) { alert(`AI Group Search thất bại: ${e.message}`); }
    finally { if (!isPolling) setGrouping(false); }
  };

  const handleDeleteGroupSearch = async (query) => {
    if (!huntDetail) return;
    await fetch(`${API_BASE}/api/etsy_hunt/history/${huntDetail.filename}/group-search/${encodeURIComponent(query)}`, { method: "DELETE" });
    setGroupResults((prev) => { const n = { ...prev }; delete n[query]; return n; });
  };

  const handleSaveGroupSearch = async (query) => {
    if (!huntDetail) return;
    setGroupSaving((p) => ({ ...p, [query]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/etsy_hunt/history/${huntDetail.filename}/group-search/${encodeURIComponent(query)}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(groupResults[query]?.groups || []) });
      if (!res.ok) throw new Error("Lưu thất bại.");
      alert(`Đã lưu cấu trúc nhóm cho "${query}"!`);
    } catch (e) { alert(e.message); }
    finally { setGroupSaving((p) => ({ ...p, [query]: false })); }
  };

  const updateGroupName = (query, l2Idx, l3Idx, newName) => {
    setGroupResults((prev) => {
      const draft = { ...prev }; const q = { ...draft[query] }; const groups = [...(q.groups || [])];
      const l2 = { ...groups[l2Idx] };
      if (l3Idx === null) { l2.group = newName; }
      else { const subs = [...(l2.subgroups || [])]; subs[l3Idx] = { ...subs[l3Idx], group: newName }; l2.subgroups = subs; }
      groups[l2Idx] = l2; q.groups = groups; draft[query] = q; return draft;
    });
  };

  const deleteGroupNode = (query, l2Idx, l3Idx) => {
    if (!window.confirm("Xóa nhóm này? Các từ khóa sẽ chuyển về Khác > Uncategorized")) return;
    setGroupResults((prev) => {
      const draft = { ...prev }; const q = { ...draft[query] }; const groups = [...(q.groups || [])];
      let removedKws = [];
      const l2 = { ...groups[l2Idx] };
      if (l3Idx === null) {
        (l2.subgroups || []).forEach((s) => removedKws.push(...(s.keywords || [])));
        groups.splice(l2Idx, 1);
      } else {
        const subs = [...(l2.subgroups || [])];
        removedKws.push(...(subs[l3Idx].keywords || []));
        subs.splice(l3Idx, 1);
        l2.subgroups = subs; l2.count = subs.reduce((s, sg) => s + (sg.keywords?.length || 0), 0);
        groups[l2Idx] = l2;
      }
      if (removedKws.length > 0) {
        let ui = groups.findIndex((g) => g.group === "Khác" || g.group === "Other");
        if (ui === -1) { groups.push({ group: "Khác", icon: "📦", count: 0, subgroups: [] }); ui = groups.length - 1; }
        const ul2 = { ...groups[ui] }; const usubs = [...(ul2.subgroups || [])];
        let usi = usubs.findIndex((s) => s.group === "Uncategorized");
        if (usi === -1) { usubs.push({ group: "Uncategorized", icon: "🗑️", count: 0, keywords: [] }); usi = usubs.length - 1; }
        const ul3 = { ...usubs[usi] }; const ukws = [...(ul3.keywords || [])];
        const ex = new Set(ukws.map((k) => kwText(k).toLowerCase()));
        for (const k of removedKws) { if (!ex.has(kwText(k).toLowerCase())) ukws.push(k); }
        ul3.keywords = ukws; ul3.count = ukws.length; usubs[usi] = ul3;
        ul2.subgroups = usubs; ul2.count = usubs.reduce((s, sg) => s + (sg.keywords?.length || 0), 0);
        groups[ui] = ul2;
      }
      q.groups = groups; q.total = groups.reduce((s, g) => s + (g.count || 0), 0); draft[query] = q; return draft;
    });
  };

  // ── Keyword management ────────────────────────────────────────────────────

  const renameKeyword = (query, l2Idx, l3Idx, kwIdx, newText) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setGroupResults((prev) => {
      const entry = prev[query];
      const groups = entry.groups.map((g, gi) => gi !== l2Idx ? g : {
        ...g, subgroups: g.subgroups.map((sg, si) => si !== l3Idx ? sg : {
          ...sg, keywords: sg.keywords.map((kw, ki) => ki !== kwIdx ? kw :
            (typeof kw === "string" ? trimmed : { ...kw, keyword: trimmed })
          )
        })
      });
      return { ...prev, [query]: { ...entry, groups } };
    });
    setEditingKw(null);
  };

  const removeKeywords = (query, compoundKeys) => {
    // Group by l2::l3
    const byGroup = {};
    for (const key of compoundKeys) {
      const { l2Idx, l3Idx, kwIdx } = parseCompoundKey(key);
      const gk = `${l2Idx}::${l3Idx}`;
      if (!byGroup[gk]) byGroup[gk] = { l2Idx, l3Idx, idxSet: new Set() };
      byGroup[gk].idxSet.add(kwIdx);
    }
    setGroupResults((prev) => {
      const entry = prev[query];
      const groups = entry.groups.map((g, gi) => {
        const subgroups = g.subgroups.map((sg, si) => {
          const match = byGroup[`${gi}::${si}`];
          if (!match) return sg;
          const keywords = sg.keywords.filter((_, ki) => !match.idxSet.has(ki));
          return { ...sg, keywords, count: keywords.length };
        });
        return { ...g, subgroups, count: subgroups.reduce((s, sg) => s + sg.count, 0) };
      });
      return { ...prev, [query]: { ...entry, groups, total: groups.reduce((s, g) => s + g.count, 0) } };
    });
    setKwSelection((prev) => {
      const qSel = new Set(prev[query] || []);
      for (const key of compoundKeys) qSel.delete(key);
      return { ...prev, [query]: qSel };
    });
  };

  const moveKeywords = (toL2Idx, toL3Idx) => {
    const { query, fromL2, fromL3 } = moveModal;
    const prefix = `${fromL2}::${fromL3}::`;
    const keysToMove = [...(kwSelection[query] || [])].filter((k) => k.startsWith(prefix));
    if (!keysToMove.length) { setMoveModal(null); return; }

    // Collect keyword objects before mutating
    const entry = groupResults[query];
    const kwsToMove = keysToMove.map((k) => {
      const { kwIdx } = parseCompoundKey(k);
      return entry.groups[fromL2]?.subgroups[fromL3]?.keywords[kwIdx];
    }).filter(Boolean);

    const idxSet = new Set(keysToMove.map((k) => parseCompoundKey(k).kwIdx));

    setGroupResults((prev) => {
      const e = prev[query];
      const groups = e.groups.map((g, gi) => {
        if (gi === fromL2 && gi !== toL2Idx) {
          // Pure source (different from dest L2)
          const subgroups = g.subgroups.map((sg, si) => {
            if (si !== fromL3) return sg;
            const keywords = sg.keywords.filter((_, ki) => !idxSet.has(ki));
            return { ...sg, keywords, count: keywords.length };
          });
          return { ...g, subgroups, count: subgroups.reduce((s, sg) => s + sg.count, 0) };
        }
        if (gi === toL2Idx && gi !== fromL2) {
          // Pure dest (different from source L2)
          const subgroups = g.subgroups.map((sg, si) => {
            if (si !== toL3Idx) return sg;
            const kws = [...sg.keywords];
            const ex = new Set(kws.map((k) => kwText(k).toLowerCase()));
            for (const kw of kwsToMove) { if (!ex.has(kwText(kw).toLowerCase())) kws.push(kw); }
            return { ...sg, keywords: kws, count: kws.length };
          });
          return { ...g, subgroups, count: subgroups.reduce((s, sg) => s + sg.count, 0) };
        }
        if (gi === fromL2 && gi === toL2Idx) {
          // Same L2, different L3
          const subgroups = g.subgroups.map((sg, si) => {
            if (si === fromL3) {
              const keywords = sg.keywords.filter((_, ki) => !idxSet.has(ki));
              return { ...sg, keywords, count: keywords.length };
            }
            if (si === toL3Idx) {
              const kws = [...sg.keywords];
              const ex = new Set(kws.map((k) => kwText(k).toLowerCase()));
              for (const kw of kwsToMove) { if (!ex.has(kwText(kw).toLowerCase())) kws.push(kw); }
              return { ...sg, keywords: kws, count: kws.length };
            }
            return sg;
          });
          return { ...g, subgroups, count: subgroups.reduce((s, sg) => s + sg.count, 0) };
        }
        return g;
      });
      return { ...prev, [query]: { ...e, groups, total: groups.reduce((s, g) => s + g.count, 0) } };
    });

    setKwSelection((prev) => {
      const qSel = new Set(prev[query] || []);
      for (const k of keysToMove) qSel.delete(k);
      return { ...prev, [query]: qSel };
    });
    setMoveModal(null);
  };

  const createGroup = () => {
    const name = createGroupName.trim();
    if (!name) return;
    const { query, mode, l2Idx } = createGroupModal;
    setGroupResults((prev) => {
      const entry = prev[query];
      const groups = [...entry.groups];
      if (mode === "l2") {
        groups.push({ group: name, icon: createGroupIcon, count: 0, subgroups: [] });
      } else {
        const l2 = { ...groups[l2Idx] };
        const subs = [...(l2.subgroups || [])];
        subs.push({ group: name, icon: createGroupIcon, count: 0, keywords: [] });
        l2.subgroups = subs;
        groups[l2Idx] = l2;
      }
      return { ...prev, [query]: { ...entry, groups } };
    });
    setCreateGroupModal(null); setCreateGroupName(""); setCreateGroupIcon("📌");
  };

  const addKeyword = (query, l2Idx, l3Idx, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setGroupResults((prev) => {
      const entry = prev[query];
      const groups = entry.groups.map((g, gi) => gi !== l2Idx ? g : {
        ...g, subgroups: g.subgroups.map((sg, si) => {
          if (si !== l3Idx) return sg;
          const ex = new Set((sg.keywords || []).map((k) => kwText(k).toLowerCase()));
          if (ex.has(trimmed.toLowerCase())) return sg;
          const keywords = [...(sg.keywords || []), trimmed];
          return { ...sg, keywords, count: keywords.length };
        }),
        count: undefined, // recalc below
      });
      // Recalc counts
      const recalc = groups.map((g) => ({ ...g, count: (g.subgroups || []).reduce((s, sg) => s + (sg.keywords?.length || 0), 0) }));
      return { ...prev, [query]: { ...entry, groups: recalc, total: recalc.reduce((s, g) => s + g.count, 0) } };
    });
    setNewKwInputs((prev) => ({ ...prev, [`${query}|||${l2Idx}|||${l3Idx}`]: "" }));
  };

  const handleCSVImport = (e) => {
    const file = e.target.files?.[0];
    if (!file || !csvTarget) return;
    e.target.value = "";
    const { query, l2Idx, l3Idx } = csvTarget;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase());
      const kwCol = header.findIndex((h) => h === "keyword" || h === "keywords");
      const newKws = lines.slice(kwCol >= 0 ? 1 : 0).map((l) => {
        const cols = l.split(",");
        return cols[kwCol >= 0 ? kwCol : 0]?.replace(/"/g, "").trim();
      }).filter(Boolean);

      setGroupResults((prev) => {
        const entry = prev[query];
        const groups = entry.groups.map((g, gi) => gi !== l2Idx ? g : {
          ...g, subgroups: g.subgroups.map((sg, si) => {
            if (si !== l3Idx) return sg;
            const ex = new Set((sg.keywords || []).map((k) => kwText(k).toLowerCase()));
            const kws = [...(sg.keywords || [])];
            for (const kw of newKws) { if (!ex.has(kw.toLowerCase())) { kws.push(kw); ex.add(kw.toLowerCase()); } }
            return { ...sg, keywords: kws, count: kws.length };
          }),
        });
        const recalc = groups.map((g) => ({ ...g, count: (g.subgroups || []).reduce((s, sg) => s + (sg.keywords?.length || 0), 0) }));
        return { ...prev, [query]: { ...entry, groups: recalc, total: recalc.reduce((s, g) => s + g.count, 0) } };
      });
      alert(`✅ Đã thêm ${newKws.length} từ khóa từ CSV!`);
      setCsvTarget(null);
    };
    reader.readAsText(file);
  };

  // ── Selection helpers ─────────────────────────────────────────────────────

  const getTableSelected = (query, l2Idx, l3Idx) => {
    const prefix = `${l2Idx}::${l3Idx}::`;
    return new Set([...(kwSelection[query] || [])].filter((k) => k.startsWith(prefix)));
  };

  const toggleKwSelect = (query, compoundKey) => {
    setKwSelection((prev) => {
      const qSel = new Set(prev[query] || []);
      if (qSel.has(compoundKey)) qSel.delete(compoundKey); else qSel.add(compoundKey);
      return { ...prev, [query]: qSel };
    });
  };

  const toggleAllInTable = (query, l2Idx, l3Idx, keywords) => {
    const tSel = getTableSelected(query, l2Idx, l3Idx);
    const allSelected = tSel.size === keywords.length && keywords.length > 0;
    setKwSelection((prev) => {
      const qSel = new Set(prev[query] || []);
      if (allSelected) { tSel.forEach((k) => qSel.delete(k)); }
      else { keywords.forEach((_, ki) => qSel.add(kwKey(l2Idx, l3Idx, ki))); }
      return { ...prev, [query]: qSel };
    });
  };

  const clearTableSelection = (query, l2Idx, l3Idx) => {
    setKwSelection((prev) => {
      const qSel = new Set(prev[query] || []);
      getTableSelected(query, l2Idx, l3Idx).forEach((k) => qSel.delete(k));
      return { ...prev, [query]: qSel };
    });
  };

  // ── Keyword row selection & crawl ─────────────────────────────────────────

  const toggleHuntRow = (rowId) => {
    setHuntSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const handleCrawlSelected = async () => {
    if (!huntDetail || huntSelectedRowIds.size === 0) return;
    const selectedKeywords = huntDetail.rows.filter((r) => huntSelectedRowIds.has(r._rowId)).map((r) => r.keyword).filter(Boolean);
    if (!selectedKeywords.length) return;
    setHuntCrawling(true);
    setHuntCrawlProgress({ current: 0, total: selectedKeywords.length, keyword: "" });
    for (let i = 0; i < selectedKeywords.length; i++) {
      const kw = selectedKeywords[i];
      setHuntCrawlProgress({ current: i + 1, total: selectedKeywords.length, keyword: kw });
      try {
        await fetch(`${API_BASE}/api/search`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: kw, limit_per_source: crawlLimit ? parseInt(crawlLimit) : "max" }),
        });
      } catch (_) {}
    }
    setHuntCrawling(false);
    setHuntCrawlProgress({ current: 0, total: 0, keyword: "" });
    alert("✅ Toàn bộ keyword đã được thêm vào hàng đợi xử lý tuần tự!");
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const huntActiveFilterCount = Object.keys(huntFilters).length;

  const huntFilteredRows = useMemo(() => {
    if (!huntDetail) return [];
    let rows = huntDetail.rows;
    if (huntFilter.trim()) { const q = huntFilter.toLowerCase(); rows = rows.filter((r) => (r.keyword || "").toLowerCase().includes(q)); }
    for (const [key, [min, max]] of Object.entries(huntFilters)) {
      rows = rows.filter((r) => { const v = parseFloat(r[key]) || 0; return (min == null || v >= min) && (max == null || v <= max); });
    }
    if (huntSort.col) {
      rows = [...rows].sort((a, b) => {
        const va = parseFloat(a[huntSort.col]) || 0, vb = parseFloat(b[huntSort.col]) || 0;
        return huntSort.dir === "asc" ? va - vb : vb - va;
      });
    }
    return rows;
  }, [huntDetail, huntFilter, huntFilters, huntSort]);


  // ── KwTable ───────────────────────────────────────────────────────────────

  const KwTable = ({ keywords, query, l2Idx, l3Idx }) => {
    const tSel = getTableSelected(query, l2Idx, l3Idx);
    const allSel = tSel.size === keywords.length && keywords.length > 0;
    const tableInputKey = `${query}|||${l2Idx}|||${l3Idx}`;
    const newKwVal = newKwInputs[tableInputKey] || "";

    const firstKw = keywords[0] || {};
    const numCols = Object.keys(firstKw).filter((k) => k !== "keyword" && k !== "_rowId" && firstKw[k] !== "" && !isNaN(Number(firstKw[k])));

    return (
      <div className="overflow-x-auto">
        {/* Bulk action bar */}
        {tSel.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-sky-50 border border-sky-200 rounded-lg text-xs">
            <span className="font-semibold text-sky-700">{tSel.size} đã chọn</span>
            <Button size="xs" variant="outline-sky"
              onClick={() => setMoveModal({ query, fromL2: l2Idx, fromL3: l3Idx })}>
              ↪ Chuyển nhóm
            </Button>
            <Button size="xs" variant="outline-red"
              onClick={() => { if (window.confirm(`Xóa ${tSel.size} từ khóa?`)) removeKeywords(query, tSel); }}>
              🗑 Xóa
            </Button>
            <button type="button" onClick={() => clearTableSelection(query, l2Idx, l3Idx)}
              className="ml-auto text-gray-400 hover:text-gray-600 text-xs">✕ Bỏ chọn</button>
          </div>
        )}

        <table className="border-collapse text-xs w-full" style={{ minWidth: 700 }}>
          <thead>
            <tr className="bg-gray-50">
              <th className="px-2 py-1.5 border-b border-gray-200 sticky left-0 bg-gray-50 w-8">
                <input type="checkbox" checked={allSel} onChange={() => toggleAllInTable(query, l2Idx, l3Idx, keywords)} className="cursor-pointer" />
              </th>
              <th className="px-2 py-1.5 text-left font-medium text-gray-500 border-b border-gray-200 sticky bg-gray-50 whitespace-nowrap" style={{ left: 32 }}>#</th>
              <th className="px-3 py-1.5 text-left font-medium text-gray-500 border-b border-gray-200 bg-gray-50 whitespace-nowrap" style={{ position: "sticky", left: 56 }}>keyword</th>
              {numCols.map((col) => (
                <th key={col} className="px-3 py-1.5 text-right font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap">{col}</th>
              ))}
              <th className="px-2 py-1.5 border-b border-gray-200 w-8 sticky right-0 bg-gray-50"></th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((row, ri) => {
              const kw = kwText(row);
              const ck = kwKey(l2Idx, l3Idx, ri);
              const isSelected = tSel.has(ck);
              const isEditing = editingKw?.query === query && editingKw.l2Idx === l2Idx && editingKw.l3Idx === l3Idx && editingKw.kwIdx === ri;
              const rowBg = isSelected ? "bg-sky-50" : ri % 2 === 0 ? "bg-white" : "bg-gray-50/60";
              return (
                <tr key={ri} className={`group/kw ${rowBg} hover:bg-sky-50/40 transition-colors`}>
                  {/* Checkbox */}
                  <td className={`px-2 py-1.5 border-b border-gray-100 sticky left-0 ${rowBg}`} style={{ width: 32 }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleKwSelect(query, ck)} className="cursor-pointer" />
                  </td>
                  {/* Row number */}
                  <td className={`px-2 py-1.5 border-b border-gray-100 text-gray-400 sticky text-right ${rowBg}`} style={{ left: 32, width: 24 }}>{ri + 1}</td>
                  {/* Keyword (editable) */}
                  <td className={`px-3 py-1.5 border-b border-gray-100 font-medium text-gray-800 whitespace-nowrap ${rowBg}`} style={{ position: "sticky", left: 56 }}>
                    {isEditing ? (
                      <input
                        autoFocus type="text" value={editingKw.value}
                        onChange={(e) => setEditingKw({ ...editingKw, value: e.target.value })}
                        onBlur={() => renameKeyword(query, l2Idx, l3Idx, ri, editingKw.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          else if (e.key === "Escape") setEditingKw(null);
                        }}
                        className="border border-violet-300 rounded px-1 py-0.5 text-xs outline-none w-48 bg-white"
                      />
                    ) : (
                      <span onDoubleClick={() => setEditingKw({ query, l2Idx, l3Idx, kwIdx: ri, value: kw })}
                        className="cursor-text select-text" title="Double-click to edit">
                        {kw}
                      </span>
                    )}
                  </td>
                  {/* Metrics */}
                  {numCols.map((col) => (
                    <td key={col} className="px-3 py-1.5 text-right border-b border-gray-100 whitespace-nowrap text-gray-600">
                      {row[col] !== undefined && row[col] !== "" ? Number(row[col]).toLocaleString() : "—"}
                    </td>
                  ))}
                  {/* Delete */}
                  <td className="px-2 py-1.5 border-b border-gray-100 sticky right-0 text-center" style={{ background: "inherit" }}>
                    <button type="button"
                      onClick={() => { if (window.confirm(`Xóa "${kw}"?`)) removeKeywords(query, new Set([ck])); }}
                      className="opacity-0 group-hover/kw:opacity-100 text-gray-300 hover:text-red-500 transition-all text-xs">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Add keyword row */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-t border-gray-100 bg-white">
          <span className="text-gray-300 text-xs">＋</span>
          <input
            type="text"
            placeholder="Thêm từ khóa..."
            value={newKwVal}
            onChange={(e) => setNewKwInputs((p) => ({ ...p, [tableInputKey]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") addKeyword(query, l2Idx, l3Idx, newKwVal); }}
            className="flex-1 text-xs border-0 outline-none text-gray-600 placeholder-gray-300 bg-transparent"
          />
          {newKwVal.trim() && (
            <button type="button" onClick={() => addKeyword(query, l2Idx, l3Idx, newKwVal)}
              className="text-xs text-violet-500 hover:text-violet-700 font-medium">Thêm</button>
          )}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Hidden CSV input */}
      <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />

      {huntCrawling && (
        <LoadingOverlay
          title={`Đang crawl ${huntCrawlProgress.current}/${huntCrawlProgress.total}${huntCrawlProgress.keyword ? ` — "${huntCrawlProgress.keyword}"` : ""}`}
          subtitle="Vui lòng chờ, không thao tác thêm."
          spinnerColor="#10b981"
        />
      )}

      {/* ── History button ──────────────────────────────────────────────────── */}
      <div className="mb-4 flex gap-2 items-center flex-wrap">
        <Button variant="outline" onClick={() => { setHuntHistoryModalOpen(true); loadHuntHistory(); }}>
          📂 Lịch sử keyword
          {huntHistory.length > 0 && <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5">{huntHistory.length}</span>}
        </Button>
        <OpenHenullButton mode="keyword" />
      </div>

      {/* ── History modal ───────────────────────────────────────────────────── */}
      {huntHistoryModalOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setHuntHistoryModalOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <p className="text-base font-semibold text-gray-900">Lịch sử Etsy keyword</p>
                {huntHistory.length > 0 && <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{huntHistory.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="xs" onClick={loadHuntHistory} disabled={huntHistoryLoading}>{huntHistoryLoading ? "Đang tải..." : "Tải lại"}</Button>
                <button type="button" onClick={() => setHuntHistoryModalOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none cursor-pointer px-1">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-4">
              {huntHistoryLoading && huntHistory.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">Đang tải...</p>
              ) : huntHistory.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">Chưa có lịch sử nào.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {huntHistory.map((item) => {
                    const isActive = huntDetail?.filename === item.filename;
                    const nm = item.filename.match(/etsy_keywords_(.+?)_(\d{8}_\d{6})\.csv$/);
                    const displayName = nm ? nm[1] : item.filename.replace(".csv", "");
                    const displayDate = nm ? (() => { const d = nm[2]; return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)} ${d.slice(9,11)}:${d.slice(11,13)}`; })() : item.created_at;
                    return (
                      <div key={item.filename} className={`rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-all ${isActive ? "border-sky-400 bg-sky-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                        <button type="button" className="flex-1 text-left cursor-pointer min-w-0"
                          onClick={() => { loadHuntDetail(item.filename); setHuntHistoryModalOpen(false); }}>
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-sky-700" : "text-gray-900"}`}>{displayName}</p>
                          <p className="text-[0.68rem] text-gray-400 mt-0.5">{displayDate} · {item.size_kb} KB</p>
                        </button>
                        <div className="flex gap-1.5 shrink-0">
                          <a href={`${API_BASE}/api/etsy_hunt/history/${item.filename}/download`}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 no-underline cursor-pointer" download>CSV</a>
                          <button type="button" onClick={() => deleteHuntHistory(item.filename)}
                            className="text-[0.68rem] px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer">Xóa</button>
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

      {/* ── Keyword detail ────────────────────────────────────────────────────── */}
      {huntDetailLoading && <p className="text-xs text-gray-400 py-3">Đang tải dữ liệu...</p>}

      {huntDetail && !huntDetailLoading && (() => {
        const cols = huntDetail.rows.length > 0 ? Object.keys(huntDetail.rows[0]) : [];
        const numCols = cols.filter((c) => c !== "keyword" && c !== "_rowId");
        const CHECK_W = 42, STT_W = 56, KEY_LEFT = 98;
        const allVisibleSelected = huntFilteredRows.length > 0 && huntFilteredRows.every((r) => huntSelectedRowIds.has(r._rowId));

        return (
          <div>
            {/* Detail header */}
            <div className="flex gap-2 items-center mb-3 flex-wrap">
              <p className="text-sm font-semibold text-gray-900">{huntDetail.filename} &mdash; {huntDetail.total} keywords</p>
              <Input type="text" placeholder="Lọc keyword..." value={huntFilter} onChange={(e) => setHuntFilter(e.target.value)} className="w-44" />
              <div className="flex items-center gap-1.5 ml-auto">
                <Input type="text" placeholder="AI search... (e.g. cat)" value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGroupSearch()}
                  className="w-48" disabled={grouping} />
                <button type="button" onClick={handleGroupSearch} disabled={grouping || !groupQuery.trim()}
                  className="px-3 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-600 disabled:opacity-50 transition-colors whitespace-nowrap">
                  {grouping && groupingProgress
                    ? `⏳ ${groupingProgress.stage === "cluster" ? "Gom cụm" : "Nhúng"} ${groupingProgress.done}/${groupingProgress.total}`
                    : grouping ? "⏳ AI..." : "✨ AI Group"}
                </button>
                {Object.keys(groupResults).length > 0 && (
                  <span className="text-xs text-violet-600 font-medium ml-1">{Object.keys(groupResults).length} saved</span>
                )}
              </div>
              <span className="text-xs text-gray-500">
                Hiển thị: {huntFilteredRows.length}
                {huntSelectedRowIds.size > 0 && <span className="ml-1.5 text-sky-500 font-semibold">| Đã chọn: {huntSelectedRowIds.size}</span>}
              </span>
              {huntSelectedRowIds.size > 0 && (
                <div className="flex items-center gap-1.5">
                  <input type="number" min={1} max={200} value={crawlLimit} onChange={(e) => setCrawlLimit(e.target.value)} placeholder="max"
                    disabled={huntCrawling}
                    className="w-16 px-2 py-1 text-xs border border-gray-300 rounded-lg text-center focus:outline-none focus:border-emerald-400 disabled:opacity-50"
                    title="Số lượng kết quả mỗi nguồn" />
                  <span className="text-xs text-gray-400">/ nguồn</span>
                  <Button variant="emerald" size="sm" disabled={huntCrawling} onClick={handleCrawlSelected}>
                    {huntCrawling ? `⏳ Crawling ${huntCrawlProgress.current}/${huntCrawlProgress.total}...` : `🔍 Crawl ${huntSelectedRowIds.size} keywords`}
                  </Button>
                </div>
              )}
              {huntCrawling && huntCrawlProgress.keyword && <span className="text-xs text-gray-500">→ {huntCrawlProgress.keyword}</span>}
              <div className="ml-auto flex items-center gap-2">
                <a href={`${API_BASE}/api/etsy_hunt/history/${huntDetail.filename}/download`}
                  className="px-3 py-1.5 rounded-full border border-gray-300 text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 no-underline transition-colors">Tải CSV</a>
              </div>
            </div>

            <FilterBar huntFilters={huntFilters} setHuntFilters={setHuntFilters}
              huntOpenFilter={huntOpenFilter} setHuntOpenFilter={setHuntOpenFilter}
              huntDraft={huntDraft} setHuntDraft={setHuntDraft}
              huntActiveFilterCount={huntActiveFilterCount} />

            {/* ── Group Search Results ─────────────────────────────────────────── */}
            {Object.keys(groupResults).length > 0 && Object.entries(groupResults).map(([q, entry]) => {
              const qCollapsed = !!groupQCollapsed[q];
              return (
                <div key={q} className="mb-3 rounded-xl border border-violet-200 bg-violet-50/60 overflow-hidden">
                  {/* Query header */}
                  <div className="px-4 py-2.5 border-b border-violet-200 flex items-center gap-2">
                    <button type="button" onClick={() => setGroupQCollapsed((p) => ({ ...p, [q]: !p[q] }))}
                      className="flex items-center gap-2 flex-1 text-left">
                      <span className="text-xs font-bold text-violet-700">✨ "{q}"</span>
                      <span className="text-xs text-violet-500">{entry.total} keywords · {(entry.groups || []).length} groups</span>
                      <span className="text-xs text-violet-400 ml-1">{qCollapsed ? "▼" : "▲"}</span>
                    </button>
                    <Button size="xs" variant="outline-sky"
                      onClick={() => { setCreateGroupModal({ query: q, mode: "l2", l2Idx: null }); setCreateGroupName(""); setCreateGroupIcon("📌"); }}>
                      ＋ Nhóm mới
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleSaveGroupSearch(q)} disabled={groupSaving[q]}>
                      {groupSaving[q] ? "Đang lưu..." : "💾 Lưu"}
                    </Button>
                    <button type="button" onClick={() => handleDeleteGroupSearch(q)} className="text-xs text-gray-400 hover:text-red-500 px-1.5">✕</button>
                  </div>

                  {!qCollapsed && (
                    <div className="divide-y divide-violet-100">
                      {(entry.groups || []).map((l2, l2Idx) => {
                        const l2Key = `${q}::${l2.group}`;
                        const l2Open = !!groupExpanded[l2Key];
                        const isEditingL2 = editingGroupName?.key === l2Key;
                        return (
                          <div key={l2Key}>
                            {/* L2 header */}
                            <div className="group/l2 w-full flex items-center gap-2 px-4 py-2 hover:bg-violet-100/60 transition-colors">
                              <button type="button" onClick={() => setGroupExpanded((p) => ({ ...p, [l2Key]: !p[l2Key] }))} className="flex-1 flex items-center gap-2 text-left">
                                <span className="text-base">{l2.icon}</span>
                                {isEditingL2 ? (
                                  <input autoFocus type="text" value={editingGroupName.value}
                                    onChange={(e) => setEditingGroupName({ ...editingGroupName, value: e.target.value })}
                                    onBlur={() => { if (editingGroupName.value.trim()) updateGroupName(q, l2Idx, null, editingGroupName.value.trim()); setEditingGroupName(null); }}
                                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") setEditingGroupName(null); }}
                                    className="text-sm font-bold text-gray-800 bg-white border border-violet-300 rounded px-1 w-48 outline-none"
                                    onClick={(e) => e.stopPropagation()} />
                                ) : (
                                  <span className="text-sm font-bold text-gray-800">{l2.group}</span>
                                )}
                                <span className="text-xs text-gray-400 ml-1">({l2.count} · {(l2.subgroups || []).length} subgroups)</span>
                              </button>
                              <div className="flex items-center gap-1 opacity-0 group-hover/l2:opacity-100 transition-opacity">
                                <button type="button" onClick={() => setEditingGroupName({ key: l2Key, value: l2.group })} className="text-gray-400 hover:text-violet-600 px-1 text-xs" title="Đổi tên">✏️</button>
                                <button type="button"
                                  onClick={() => { setCreateGroupModal({ query: q, mode: "l3", l2Idx }); setCreateGroupName(""); setCreateGroupIcon("📌"); }}
                                  className="text-gray-400 hover:text-violet-600 px-1 text-xs" title="Thêm nhóm con">＋</button>
                                {l2.group !== "Khác" && (
                                  <button type="button" onClick={() => deleteGroupNode(q, l2Idx, null)} className="text-gray-400 hover:text-red-500 px-1 text-xs" title="Xóa nhóm">🗑️</button>
                                )}
                              </div>
                              <span className="text-gray-400 text-xs ml-2 pointer-events-none">{l2Open ? "▲" : "▼"}</span>
                            </div>

                            {/* L3 subgroups */}
                            {l2Open && (
                              <div className="border-t border-violet-100 bg-white">
                                {(l2.subgroups || []).map((l3, l3Idx) => {
                                  const l3Key = `${q}::${l2.group}::${l3.group}`;
                                  const l3Open = !!groupL3Expanded[l3Key];
                                  const isEditingL3 = editingGroupName?.key === l3Key;
                                  return (
                                    <div key={l3Key} className="border-b border-gray-100 last:border-0">
                                      {/* L3 header */}
                                      <div className="group/l3 w-full flex items-center gap-2 pl-8 pr-4 py-1.5 hover:bg-gray-50 transition-colors">
                                        <button type="button" onClick={() => setGroupL3Expanded((p) => ({ ...p, [l3Key]: !p[l3Key] }))} className="flex-1 flex items-center gap-2 text-left">
                                          <span className="text-sm">{l3.icon}</span>
                                          {isEditingL3 ? (
                                            <input autoFocus type="text" value={editingGroupName.value}
                                              onChange={(e) => setEditingGroupName({ ...editingGroupName, value: e.target.value })}
                                              onBlur={() => { if (editingGroupName.value.trim()) updateGroupName(q, l2Idx, l3Idx, editingGroupName.value.trim()); setEditingGroupName(null); }}
                                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") setEditingGroupName(null); }}
                                              className="text-xs font-semibold text-gray-700 bg-white border border-violet-300 rounded px-1 outline-none w-40"
                                              onClick={(e) => e.stopPropagation()} />
                                          ) : (
                                            <span className="text-xs font-semibold text-gray-700">{l3.group}</span>
                                          )}
                                          <span className="text-xs text-gray-400 ml-1">({l3.count})</span>
                                        </button>
                                        <div className="flex items-center gap-1 opacity-0 group-hover/l3:opacity-100 transition-opacity">
                                          <button type="button" onClick={() => setEditingGroupName({ key: l3Key, value: l3.group })} className="text-gray-400 hover:text-violet-600 px-1 text-xs" title="Đổi tên">✏️</button>
                                          <button type="button"
                                            onClick={() => { setCsvTarget({ query: q, l2Idx, l3Idx }); csvInputRef.current?.click(); }}
                                            className="text-gray-400 hover:text-sky-500 px-1 text-xs" title="Import CSV">📥</button>
                                          {l3.group !== "Uncategorized" && (
                                            <button type="button" onClick={() => deleteGroupNode(q, l2Idx, l3Idx)} className="text-gray-400 hover:text-red-500 px-1 text-xs" title="Xóa nhóm">🗑️</button>
                                          )}
                                        </div>
                                        <span className="text-gray-400 text-xs ml-2 pointer-events-none">{l3Open ? "▲" : "▼"}</span>
                                      </div>

                                      {/* Keyword table */}
                                      {l3Open && (
                                        <div className="pl-8 pb-2">
                                          <KwTable keywords={l3.keywords || []} query={q} l2Idx={l2Idx} l3Idx={l3Idx} />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Keyword CSV table ──────────────────────────────────────────────── */}
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-2.5 py-2 text-center border-b border-gray-200 sticky left-0 bg-gray-50 z-[3]" style={{ width: CHECK_W, minWidth: CHECK_W }}>
                      <input type="checkbox" checked={allVisibleSelected}
                        onChange={() => setHuntSelectedRowIds((prev) => {
                          const next = new Set(prev);
                          if (allVisibleSelected) huntFilteredRows.forEach((r) => next.delete(r._rowId));
                          else huntFilteredRows.forEach((r) => next.add(r._rowId));
                          return next;
                        })} className="cursor-pointer" />
                    </th>
                    <th className="px-2.5 py-2 text-right border-b border-gray-200 sticky bg-gray-50 z-[2] whitespace-nowrap" style={{ left: CHECK_W, width: STT_W, minWidth: STT_W }}>#</th>
                    <th className="px-2.5 py-2 text-left border-b border-gray-200 sticky bg-gray-50 z-[1]" style={{ left: KEY_LEFT, minWidth: 200 }}>keyword</th>
                    {numCols.map((col) => (
                      <th key={col}
                        onClick={() => setHuntSort((p) => p.col === col ? { col, dir: p.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" })}
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
                        <td className={`px-2.5 py-1.5 border-b border-gray-100 text-right sticky z-[2] whitespace-nowrap text-gray-400 ${rowBg}`} style={{ left: CHECK_W, width: STT_W, minWidth: STT_W }}>{i + 1}</td>
                        <td className={`px-2.5 py-1.5 border-b border-gray-100 sticky z-[1] font-medium ${rowBg}`} style={{ left: KEY_LEFT, minWidth: 200 }}>{row.keyword || ""}</td>
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

      {/* ── Move Keywords Modal ──────────────────────────────────────────────── */}
      {moveModal && (() => {
        const { query, fromL2, fromL3 } = moveModal;
        const tSel = getTableSelected(query, fromL2, fromL3);
        const entry = groupResults[query];
        return (
          <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center"
            onClick={(e) => { if (e.target === e.currentTarget) setMoveModal(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[70vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">↪ Chuyển <span className="text-violet-600">{tSel.size}</span> từ khóa sang nhóm...</p>
                <button type="button" onClick={() => setMoveModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer">✕</button>
              </div>
              <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-1">
                {(entry?.groups || []).map((l2, li) => (
                  <div key={li}>
                    <p className="text-[0.68rem] font-semibold text-gray-400 uppercase tracking-wide px-1 mt-2 mb-0.5">{l2.icon} {l2.group}</p>
                    {(l2.subgroups || []).map((l3, si) => {
                      const isSelf = li === fromL2 && si === fromL3;
                      return (
                        <button key={si} type="button" disabled={isSelf}
                          onClick={() => moveKeywords(li, si)}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                            isSelf ? "text-gray-300 cursor-not-allowed" : "text-gray-700 hover:bg-violet-50 hover:text-violet-700 cursor-pointer"
                          }`}>
                          <span>{l3.icon}</span>
                          <span className="flex-1">{l3.group}</span>
                          <span className="text-gray-400">{l3.count} kw</span>
                          {!isSelf && <span className="text-violet-400 text-[0.65rem]">Chuyển vào →</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Create Group Modal ───────────────────────────────────────────────── */}
      {createGroupModal && (
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setCreateGroupModal(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[360px]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">
                {createGroupModal.mode === "l2" ? "＋ Tạo nhóm L2 mới" : `＋ Tạo nhóm con trong "${groupResults[createGroupModal.query]?.groups?.[createGroupModal.l2Idx]?.group}"`}
              </p>
              <button type="button" onClick={() => setCreateGroupModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none cursor-pointer">✕</button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3">
              {/* Icon picker */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Icon</p>
                <div className="flex flex-wrap gap-1.5">
                  {EMOJI_PRESETS.map((em) => (
                    <button key={em} type="button" onClick={() => setCreateGroupIcon(em)}
                      className={`w-8 h-8 rounded-lg text-base transition-colors ${createGroupIcon === em ? "bg-violet-100 ring-2 ring-violet-400" : "hover:bg-gray-100"}`}>
                      {em}
                    </button>
                  ))}
                </div>
              </div>
              {/* Name input */}
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Tên nhóm</p>
                <input
                  autoFocus type="text" value={createGroupName}
                  onChange={(e) => setCreateGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createGroup(); }}
                  placeholder="Ví dụ: Cat Designs"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setCreateGroupModal(null)}>Hủy</Button>
                <Button variant="violet" size="sm" onClick={createGroup} disabled={!createGroupName.trim()}>Tạo nhóm</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
