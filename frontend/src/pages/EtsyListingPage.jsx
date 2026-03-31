import React, { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../constants";
import { Button } from "../components/ui/button";

function getTagSourceLabel(source) {
  if (source === "req1") return "REQ1";
  if (source === "ai_generated") return "AI";
  if (source === "req1_fallback") return "REQ1 FB";
  if (source === "title_fallback") return "Title";
  if (source === "attribute_fallback") return "Attr";
  return "Tag";
}

function StepCircle({ number, done, colorClass }) {
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
        done ? colorClass + " text-white" : "bg-gray-100 text-gray-400 border border-gray-200"
      }`}
    >
      {done ? "✓" : number}
    </div>
  );
}

function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white animate-fadeIn ${
            t.type === "error" ? "bg-red-500" : "bg-gray-900"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

const STEP_COLORS = {
  1: "bg-sky-500",
  2: "bg-indigo-500",
  3: "bg-emerald-500",
  4: "bg-amber-500",
  5: "bg-rose-500",
};

const SECTION_RING = {
  indigo: "focus:ring-indigo-400",
  emerald: "focus:ring-emerald-400",
  amber: "focus:ring-amber-400",
  rose: "focus:ring-rose-400",
};

export default function EtsyListingPage({ initialListingName, onInitConsumed, embedded = false, projectId = "", projectName = "", projectCreatedAt = "" }) {
  // Listing management
  const [allListings, setAllListings] = useState([]);
  const [selectedListing, setSelectedListing] = useState(""); // listing_name
  const [newListingName, setNewListingName] = useState("");
  const [creatingListing, setCreatingListing] = useState(false);

  // CSV files for REQ1
  const [csvFiles, setCsvFiles] = useState([]);
  const [selectedCsvFile, setSelectedCsvFile] = useState("");

  // HEnull (used when embedded)
  const [openingHenull, setOpeningHenull] = useState(false);
  const [henullMsg, setHenullMsg] = useState("");
  const [henullWatching, setHenullWatching] = useState(false);
  const [henullCrawling, setHenullCrawling] = useState(false);
  const henullPollRef = useRef({ lastSeenNewest: null });

  // Hunt keyword history (used when embedded)
  const [huntHistoryLoading, setHuntHistoryLoading] = useState(false);
  const [huntDetail, setHuntDetail] = useState(null);
  const [huntDetailLoading, setHuntDetailLoading] = useState(false);
  const [huntFilter, setHuntFilter] = useState("");
  const [huntSelectedRowIds, setHuntSelectedRowIds] = useState(new Set());
  const [addingToQueue, setAddingToQueue] = useState(false);
  const [addQueueMsg, setAddQueueMsg] = useState("");
  const [huntDetailModalOpen, setHuntDetailModalOpen] = useState(false);
  const [huntSort, setHuntSort] = useState({ col: "", dir: "desc" });
  const [classifyingFile, setClassifyingFile] = useState(null);

  const handleClassify = async (filename) => {
    setClassifyingFile(filename);
    try {
      const url = projectId
        ? `${API_BASE}/api/etsy_hunt/history/${filename}/classify?project_id=${projectId}`
        : `${API_BASE}/api/etsy_hunt/history/${filename}/classify`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      showToast("✅ AI Classify xong!");
    } catch (e) {
      showToast(`Phân loại thất bại: ${e.message}`, "error");
    } finally {
      setClassifyingFile(null);
    }
  };

  // REQ state
  const [req1Data, setReq1Data] = useState(null);
  const [aiFilterLoading, setAiFilterLoading] = useState(false);
  const [aiSearchFilter, setAiSearchFilter] = useState("");
  const [aiSort, setAiSort] = useState({ col: "score", dir: "desc" });

  const [customAttributes, setCustomAttributes] = useState("");
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleResult, setTitleResult] = useState(null);

  const [tagTitleInput, setTagTitleInput] = useState("");
  const [tagLoading, setTagLoading] = useState(false);
  const [tagResult, setTagResult] = useState(null);

  const [descriptionTitleInput, setDescriptionTitleInput] = useState("");
  const [materialsSkillLevel, setMaterialsSkillLevel] = useState("");
  const [finishedSizes, setFinishedSizes] = useState("");
  const [storyIdeas, setStoryIdeas] = useState("");
  const [shopLink, setShopLink] = useState("");
  const [descriptionLoading, setDescriptionLoading] = useState(false);
  const [descriptionResult, setDescriptionResult] = useState(null);

  const [patternExtractLoading, setPatternExtractLoading] = useState(false);
  const patternFileRef = useRef(null);

  const req5InputRef = useRef(null);
  const [altUploads, setAltUploads] = useState([]);
  const [req5Loading, setReq5Loading] = useState(false);
  const [req5Result, setReq5Result] = useState(null);
  const [req5DragOver, setReq5DragOver] = useState(false);

  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2500);
  };

  const copyText = (text, label = "Copied") => {
    navigator.clipboard.writeText(text);
    showToast(label);
  };

  const revokeAltUploadPreviews = (items) => {
    items.forEach((item) => {
      if (item?.preview_url?.startsWith("blob:")) URL.revokeObjectURL(item.preview_url);
    });
  };

  const replaceAltUploads = (nextUploads) => {
    setAltUploads((prev) => {
      revokeAltUploadPreviews(prev);
      return nextUploads;
    });
  };

  const resetWorkflowState = () => {
    setReq1Data(null);
    setSelectedCsvFile("");
    setCustomAttributes("");
    setTitleResult(null);
    setTagTitleInput("");
    setTagResult(null);
    setDescriptionTitleInput("");
    setMaterialsSkillLevel("");
    setFinishedSizes("");
    setStoryIdeas("");
    setShopLink("");
    setDescriptionResult(null);
    replaceAltUploads([]);
    setReq5Result(null);
    setReq5DragOver(false);
  };

  const applyHistoryState = (payload) => {
    if (!payload?.exists) {
      resetWorkflowState();
      return;
    }
    const nextReq1 = payload.req1 || null;
    const nextReq2 = payload.req2 || null;
    const nextReq3 = payload.req3 || null;
    const nextReq4 = payload.req4 || null;
    const nextReq5 = payload.req5 || null;

    setSelectedCsvFile(payload.source_filename || "");
    setReq1Data(nextReq1);
    setCustomAttributes(nextReq3?.custom_attributes ?? nextReq2?.custom_attributes ?? "");
    setTitleResult(nextReq2?.titles || null);
    setTagTitleInput(nextReq3?.listing_title ?? nextReq4?.listing_title ?? nextReq2?.titles?.[0] ?? "");
    setDescriptionTitleInput(nextReq4?.listing_title ?? nextReq3?.listing_title ?? nextReq2?.titles?.[0] ?? "");
    setMaterialsSkillLevel(nextReq4?.materials_skill_level ?? "");
    setFinishedSizes(nextReq4?.finished_sizes ?? "");
    setStoryIdeas(nextReq4?.story_ideas ?? "");
    setShopLink(nextReq4?.shop_link ?? "");
    replaceAltUploads([]);
    setReq5DragOver(false);
    setTagResult(
      nextReq3
        ? { tags: nextReq3.tags || [], details: nextReq3.details || [], copy_text: nextReq3.copy_text || "", listing_title: nextReq3.listing_title || "" }
        : null
    );
    setDescriptionResult(
      nextReq4
        ? { description_text: nextReq4.description_text || "", listing_title: nextReq4.listing_title || "", sections: nextReq4.sections || null }
        : null
    );
    setReq5Result(
      nextReq5
        ? {
            images: (nextReq5.images || []).map((item) => ({
              ...item,
              preview_url: item.asset_url ? `${API_BASE}${item.asset_url}` : "",
            })),
            copy_text: nextReq5.copy_text || "",
          }
        : null
    );
  };

  const refreshListings = () => {
    fetch(`${API_BASE}/api/listing/all`)
      .then((res) => res.json())
      .then((data) => setAllListings(data))
      .catch(console.error);
  };

  const refreshCsvFiles = useCallback(async () => {
    setHuntHistoryLoading(true);
    try {
      const url = embedded && projectId
        ? `${API_BASE}/api/etsy_hunt/history?project_id=${projectId}`
        : `${API_BASE}/api/etsy_hunt/history`;
      const res = await fetch(url);
      setCsvFiles(await res.json());
    } catch (e) { console.error(e); }
    setHuntHistoryLoading(false);
  }, [embedded, projectId]);

  const loadHuntDetail = async (filename) => {
    if (huntDetailLoading) return;
    setHuntDetailLoading(true);
    setHuntDetail(null);
    setHuntFilter("");
    setHuntSelectedRowIds(new Set());
    setHuntSort({ col: "", dir: "desc" });
    setAddQueueMsg("");
    setHuntDetailModalOpen(true);
    try {
      const url = projectId
        ? `${API_BASE}/api/etsy_hunt/history/${filename}?project_id=${projectId}`
        : `${API_BASE}/api/etsy_hunt/history/${filename}`;
      const res = await fetch(url);
      const data = await res.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setHuntDetail({ filename, rows: rows.map((r, i) => ({ ...r, _rowId: `${filename}::${i}` })) });
    } catch (_) {}
    setHuntDetailLoading(false);
  };

  const handleAddToQueue = async () => {
    if (!huntDetail || huntSelectedRowIds.size === 0 || !projectId) return;
    const keywords = huntDetail.rows
      .filter(r => huntSelectedRowIds.has(r._rowId))
      .map(r => r.keyword || r.Keyword)
      .filter(Boolean);
    if (!keywords.length) return;
    setAddingToQueue(true);
    setAddQueueMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/keyword-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, source_file: huntDetail.filename }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Lỗi thêm vào queue");
      const data = await res.json();
      setAddQueueMsg(`✅ Đã thêm ${data.added} keyword vào Task Queue (bỏ qua ${keywords.length - data.added} trùng)`);
      setHuntSelectedRowIds(new Set());
    } catch (e) {
      setAddQueueMsg(`❌ ${e.message}`);
    }
    setAddingToQueue(false);
  };

  const handleOpenHenull = async () => {
    if (!projectId) return;
    setOpeningHenull(true);
    setHenullMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/final/open-henull`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail || "Lỗi mở HEnull");
      setHenullMsg("✅ Browser đã mở trên VPS. Đăng nhập HEnull → search keyword để bắt đầu crawl.");
      try {
        const h = await fetch(`${API_BASE}/api/etsy_hunt/history?project_id=${projectId}`);
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
    if (!henullWatching || !projectId) return;
    const poll = async () => {
      try {
        const sRes = await fetch(`${API_BASE}/api/etsy_hunt/status?project_id=${projectId}`);
        const s = await sRes.json();
        setHenullCrawling(s.state === "crawling" || s.state === "crawling_products");
        const hRes = await fetch(`${API_BASE}/api/etsy_hunt/history?project_id=${projectId}`);
        const list = await hRes.json();
        const newest = list?.[0]?.filename ?? null;
        if (newest && newest !== henullPollRef.current.lastSeenNewest) {
          henullPollRef.current.lastSeenNewest = newest;
          setCsvFiles(list);
        }
      } catch (_) {}
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [henullWatching, projectId]);

  useEffect(() => {
    refreshListings();
    refreshCsvFiles();
  }, [refreshCsvFiles]);

  useEffect(() => {
    if (!initialListingName) return;
    if (embedded) {
      // Auto-create the listing if it doesn't exist, then select it
      fetch(`${API_BASE}/api/listing/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_name: initialListingName }),
      })
        .catch(() => {}) // ignore "already exists" errors
        .finally(() => {
          setSelectedListing(initialListingName);
          onInitConsumed?.();
        });
    } else {
      setSelectedListing(initialListingName);
      onInitConsumed?.();
    }
  }, [initialListingName]); // eslint-disable-line

  useEffect(() => {
    if (!selectedListing) {
      resetWorkflowState();
      return;
    }
    const loadHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/listing/history/${encodeURIComponent(selectedListing)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Error loading listing history");
        applyHistoryState(data);
      } catch {
        resetWorkflowState();
      }
    };
    loadHistory();
  }, [selectedListing]);

  const handleCreateListing = async () => {
    const name = newListingName.trim();
    if (!name) { showToast("Enter a listing name first.", "error"); return; }
    setCreatingListing(true);
    try {
      const res = await fetch(`${API_BASE}/api/listing/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_name: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error creating listing");
      setNewListingName("");
      refreshListings();
      setSelectedListing(name);
      resetWorkflowState();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setCreatingListing(false);
    }
  };

  const handleAiFilterKeywords = async () => {
    if (!selectedListing) return;
    if (!selectedCsvFile) { showToast("Select a CSV file first.", "error"); return; }
    if (!window.confirm(`Use Gemini to filter keywords from "${selectedCsvFile}" for listing "${selectedListing}"?`)) return;

    setAiFilterLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/listing/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_name: selectedListing,
          filename: selectedCsvFile,
          seed_keyword: "",
          ...(projectId ? { project_id: projectId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "AI processing error");
      applyHistoryState(data);
      refreshListings();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setAiFilterLoading(false);
    }
  };

  const handleGenerateTitles = async () => {
    if (!req1Data || !selectedListing) { showToast("Run REQ1 first.", "error"); return; }
    setTitleLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/listing/generate_titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_name: selectedListing, custom_attributes: customAttributes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error generating titles");
      applyHistoryState(data);
      refreshListings();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setTitleLoading(false);
    }
  };

  const handleGenerateTags = async () => {
    if (!req1Data || !selectedListing) { showToast("Run REQ1 first.", "error"); return; }
    if (!tagTitleInput.trim()) { showToast("Enter a title for tags first.", "error"); return; }
    setTagLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/listing/generate_tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listing_name: selectedListing, listing_title: tagTitleInput.trim(), custom_attributes: customAttributes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error generating tags");
      applyHistoryState(data);
      refreshListings();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setTagLoading(false);
    }
  };

  const handleGenerateDescription = async () => {
    if (!req1Data || !selectedListing) { showToast("Run REQ1 first.", "error"); return; }
    if (!descriptionTitleInput.trim()) { showToast("Enter a title for description first.", "error"); return; }
    setDescriptionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/listing/generate_description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listing_name: selectedListing,
          listing_title: descriptionTitleInput.trim(),
          materials_skill_level: materialsSkillLevel,
          finished_sizes: finishedSizes,
          story_ideas: storyIdeas,
          shop_link: shopLink,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error generating description");
      applyHistoryState(data);
      refreshListings();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setDescriptionLoading(false);
    }
  };

  const applyReq5Files = (fileList) => {
    const imageFiles = Array.from(fileList || []).filter((f) => f.type?.startsWith("image/"));
    if (!imageFiles.length) return;
    const nextUploads = imageFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      original_filename: file.name,
      preview_url: URL.createObjectURL(file),
    }));
    replaceAltUploads(nextUploads);
    setReq5Result(null);
  };

  const handleGenerateAltTexts = async () => {
    if (!req1Data || !selectedListing) { showToast("Run REQ1 first.", "error"); return; }
    if (!altUploads.length && !req5Result?.images?.length) { showToast("Upload at least 1 image.", "error"); return; }
    const formData = new FormData();
    formData.append("listing_name", selectedListing);
    altUploads.forEach((item) => formData.append("files", item.file, item.original_filename));
    setReq5Loading(true);
    try {
      const res = await fetch(`${API_BASE}/api/listing/generate_alt_texts`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error generating alt text");
      applyHistoryState(data);
      refreshListings();
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setReq5Loading(false);
    }
  };

  const handleUseTitle = (title) => {
    setTagTitleInput(title);
    setTagResult(null);
    setDescriptionTitleInput(title);
    setDescriptionResult(null);
  };

  const handleExtractPattern = async (file) => {
    if (!file) return;
    setPatternExtractLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/listing/extract-pattern-info`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Extraction failed");
      if (data.listing_title) { setDescriptionTitleInput(data.listing_title); setDescriptionResult(null); }
      if (data.materials_skill_level) setMaterialsSkillLevel(data.materials_skill_level);
      if (data.finished_sizes) setFinishedSizes(data.finished_sizes);
      if (data.story_ideas) setStoryIdeas(data.story_ideas);
      showToast("✅ Extracted info from file");
    } catch (e) {
      showToast("Error: " + e.message, "error");
    } finally {
      setPatternExtractLoading(false);
      if (patternFileRef.current) patternFileRef.current.value = "";
    }
  };

  const getSortedData = () => {
    if (!req1Data?.data) return [];
    return req1Data.data
      .filter((item) => item.keyword.toLowerCase().includes(aiSearchFilter.toLowerCase()))
      .sort((a, b) => {
        const dir = aiSort.dir === "asc" ? 1 : -1;
        if (aiSort.col === "keyword") return dir * a.keyword.localeCompare(b.keyword);
        return dir * ((parseFloat(a[aiSort.col]) || 0) - (parseFloat(b[aiSort.col]) || 0));
      });
  };

  const sortedData = getSortedData();
  const tagDetails = tagResult?.details || [];
  const req5Images = req5Result?.images || [];
  const finalListingTitle =
    descriptionResult?.listing_title || descriptionTitleInput.trim() || tagTitleInput.trim() || titleResult?.[0] || "";
  const finalListingTags = tagResult?.tags || [];
  const finalAltLines = req5Images.map(
    (item, i) => `${i + 1}. ${item.original_filename || item.stored_filename}: ${item.alt_text}`
  );
  const finalSections = [
    { key: "title", label: "Title", value: finalListingTitle },
    { key: "description", label: "Description", value: descriptionResult?.description_text || "" },
    { key: "tags", label: "Tags", value: finalListingTags.join(", ") },
    { key: "image_alt_text", label: "Image Alt Text", value: finalAltLines.join("\n") },
  ];
  const completedCount = finalSections.filter((s) => s.value.trim()).length;
  const finalDocumentText = finalSections
    .map((s) => `${s.label}\n${s.value.trim() || "(empty)"}`)
    .join("\n\n========================================\n\n");
  const hasFinalDocument = completedCount > 0;

  const steps = [
    { label: "Keywords", done: !!req1Data },
    { label: "Title", done: !!titleResult },
    { label: "Tags", done: !!tagResult },
    { label: "Description", done: !!descriptionResult },
    { label: "Alt Text", done: !!req5Result },
  ];

  const filteredRows = (() => {
    let rows = (huntDetail?.rows ?? []).filter(r =>
      !huntFilter || (r.keyword || r.Keyword || "").toLowerCase().includes(huntFilter.toLowerCase())
    );
    if (huntSort.col) {
      rows = [...rows].sort((a, b) => {
        const dir = huntSort.dir === "asc" ? 1 : -1;
        const av = a[huntSort.col] ?? "", bv = b[huntSort.col] ?? "";
        if (!isNaN(av) && !isNaN(bv)) return dir * (Number(av) - Number(bv));
        return dir * String(av).localeCompare(String(bv));
      });
    }
    return rows;
  })();
  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every(r => huntSelectedRowIds.has(r._rowId));

  const inputCls = (ring = "focus:ring-sky-400") =>
    `w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${ring} bg-gray-50 focus:bg-white transition-colors resize-none`;

  return (
    <div className="flex h-full overflow-hidden bg-gray-50">
      <ToastContainer toasts={toasts} />

      {/* ── Keyword CSV Detail Modal ── */}
      {huntDetailModalOpen && (
        <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setHuntDetailModalOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-[900px] max-w-full max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {huntDetail?.filename ?? "Loading..."}
                </p>
                {huntDetail && (
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                    {huntDetail.rows.length} rows
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {huntDetail && (
                  <>
                    {selectedCsvFile === huntDetail.filename ? (
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100">✓ Selected for REQ1</span>
                    ) : (
                      <button type="button"
                        onClick={() => { setSelectedCsvFile(huntDetail.filename); setHuntDetailModalOpen(false); }}
                        className="px-3 py-1 rounded-lg bg-sky-500 text-white text-xs font-semibold hover:bg-sky-600 transition-colors">
                        Use for REQ1
                      </button>
                    )}
                    <button type="button"
                      onClick={() => handleClassify(huntDetail.filename)}
                      disabled={!!classifyingFile}
                      className="px-3 py-1.5 rounded-full border border-violet-300 text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold">
                      {classifyingFile === huntDetail.filename ? "⏳ Đang phân loại..." : "🤖 AI Classify"}
                    </button>
                    <a href={`${API_BASE}/api/etsy_hunt/history/${huntDetail.filename}/download`}
                      className="px-3 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 transition-colors no-underline"
                      download>
                      ⬇ CSV
                    </a>
                  </>
                )}
                <button type="button" onClick={() => setHuntDetailModalOpen(false)}
                  className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1">✕</button>
              </div>
            </div>

            {/* Filter bar */}
            <div className="px-5 py-2.5 border-b border-gray-100 shrink-0 flex items-center gap-3">
              <input
                className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300"
                placeholder="Lọc keyword..."
                value={huntFilter}
                onChange={e => setHuntFilter(e.target.value)}
              />
              <span className="text-xs text-gray-400">
                {filteredRows.length} / {huntDetail?.rows.length ?? 0}
                {huntSelectedRowIds.size > 0 && (
                  <span className="ml-2 text-sky-600 font-semibold">· {huntSelectedRowIds.size} selected</span>
                )}
              </span>
              {addQueueMsg && (
                <span className={`text-xs font-medium ${addQueueMsg.startsWith("✅") ? "text-emerald-600" : "text-red-500"}`}>
                  {addQueueMsg}
                </span>
              )}
            </div>

            {/* Table */}
            {huntDetailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
              </div>
            ) : huntDetail && (() => {
              const cols = huntDetail.rows.length > 0
                ? Object.keys(huntDetail.rows[0]).filter(c => c !== "_rowId")
                : [];
              const numCols = cols.filter(c => c !== "keyword");
              const toggleSort = (col) => setHuntSort(prev =>
                prev.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }
              );
              return (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10 bg-gray-50">
                      <tr>
                        <th className="w-9 px-2.5 py-2 border-b border-gray-200 text-center">
                          <input type="checkbox" className="cursor-pointer accent-sky-500"
                            checked={allFilteredSelected}
                            onChange={e => setHuntSelectedRowIds(e.target.checked
                              ? new Set(filteredRows.map(r => r._rowId))
                              : new Set()
                            )}
                          />
                        </th>
                        <th className="w-10 px-2.5 py-2 border-b border-gray-200 text-right text-gray-400">#</th>
                        <th className="px-2.5 py-2 border-b border-gray-200 text-left font-semibold text-gray-700 min-w-[180px]">keyword</th>
                        {numCols.map(col => (
                          <th key={col} onClick={() => toggleSort(col)}
                            className="px-2.5 py-2 border-b border-gray-200 text-right cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap font-semibold text-gray-700">
                            {col} {huntSort.col === col ? (huntSort.dir === "desc" ? "▼" : "▲") : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, i) => {
                        const checked = huntSelectedRowIds.has(row._rowId);
                        const bg = i % 2 === 0 ? "bg-white" : "bg-gray-50";
                        return (
                          <tr key={row._rowId} className={`${bg} cursor-pointer hover:bg-sky-50 ${checked ? "!bg-sky-50" : ""}`}
                            onClick={() => setHuntSelectedRowIds(prev => {
                              const next = new Set(prev);
                              checked ? next.delete(row._rowId) : next.add(row._rowId);
                              return next;
                            })}>
                            <td className="px-2.5 py-1.5 border-b border-gray-100 text-center">
                              <input type="checkbox" checked={checked} readOnly className="accent-sky-500 pointer-events-none" />
                            </td>
                            <td className="px-2.5 py-1.5 border-b border-gray-100 text-right text-gray-400">{i + 1}</td>
                            <td className="px-2.5 py-1.5 border-b border-gray-100 font-medium text-gray-800">{row.keyword || row.Keyword || ""}</td>
                            {numCols.map(col => (
                              <td key={col} className="px-2.5 py-1.5 border-b border-gray-100 text-right text-gray-600 whitespace-nowrap">
                                {isNaN(row[col]) ? row[col] : Number(row[col]).toLocaleString()}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Left sidebar ── */}
      {embedded ? (
        /* Embedded mode: Keyword Crawl History */
        <aside className="w-[272px] flex-none border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 shrink-0">
            <p className="text-sm font-semibold text-gray-900">🔍 Keyword Crawl</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Crawl keywords with HEnull</p>
          </div>

          {/* HEnull controls */}
          <div className="px-4 py-3 border-b border-gray-100 shrink-0 flex flex-col gap-2">
            <button
              type="button" onClick={handleOpenHenull} disabled={openingHenull}
              className="w-full px-3 py-2 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-600 disabled:opacity-50 transition-colors"
            >
              {openingHenull ? "⏳ Đang mở..." : "🌐 Mở HEnull"}
            </button>
            {henullWatching && (
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full text-center ${
                henullCrawling ? "bg-amber-100 text-amber-700 animate-pulse" : "bg-gray-100 text-gray-500"
              }`}>
                {henullCrawling ? "⏳ Đang crawl keywords..." : "👁 Đang theo dõi"}
              </span>
            )}
            {henullMsg && (
              <p className={`text-[11px] px-2 py-1.5 rounded-lg border ${henullMsg.startsWith("✅") ? "text-emerald-700 bg-emerald-50 border-emerald-100" : "text-red-600 bg-red-50 border-red-100"}`}>
                {henullMsg}
              </p>
            )}
          </div>

          {/* Keyword History header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 shrink-0">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex-1">📊 History</span>
            <button type="button" onClick={refreshCsvFiles}
              className="text-xs text-sky-500 hover:underline disabled:opacity-50"
              disabled={huntHistoryLoading}>
              {huntHistoryLoading ? "..." : "↻"}
            </button>
          </div>

          {/* CSV file list */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {csvFiles.length === 0 && !huntHistoryLoading && (
              <p className="text-xs text-gray-400 italic px-4 py-3">Chưa có lịch sử. Mở HEnull và search keyword để tạo CSV.</p>
            )}
            {csvFiles.map(h => {
              const isSelected = selectedCsvFile === h.filename;
              return (
                <button key={h.filename} type="button" onClick={() => loadHuntDetail(h.filename)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-left transition-colors border-b border-gray-50 ${
                    isSelected
                      ? "bg-sky-50 border-l-2 border-l-sky-500 text-sky-700"
                      : "hover:bg-gray-50 border-l-2 border-l-transparent text-gray-700"
                  }`}>
                  <span className="text-sm">{isSelected ? "✅" : "📄"}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{h.keyword || h.filename}</p>
                    <p className="text-[10px] text-gray-400 truncate">{h.rows != null ? `${h.rows} rows` : h.size_kb ? `${h.size_kb} KB` : ""}</p>
                  </div>
                </button>
              );
            })}

            {huntDetailLoading && (
              <p className="text-xs text-gray-400 animate-pulse px-4 py-2">Loading...</p>
            )}
          </div>
        </aside>
      ) : (
        /* Normal mode: Listing management */
        <aside className="w-[272px] flex-none border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 shrink-0">
            <p className="text-sm font-semibold text-gray-900">Etsy Listing AI</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Select or create a listing to start</p>
          </div>

          {/* Create new listing */}
          <div className="px-4 py-4 border-b border-gray-100 shrink-0 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">New Listing</p>
            <input
              type="text"
              placeholder="e.g. Baby Headband Pattern"
              className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={newListingName}
              onChange={(e) => setNewListingName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateListing()}
            />
            <Button variant="sky" size="sm" disabled={!newListingName.trim() || creatingListing} onClick={handleCreateListing} className="w-full text-xs">
              {creatingListing ? "Creating..." : "Create Listing"}
            </Button>
          </div>

          {/* Existing listings */}
          <div className="flex-1 overflow-y-auto">
            {allListings.length === 0 ? (
              <div className="flex items-center justify-center h-24 px-4">
                <p className="text-xs text-gray-400 text-center">No listings yet. Create one above.</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">
                  Your Listings ({allListings.length})
                </p>
                {allListings.map((listing) => {
                  const isActive = selectedListing === listing.listing_name;
                  const doneCount = [listing.has_req1, listing.has_req2, listing.has_req3, listing.has_req4, listing.has_req5].filter(Boolean).length;
                  return (
                    <button key={listing.listing_name} onClick={() => setSelectedListing(listing.listing_name)}
                      className={`w-full text-left px-4 py-3 transition-colors ${isActive ? "bg-sky-50 border-l-2 border-sky-500" : "hover:bg-gray-50 border-l-2 border-transparent"}`}>
                      <p className={`text-xs font-semibold truncate ${isActive ? "text-sky-700" : "text-gray-800"}`}>{listing.listing_name}</p>
                      {listing.seed_keyword && <p className="text-[10px] text-gray-400 truncate mt-0.5">{listing.seed_keyword}</p>}
                      <div className="flex items-center gap-1 mt-1.5">
                        {[{ key: "req1", color: "bg-sky-400" }, { key: "req2", color: "bg-indigo-400" }, { key: "req3", color: "bg-emerald-400" }, { key: "req4", color: "bg-amber-400" }, { key: "req5", color: "bg-rose-400" }].map(({ key, color }) => (
                          <div key={key} className={`w-2 h-2 rounded-full ${listing[`has_${key}`] ? color : "bg-gray-200"}`} />
                        ))}
                        <span className="text-[10px] text-gray-400 ml-1">{doneCount}/5</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {!selectedListing ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-base font-semibold text-gray-400">No listing selected</p>
              <p className="text-sm text-gray-400 mt-1">Create a new listing or select one from the sidebar.</p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-5">

            {/* Page title */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {embedded && projectName ? projectName : selectedListing}
              </h1>
              {embedded && projectCreatedAt && (
                <p className="text-xs text-gray-400 mt-0.5">{projectCreatedAt.slice(0, 16).replace("T", " ")}</p>
              )}
              <p className="text-sm text-gray-400 mt-0.5">Complete each step in order — results are saved automatically.</p>
            </div>

            {/* Progress bar */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-3 flex items-center gap-1">
              {steps.map((step, i) => (
                <React.Fragment key={step.label}>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <StepCircle number={i + 1} done={step.done} colorClass={STEP_COLORS[i + 1]} />
                    <span className={`text-xs font-semibold ${step.done ? "text-gray-800" : "text-gray-400"}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`flex-1 h-px mx-1 ${step.done ? "bg-gray-300" : "bg-gray-100"}`} />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* ── REQ1: Keywords ── */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StepCircle number={1} done={!!req1Data} colorClass={STEP_COLORS[1]} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">REQ1 · Keywords</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Select a CSV and filter long-tail keywords with Gemini</p>
                  </div>
                </div>
                {req1Data && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
                    {req1Data.total_filtered} keywords
                  </span>
                )}
              </div>

              <div className="px-6 py-5 flex flex-col gap-3">
                {embedded ? (
                  /* ── Embedded: CSV selected from left sidebar ── */
                  <div className="flex items-center gap-3">
                    {selectedCsvFile ? (
                      <>
                        <span className="flex-1 text-sm text-gray-700 truncate">📄 {selectedCsvFile}</span>
                        <Button variant="sky" disabled={aiFilterLoading} onClick={handleAiFilterKeywords} className="shrink-0">
                          {aiFilterLoading ? "Filtering..." : req1Data ? "Re-run" : "Run REQ1"}
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 italic">← Select a CSV from the left panel</p>
                    )}
                  </div>
                ) : (
                  /* ── Normal: select dropdown ── */
                  <div className="flex gap-2">
                    <select
                      value={selectedCsvFile}
                      onChange={(e) => setSelectedCsvFile(e.target.value)}
                      className="flex-1 border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                    >
                      <option value="">-- Select EtsyHunt CSV --</option>
                      {csvFiles.map((item) => (
                        <option key={item.filename} value={item.filename}>
                          {item.filename} {item.size_kb ? `(${item.size_kb} KB)` : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="sky"
                      disabled={!selectedCsvFile || aiFilterLoading}
                      onClick={handleAiFilterKeywords}
                      className="shrink-0"
                    >
                      {aiFilterLoading ? "Filtering..." : req1Data ? "Re-run" : "Run REQ1"}
                    </Button>
                  </div>
                )}

                {req1Data && (
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between border-b border-gray-100">
                      <span className="text-[11px] font-semibold text-gray-500">{req1Data.total_filtered} filtered keywords</span>
                      <button
                        className="text-[11px] font-medium text-sky-600 hover:text-sky-700"
                        onClick={() => copyText(sortedData.map((i) => i.keyword).join(", "), `Copied ${sortedData.length} keywords`)}
                      >
                        Copy all
                      </button>
                    </div>
                    <div className="px-3 py-2 border-b border-gray-100">
                      <input
                        type="text"
                        placeholder="Search keywords..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-gray-50 focus:outline-none focus:ring-1 focus:ring-sky-400"
                        value={aiSearchFilter}
                        onChange={(e) => setAiSearchFilter(e.target.value)}
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-white sticky top-0 border-b border-gray-100 z-10">
                          <tr>
                            <th
                              className="px-4 py-2 text-left font-medium text-gray-400 cursor-pointer hover:text-gray-600"
                              onClick={() =>
                                setAiSort((p) =>
                                  p.col === "keyword" ? { col: "keyword", dir: p.dir === "asc" ? "desc" : "asc" } : { col: "keyword", dir: "asc" }
                                )
                              }
                            >
                              Keyword {aiSort.col === "keyword" && (aiSort.dir === "asc" ? "▲" : "▼")}
                            </th>
                            <th
                              className="px-3 py-2 text-right font-medium text-gray-400 cursor-pointer hover:text-gray-600"
                              onClick={() =>
                                setAiSort((p) =>
                                  p.col === "score" ? { col: "score", dir: p.dir === "asc" ? "desc" : "asc" } : { col: "score", dir: "desc" }
                                )
                              }
                            >
                              Score {aiSort.col === "score" && (aiSort.dir === "asc" ? "▲" : "▼")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {sortedData.map((item, idx) => (
                            <tr key={idx} className="hover:bg-sky-50 transition-colors">
                              <td className="px-4 py-2 font-medium text-sky-700 break-words leading-snug">{item.keyword}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{item.score || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── REQ2: Generate Titles ── */}
            <section className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {!req1Data && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex items-center justify-center z-10 rounded-2xl">
                  <p className="text-sm text-gray-400 font-medium">Run REQ1 first to unlock</p>
                </div>
              )}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StepCircle number={2} done={!!titleResult} colorClass={STEP_COLORS[2]} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">REQ2 · Generate Listing Titles</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">5 SEO-optimized title options</p>
                  </div>
                </div>
                {titleResult && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {titleResult.length} titles
                  </span>
                )}
              </div>

              <div className="px-6 py-5 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Custom Features / Attributes</label>
                  <textarea
                    className={inputCls(SECTION_RING.indigo)}
                    style={{ minHeight: 72 }}
                    placeholder="e.g. muslin cotton, embroidered name, neutral nursery gift..."
                    value={customAttributes}
                    onChange={(e) => { setCustomAttributes(e.target.value); setTagResult(null); }}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Shared with REQ3. Saved to history when you run REQ2 or REQ3.</p>
                </div>

                <Button
                  className="w-full font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white border-0 shadow-sm"
                  disabled={!req1Data || titleLoading}
                  onClick={handleGenerateTitles}
                >
                  {titleLoading ? "Generating 5 titles..." : titleResult ? "Regenerate Titles" : "Generate Titles"}
                </Button>

                {titleResult && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-gray-500">Click a title to use it in REQ3 and REQ4:</p>
                    {titleResult.map((title, idx) => {
                      const isSelected = tagTitleInput.trim() === title.trim();
                      return (
                        <div
                          key={idx}
                          onClick={() => handleUseTitle(title)}
                          className={`border rounded-xl p-4 cursor-pointer transition-all ${
                            isSelected ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50"
                          }`}
                        >
                          <p className="text-sm text-gray-800 leading-snug">{title}</p>
                          <div className="flex items-center justify-between mt-2.5">
                            <span className={`text-[11px] font-semibold ${title.length <= 140 ? "text-emerald-600" : "text-red-500"}`}>
                              {title.length}/140 chars
                            </span>
                            <div className="flex items-center gap-3">
                              <button
                                className="text-[11px] text-gray-400 hover:text-gray-600"
                                onClick={(e) => { e.stopPropagation(); copyText(title, "Title copied"); }}
                              >
                                Copy
                              </button>
                              {isSelected && (
                                <span className="text-[11px] font-semibold text-indigo-600 bg-white border border-indigo-200 px-2 py-0.5 rounded-full">
                                  Selected
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* ── REQ3: Generate Tags ── */}
            <section className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {!req1Data && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex items-center justify-center z-10 rounded-2xl">
                  <p className="text-sm text-gray-400 font-medium">Run REQ1 first to unlock</p>
                </div>
              )}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StepCircle number={3} done={!!tagResult} colorClass={STEP_COLORS[3]} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">REQ3 · Generate Tags</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">13 SEO-optimized Etsy tags</p>
                  </div>
                </div>
                {tagResult && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                    {tagResult.tags.length}/13 tags
                  </span>
                )}
              </div>

              <div className="px-6 py-5 flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Title for tags</label>
                  <textarea
                    className={inputCls(SECTION_RING.emerald)}
                    style={{ minHeight: 72 }}
                    placeholder="Select a title from REQ2 above, or enter manually..."
                    value={tagTitleInput}
                    onChange={(e) => { setTagTitleInput(e.target.value); setTagResult(null); }}
                  />
                </div>

                <Button
                  className="w-full font-semibold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white border-0 shadow-sm"
                  disabled={!req1Data || !tagTitleInput.trim() || tagLoading}
                  onClick={handleGenerateTags}
                >
                  {tagLoading ? "Generating 13 tags..." : tagResult ? "Regenerate Tags" : "Generate Tags"}
                </Button>

                {tagResult && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500">Tags</p>
                      <button
                        className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700"
                        onClick={() => copyText(tagResult.copy_text || tagResult.tags.join(", "), "All tags copied")}
                      >
                        Copy all
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {tagDetails.map((item, idx) => (
                        <div
                          key={`${item.tag}-${idx}`}
                          className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2 bg-gray-50 hover:bg-white transition-colors group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-medium text-gray-800 truncate">{item.tag}</span>
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-600 border border-sky-100">
                              {getTagSourceLabel(item.source)}
                            </span>
                            {item.score != null && (
                              <span className="text-[10px] text-gray-400">{Number(item.score).toFixed(1)}</span>
                            )}
                          </div>
                          <button
                            className="text-[11px] text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={() => copyText(item.tag, "Tag copied")}
                          >
                            Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── REQ4: Generate Description ── */}
            <section className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {!req1Data && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex items-center justify-center z-10 rounded-2xl">
                  <p className="text-sm text-gray-400 font-medium">Run REQ1 first to unlock</p>
                </div>
              )}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StepCircle number={4} done={!!descriptionResult} colorClass={STEP_COLORS[4]} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">REQ4 · Generate Description</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Structured listing description</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {descriptionResult && (
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                      Ready
                    </span>
                  )}
                  <input
                    ref={patternFileRef}
                    type="file"
                    accept=".docx,.pdf"
                    className="hidden"
                    onChange={(e) => { handleExtractPattern(e.target.files?.[0]); }}
                  />
                  <button
                    type="button"
                    disabled={patternExtractLoading}
                    onClick={() => patternFileRef.current?.click()}
                    className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                    title="Upload a .docx or .pdf pattern file to auto-fill the fields below"
                  >
                    {patternExtractLoading ? "⏳ Extracting..." : "📄 Auto-fill from file"}
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 flex flex-col gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Title for Description</label>
                  <textarea
                    className={inputCls(SECTION_RING.amber)}
                    style={{ minHeight: 68 }}
                    placeholder="Select from REQ2, or enter manually..."
                    value={descriptionTitleInput}
                    onChange={(e) => { setDescriptionTitleInput(e.target.value); setDescriptionResult(null); }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Materials & Skill Level</label>
                  <textarea
                    className={inputCls(SECTION_RING.amber)}
                    style={{ minHeight: 72 }}
                    placeholder="e.g. Advanced Beginner, Worsted weight (#4) yarn, 6mm hook..."
                    value={materialsSkillLevel}
                    onChange={(e) => { setMaterialsSkillLevel(e.target.value); setDescriptionResult(null); }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Finished Sizes</label>
                  <textarea
                    className={inputCls(SECTION_RING.amber)}
                    style={{ minHeight: 72 }}
                    placeholder="e.g. Newborn - 13in, Baby 0-3 months - 14in..."
                    value={finishedSizes}
                    onChange={(e) => { setFinishedSizes(e.target.value); setDescriptionResult(null); }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Story Ideas</label>
                  <textarea
                    className={inputCls(SECTION_RING.amber)}
                    style={{ minHeight: 72 }}
                    placeholder="e.g. Designed for mothers who want a relaxing handmade gift..."
                    value={storyIdeas}
                    onChange={(e) => { setStoryIdeas(e.target.value); setDescriptionResult(null); }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Shop Link</label>
                  <input
                    type="text"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-gray-50 focus:bg-white transition-colors"
                    placeholder="https://www.etsy.com/shop/YourShopName"
                    value={shopLink}
                    onChange={(e) => { setShopLink(e.target.value); setDescriptionResult(null); }}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Optional — REQ4 adds a placeholder if left blank.</p>
                </div>

                <Button
                  className="w-full font-semibold bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white border-0 shadow-sm"
                  disabled={!req1Data || !descriptionTitleInput.trim() || descriptionLoading}
                  onClick={handleGenerateDescription}
                >
                  {descriptionLoading ? "Generating description..." : descriptionResult ? "Regenerate Description" : "Generate Description"}
                </Button>

                {descriptionResult && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500">Result</p>
                      <button
                        className="text-[11px] font-medium text-amber-600 hover:text-amber-700"
                        onClick={() => copyText(descriptionResult.description_text || "", "Description copied")}
                      >
                        Copy
                      </button>
                    </div>
                    <div className="border border-gray-200 rounded-xl bg-gray-50 px-4 py-3 max-h-64 overflow-y-auto">
                      <pre className="whitespace-pre-wrap text-sm leading-6 text-gray-800 font-sans">
                        {descriptionResult.description_text}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── REQ5: Image Alt Text ── */}
            <section className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {!req1Data && (
                <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex items-center justify-center z-10 rounded-2xl">
                  <p className="text-sm text-gray-400 font-medium">Run REQ1 first to unlock</p>
                </div>
              )}
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StepCircle number={5} done={!!req5Result} colorClass={STEP_COLORS[5]} />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">REQ5 · Image Alt Text</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">One hyphenated alt text per product image</p>
                  </div>
                </div>
                {req5Result && (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                    {req5Images.length} alt text(s)
                  </span>
                )}
              </div>

              <div className="px-6 py-5 flex flex-col gap-4">
                <div
                  onClick={() => req5InputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setReq5DragOver(true); }}
                  onDragLeave={() => setReq5DragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setReq5DragOver(false); applyReq5Files(e.dataTransfer.files); }}
                  className={`rounded-xl border-2 border-dashed p-5 text-center cursor-pointer transition-colors ${
                    req5DragOver ? "border-rose-400 bg-rose-50" : "border-gray-200 hover:border-rose-300 hover:bg-rose-50/30"
                  }`}
                >
                  <input
                    ref={req5InputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { applyReq5Files(e.target.files); e.target.value = ""; }}
                  />
                  <p className="text-sm font-medium text-gray-700">
                    {altUploads.length ? `${altUploads.length} image(s) selected` : "Drop product images here or click to upload"}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    If no files selected, REQ5 reuses images already saved in this listing.
                  </p>
                </div>

                {altUploads.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {altUploads.map((item) => (
                      <div key={item.id} className="border border-gray-200 rounded-xl overflow-hidden">
                        <img src={item.preview_url} alt={item.original_filename} className="w-full h-20 object-cover bg-gray-100" />
                        <p className="px-2 py-1 text-[10px] text-gray-500 truncate">{item.original_filename}</p>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  className="w-full font-semibold bg-gradient-to-r from-rose-600 to-pink-500 hover:from-rose-500 hover:to-pink-400 text-white border-0 shadow-sm"
                  disabled={!req1Data || (!altUploads.length && !req5Result) || req5Loading}
                  onClick={handleGenerateAltTexts}
                >
                  {req5Loading ? "Generating alt text..." : req5Result ? "Regenerate Alt Text" : "Generate Alt Text"}
                </Button>

                {req5Result && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-500">{req5Images.length} alt text(s) saved</p>
                      <button
                        className="text-[11px] font-medium text-rose-600 hover:text-rose-700"
                        onClick={() => copyText(req5Result.copy_text || req5Images.map((i) => i.alt_text).join("\n"), "All alt texts copied")}
                      >
                        Copy all
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {req5Images.map((item, idx) => (
                        <div key={`${item.stored_filename || item.original_filename}-${idx}`} className="border border-gray-200 rounded-xl overflow-hidden group">
                          {item.preview_url ? (
                            <img src={item.preview_url} alt={item.original_filename} className="w-full h-32 object-cover bg-gray-100" />
                          ) : (
                            <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-xs text-gray-400">No preview</div>
                          )}
                          <div className="p-3 flex flex-col gap-2">
                            <p className="text-[11px] text-gray-400 truncate">{item.original_filename || item.stored_filename}</p>
                            <p className="text-[11px] text-sky-600">keyword: {item.keyword_used}</p>
                            <div className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2">
                              <p className="text-xs font-medium text-gray-800 leading-snug">{item.alt_text}</p>
                            </div>
                            <button
                              className="text-[11px] text-gray-400 hover:text-gray-600 text-left"
                              onClick={() => copyText(item.alt_text, "Alt text copied")}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── Final Draft ── */}
            <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${hasFinalDocument ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400 border border-gray-200"}`}>
                    {hasFinalDocument ? "✓" : "6"}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Final Listing Draft</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{completedCount}/4 sections ready</p>
                  </div>
                </div>
                {hasFinalDocument && (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => copyText(finalDocumentText, "Final draft copied")}>
                    Copy Full Draft
                  </Button>
                )}
              </div>

              <div className="px-6 py-5">
                {hasFinalDocument ? (
                  <div className="flex flex-col gap-3">
                    {finalSections.map((section) => {
                      const isReady = section.value.trim().length > 0;
                      return (
                        <div key={section.key} className="border border-gray-100 rounded-xl overflow-hidden">
                          <div className={`px-4 py-2.5 flex items-center justify-between ${isReady ? "bg-gray-50" : "bg-amber-50/40"}`}>
                            <span className="text-xs font-semibold text-gray-700">{section.label}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isReady ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-amber-50 text-amber-600 border-amber-200"}`}>
                              {isReady ? "Ready" : "Missing"}
                            </span>
                          </div>
                          <div className="px-4 py-3">
                            {isReady ? (
                              <pre className="whitespace-pre-wrap text-sm leading-6 text-gray-800 font-sans">{section.value}</pre>
                            ) : (
                              <p className="text-xs text-gray-400">Complete the upstream step to fill this section.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="border border-dashed border-gray-200 rounded-xl p-6 bg-gray-50 text-center">
                    <p className="text-sm text-gray-400">Run REQ2 → REQ3 → REQ4 → REQ5 to build the final listing draft here.</p>
                  </div>
                )}
              </div>
            </section>

          </div>
        )}
      </main>
    </div>
  );
}
