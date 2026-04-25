import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Sparkles, Image as ImageIcon, Search, X } from "lucide-react";
import { API_BASE } from "../../../constants";
import HistoryPickerModal from "../../../components/HistoryPickerModal";
import { MessageContent } from "../../../components/AttributeTable";
import ManualUploadModal from "../../../components/ManualUploadModal";
import { getImageAttributes, buildImagePrompts, generateImages } from "../../../lib/imageAI";

function makeMsg(type, payload) {
  const genId = Date.now().toString(36) + Math.random().toString(36).substring(2);
  return { id: genId, type, created_at: new Date().toISOString(), ...payload };
}

function StepBadge({ n, label, active }) {
  return (
    <div className={`flex items-center gap-2 ${active ? "opacity-100" : "opacity-40"}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${active ? "bg-violet-600 text-white" : "bg-gray-200 text-gray-500"}`}>
        {n}
      </span>
      <span className={`text-sm font-bold ${active ? "text-gray-800" : "text-gray-400"}`}>{label}</span>
    </div>
  );
}

// ── Chat bubbles ──────────────────────────────────────────────────────────────

function ChatRequestMsg({ msg }) {
  const copyUrl = async (url, e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {}
  };

  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 flex flex-col gap-2 shadow-sm">
        {msg.description && (
          <p className="text-sm font-medium">"{msg.description}"</p>
        )}
        <div className="flex flex-wrap gap-1.5">
            {msg.images?.map((img, i) => {
              const url = img.image_url || "";
              let label = url.startsWith("data:") ? (img.title || (img.isMain ? "Main" : `Ref${i}`)) : (url.split("/").pop()?.split("?")[0] || (img.isMain ? "Main" : `Ref${i}`));
              if (label.length > 15) label = label.substring(0, 12) + "...";
              
              return (
              <a key={i} href={img.image_url} target="_blank" rel="noreferrer" className="relative group/img block" title="Click to open · Right-click to copy image">
                <img src={img.image_url} alt="" className={`w-14 h-14 object-cover rounded-lg border-2 transition-opacity group-hover/img:opacity-80 ${img.isMain ? "border-yellow-300" : "border-violet-300"}`} />
                <span className={`absolute top-0 left-0 text-[8px] font-bold px-0.5 rounded-br text-white max-w-full truncate ${img.isMain ? "bg-yellow-500" : "bg-violet-400"}`}>
                  {label}
                </span>
              {/* Copy URL button */}
              <button
                type="button"
                onClick={(e) => copyUrl(img.image_url, e)}
                className="absolute bottom-0 right-0 w-5 h-5 rounded-tl-lg bg-black/60 text-white text-[9px] flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-black/80"
                title="Copy image URL"
              >
                ⎘
              </button>
            </a>
            );
          })}
        </div>
        <p className="text-[10px] text-violet-300 text-right">{msg.created_at?.slice(0, 16).replace("T", " ")}</p>
      </div>
    </div>
  );
}

function ChatAttributeMsg({ msg, onGenerateNewDesign, isBuilding }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        <span className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center text-xs">✨</span>
        <p className="text-[10px] text-gray-400">Attribute Table · {msg.created_at?.slice(0, 16).replace("T", " ")}</p>
        {isBuilding && <Loader2 size={12} className="animate-spin text-violet-400 ml-1" />}
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <MessageContent
          msg={msg}
          onGenerateNewDesign={onGenerateNewDesign}
        />
      </div>
    </div>
  );
}

function ChatPromptsMsg({ msg, onGenerateImages, isGenerating }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        <span className="w-5 h-5 rounded-full bg-pink-100 flex items-center justify-center text-xs">🔨</span>
        <p className="text-[10px] text-gray-400">Image Prompts · {msg.created_at?.slice(0, 16).replace("T", " ")}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex flex-col gap-2">
        {msg.prompts?.map((prompt, i) => (
          <div key={i} className="flex flex-col gap-2 bg-pink-50 rounded-xl p-3 border border-pink-100">
            <p className="text-xs text-gray-700 leading-relaxed">{prompt}</p>
            <button
              type="button"
              onClick={() => onGenerateImages(prompt)}
              disabled={isGenerating}
              className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-pink-500 hover:bg-pink-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating
                ? <><Loader2 size={12} className="animate-spin" /> Generating...</>
                : <><ImageIcon size={12} /> Generate Image</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatImagesMsg({ msg }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-xs">✅</span>
        <p className="text-[10px] text-gray-400">Generated · {msg.created_at?.slice(0, 16).replace("T", " ")}</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-2 flex-wrap">
          {msg.images?.map((src, i) => (
            <a key={i} href={src} target="_blank" rel="noreferrer">
              <img
                src={src}
                alt={`gen-${i}`}
                className="w-36 h-36 object-cover rounded-xl border border-gray-100 hover:scale-105 transition-transform shadow-sm"
              />
            </a>
          ))}
        </div>
        {msg.prompt && (
          <p className="text-[10px] text-gray-400 mt-2 line-clamp-2 italic">{msg.prompt}</p>
        )}
      </div>
    </div>
  );
}

function LoadingBubble({ label }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        <Loader2 size={14} className="animate-spin text-violet-400" />
        <p className="text-[10px] text-violet-400 font-medium">{label}</p>
      </div>
      <div className="bg-white border border-violet-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-violet-300 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RedesignPhase({ project, onAddTaskToQueue }) {
  const redesign = project.redesign || {};
  const original = project.original || {};
  const originalItem = original.original_item || null;

  // ── Drawer & history picker ──────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [crawlHistory, setCrawlHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pickerHistory, setPickerHistory] = useState(null);

  const loadCrawlHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history?project_id=${project.id}`);
      setCrawlHistory(await res.json());
    } catch (_) {}
    setHistoryLoading(false);
  }, [project.id]);

  // ── Reference images ─────────────────────────────────────────────────────────
  const [refImages, setRefImages] = useState([]);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);

  const handleManualUploadConfirm = (items) => {
    items.forEach(item => {
      setRefImages(prev => {
        const exists = prev.find(p => p.image_url === item.image_url);
        if (exists) return prev;
        return [...prev, item];
      });
    });
  };

  const toggleRefImage = (pin) => {
    setRefImages(prev => {
      const exists = prev.find(p => p.image_url === pin.image_url);
      if (exists) return prev.filter(p => p.image_url !== pin.image_url);
      return [...prev, { ...pin, _historyId: pickerHistory?.id }];
    });
  };

  // ── Manual keyword add ───────────────────────────────────────────────────────
  const [manualKeyword, setManualKeyword] = useState("");
  const [crawlLimit, setCrawlLimit] = useState("");
  const [addingManual, setAddingManual] = useState(false);

  const handleAddManual = async () => {
    const kw = manualKeyword.trim();
    if (!kw) return;
    setAddingManual(true);
    const limit = crawlLimit ? parseInt(crawlLimit) : "max";
    try {
      await onAddTaskToQueue(
        { id: `manual-${Date.now()}`, title: `Crawl: ${kw}`, linked_page: "crawl", linked_keyword: kw, limit_per_source: limit, status: "todo" },
        project.id, project.name, "redesign"
      );
      setManualKeyword("");
    } catch (e) { console.error(e); }
    setAddingManual(false);
  };

  // ── Chat (persisted) ─────────────────────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);

  const saveMessages = useCallback(async (msgs) => {
    try {
      await fetch(`${API_BASE}/api/projects/${project.id}/redesign/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
    } catch (_) {}
  }, [project.id]);

  const appendMessage = useCallback((msg) => {
    setMessages(prev => {
      const next = [...prev, msg];
      saveMessages(next);
      return next;
    });
  }, [saveMessages]);

  useEffect(() => {
    const controller = new AbortController();
    setChatLoading(true);
    fetch(`${API_BASE}/api/projects/${project.id}/redesign/chat`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(data => setMessages(data.messages || []))
      .catch(e => { if (e.name !== "AbortError") console.error(e); })
      .finally(() => setChatLoading(false));
    return () => controller.abort();
  }, [project.id]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── AI loading states ────────────────────────────────────────────────────────
  const [isGettingAttributes, setIsGettingAttributes] = useState(false);

  const [isBuildingPrompt, setIsBuildingPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState("");

  const fetchImagesViaProxy = async (urls) => {
    // Split: data URLs are already base64, only proxy-fetch real URLs
    const results = new Array(urls.length);
    const remoteIndices = [];
    const remoteUrls = [];
    urls.forEach((url, i) => {
      if (url.startsWith("data:")) {
        // Already base64 data URL — extract the base64 portion for the API
        results[i] = url.split(",")[1] || url;
      } else {
        remoteIndices.push(i);
        remoteUrls.push(url);
      }
    });
    if (remoteUrls.length > 0) {
      const r = await fetch(`${API_BASE}/api/proxy-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: remoteUrls }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "Proxy fetch failed");
      const fetched = (await r.json()).images;
      remoteIndices.forEach((origIdx, fetchIdx) => {
        results[origIdx] = fetched[fetchIdx];
      });
    }
    return results;
  };

  const allImages = [
    ...(originalItem ? [{ image_url: originalItem.image_url || originalItem.thumbnail, title: originalItem.title || "main image", isMain: true }] : []),
    ...refImages.map(p => ({ ...p, isMain: false })),
  ];

  const [description, setDescription] = useState("");

  const handleGetAttributes = async () => {
    if (allImages.length === 0 || isGettingAttributes) return;
    setAiError("");
    setIsGettingAttributes(true);
    appendMessage(makeMsg("request", { description: description.trim(), images: allImages }));
    try {
      const base64Images = await fetchImagesViaProxy(allImages.map(p => p.image_url));
      const imageNames = allImages.map((p, i) => {
        const url = p.image_url || "";
        if (url.startsWith("data:")) return p.title || (p.isMain ? "main image" : `ref image ${i}`);
        return url.split("/").pop()?.split("?")[0] || (p.isMain ? "main image" : `ref image ${i}`);
      });
      const data = await getImageAttributes(base64Images, imageNames, description.trim());
      appendMessage(makeMsg("attribute_table", { rows: data.rows, image_names: data.image_names }));
    } catch (e) {
      setAiError(`❌ Get Attributes: ${e.message}`);
    } finally {
      setIsGettingAttributes(false);
    }
  };

  const handleBuildPrompt = async (tableData) => {
    if (!tableData?.rows?.length || isBuildingPrompt) return;
    setAiError("");
    setIsBuildingPrompt(true);
    try {
      const prompts = await buildImagePrompts(tableData.rows, tableData.image_names || []);
      appendMessage(makeMsg("prompts", { prompts }));
    } catch (e) {
      setAiError(`❌ Build Prompt: ${e.message}`);
    } finally {
      setIsBuildingPrompt(false);
    }
  };

  const handleGenerateImages = async (prompt) => {
    if (!prompt || isGenerating) return;
    setAiError("");
    setIsGenerating(true);
    try {
      const images = await generateImages(prompt, 2);
      appendMessage(makeMsg("images", { images, prompt }));
    } catch (e) {
      setAiError(`❌ Generate Image: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };


  const handleClearChat = async () => {
    if (!window.confirm("Xóa toàn bộ lịch sử chat?")) return;
    setMessages([]);
    await fetch(`${API_BASE}/api/projects/${project.id}/redesign/chat`, { method: "DELETE" });
  };

  const canGetAttributes = allImages.length >= 1 && !isGettingAttributes;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Main panel ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto flex flex-col min-w-0">

        {/* ─── Step 1: Crawl Keyword ─────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <StepBadge n="1" label="Crawl Keyword" active={true} />
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 bg-gray-50 focus:bg-white transition-colors"
                placeholder="Nhập keyword để crawl..."
                value={manualKeyword}
                onChange={e => setManualKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddManual()}
              />
            </div>
            <input
              type="number"
              min={1}
              max={200}
              value={crawlLimit}
              onChange={e => setCrawlLimit(e.target.value)}
              placeholder="max"
              className="w-20 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300 bg-gray-50 focus:bg-white transition-colors"
              title="Số lượng kết quả mỗi nguồn (mặc định 60)"
            />
            <button
              type="button"
              onClick={handleAddManual}
              disabled={!manualKeyword.trim() || addingManual}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-colors whitespace-nowrap shadow-sm"
            >
              {addingManual
                ? <><Loader2 size={14} className="animate-spin" /> Adding...</>
                : <>+ Add to Queue</>}
            </button>
          </div>
        </div>

        {/* ─── Step 2: Generate New Design ──────────────────────────────────── */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <StepBadge n="2" label="Generate New Design" active={true} />
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleClearChat}
                className="text-xs text-gray-400 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
              >
                🗑 Clear
              </button>
            )}
          </div>

          {/* Image row */}
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">
                Images ({allImages.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setDrawerOpen(o => !o); if (!drawerOpen) loadCrawlHistory(); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    drawerOpen ? "bg-violet-600 text-white border-violet-600" : "text-violet-600 border-violet-300 hover:bg-violet-50"
                  }`}
                >
                  {drawerOpen ? "✕ Close" : "📂 Pick from history"}
                </button>
                <button
                  type="button"
                  onClick={() => setManualUploadOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border text-violet-600 border-violet-300 hover:bg-violet-50 transition-colors"
                >
                  📷 Upload
                </button>
              </div>
              <ManualUploadModal
                open={manualUploadOpen}
                onClose={() => setManualUploadOpen(false)}
                onConfirm={handleManualUploadConfirm}
                multiple={true}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {/* Main image chip */}
              {originalItem ? (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-yellow-50 border border-yellow-200">
                  <img
                    src={originalItem.image_url || originalItem.thumbnail}
                    alt=""
                    className="w-8 h-8 object-cover rounded-lg border border-yellow-200 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold text-yellow-600 uppercase">Main</p>
                    <p className="text-xs text-gray-700 truncate max-w-[120px]">{originalItem.title || "Original"}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border border-dashed border-gray-200 text-xs text-gray-400">
                  ⚠️ No main image — complete Original phase first.
                </div>
              )}

              {/* Ref image chips */}
              {refImages.map((pin, i) => (
                <div key={i} className="relative group flex items-center gap-1.5 pl-1.5 pr-2 py-1.5 rounded-xl bg-violet-50 border border-violet-200">
                  <img src={pin.image_url} alt="" className="w-8 h-8 object-cover rounded-lg shrink-0" />
                  <p className="text-[9px] font-bold text-violet-500">Ref {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => toggleRefImage(pin)}
                    className="ml-0.5 w-4 h-4 rounded-full bg-violet-200 hover:bg-red-400 text-violet-600 hover:text-white text-[9px] flex items-center justify-center transition-colors"
                  >✕</button>
                </div>
              ))}

              {refImages.length > 0 && (
                <button type="button" onClick={() => setRefImages([])} className="self-center text-[10px] text-gray-400 hover:text-red-400 transition-colors">
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Description + Get Attributes */}
          <div className="flex gap-2">
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleGetAttributes()}
              placeholder="Describe the product (optional)..."
              className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-violet-300 bg-gray-50 focus:bg-white transition-colors"
            />
            <button
              type="button"
              onClick={handleGetAttributes}
              disabled={!canGetAttributes}
              className={`shrink-0 flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold shadow-sm transition-all ${
                isGettingAttributes
                  ? "bg-violet-100 text-violet-400 cursor-not-allowed border border-violet-200"
                  : !canGetAttributes
                    ? "bg-gray-100 text-gray-300 cursor-not-allowed border border-gray-200"
                    : "bg-violet-600 hover:bg-violet-700 text-white border border-violet-600 hover:shadow-md"
              }`}
            >
              {isGettingAttributes
                ? <><Loader2 size={15} className="animate-spin" /> Analysing...</>
                : <><Sparkles size={15} /> Get Attributes</>}
            </button>
          </div>

          {aiError && (
            <p className="mt-2 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{aiError}</p>
          )}
        </div>

        {/* ─── Chat log ─────────────────────────────────────────────────────── */}
        <div className="flex-1 px-6 py-5 flex flex-col gap-5">
          {chatLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-violet-400">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm font-medium">Loading chat history...</span>
            </div>
          ) : messages.length === 0 && !isGettingAttributes && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-gray-300 gap-3">
              <Sparkles size={32} className="text-violet-200" />
              <p className="text-sm font-semibold text-gray-400">No sessions yet</p>
              <p className="text-xs text-gray-300">Select images above and click "Get Attributes" to start.</p>
            </div>
          )}

          {messages.map(msg => {
            if (msg.type === "request") return <ChatRequestMsg key={msg.id} msg={msg} />;
            if (msg.type === "attribute_table") return (
              <ChatAttributeMsg
                key={msg.id}
                msg={msg}
                onGenerateNewDesign={handleBuildPrompt}
                isBuilding={isBuildingPrompt}
              />
            );
            if (msg.type === "prompts") return (
              <ChatPromptsMsg
                key={msg.id}
                msg={msg}
                onGenerateImages={handleGenerateImages}
                isGenerating={isGenerating}
              />
            );
            if (msg.type === "images") return <ChatImagesMsg key={msg.id} msg={msg} />;
            if (msg.type === "loading_idea") return <LoadingBubble key={msg.id} label="Đang phân tích Social Data..." />;
            if (msg.type === "idea_result") return (
              <div key={msg.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 px-1">
                  <span className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center text-xs">💡</span>
                  <p className="text-[10px] text-gray-400">Design Ideas · {msg.created_at?.slice(0, 16).replace("T", " ")}</p>
                </div>
                <div className="bg-white border border-amber-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {msg.text}
                </div>
              </div>
            );
            return null;
          })}

          {/* Live loading bubbles */}
          {isGettingAttributes && <LoadingBubble label="Analysing images..." />}
          {isBuildingPrompt && <LoadingBubble label="Building design prompt..." />}
          {isGenerating && <LoadingBubble label="Generating images..." />}

          <div ref={chatBottomRef} />
        </div>
      </div>

      {/* ── Side Drawer ──────────────────────────────────────────────────────── */}
      <div className={`shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col overflow-hidden transition-all duration-300 ${drawerOpen ? "w-[340px]" : "w-0"}`}>
        {drawerOpen && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0 bg-white">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-700">📂 Crawl History</span>
                <button
                  type="button"
                  onClick={loadCrawlHistory}
                  disabled={historyLoading}
                  className="text-xs text-violet-500 hover:underline disabled:opacity-50 flex items-center gap-0.5"
                >
                  {historyLoading ? <Loader2 size={12} className="animate-spin" /> : "↻"}
                </button>
              </div>
              {refImages.length > 0 && (
                <span className="text-xs font-semibold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
                  {refImages.length} selected
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {crawlHistory.length === 0 && !historyLoading && (
                <p className="text-xs text-gray-400 italic px-4 py-6 text-center">No crawl history yet.</p>
              )}
              {crawlHistory.map(h => {
                const total = (h.pinterest_count || 0) + (h.instagram_count || 0) + (h.tiktok_count || 0) + (h.youtube_count || 0);
                const pickedCount = refImages.filter(p => p._historyId === h.id).length;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setPickerHistory({ id: h.id, keyword: h.keyword })}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left border-b border-gray-100 last:border-b-0 hover:bg-violet-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate text-xs text-gray-800 group-hover:text-violet-700">{h.keyword}</p>
                      <p className="text-[10px] text-gray-400">{h.created_at?.slice(0, 10)} · {total} pins</p>
                    </div>
                    {pickedCount > 0 && (
                      <span className="text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded-full shrink-0">✓{pickedCount}</span>
                    )}
                    <span className="text-[10px] text-gray-400 shrink-0 opacity-0 group-hover:opacity-100">→</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* History Picker Modal */}
      {pickerHistory && (
        <HistoryPickerModal
          historyId={pickerHistory.id}
          historyKeyword={pickerHistory.keyword}
          selectedPins={refImages}
          onTogglePin={toggleRefImage}
          onClose={() => setPickerHistory(null)}
        />
      )}

    </div>
  );
}
