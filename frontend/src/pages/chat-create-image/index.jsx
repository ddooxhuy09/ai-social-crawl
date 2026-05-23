import { useState, useRef, useEffect } from "react";
import { Download, Copy, Settings, Clock, ImagePlus, Images, CircleX, PanelLeftClose, PanelLeftOpen, Sparkles, Trash2, RefreshCw, X, Search } from "lucide-react";
import { API_BASE } from "../../constants";
import { MessageContent } from "../../components/AttributeTable";
import { getImageAttributes, buildImagePrompts, generateImages } from "../../lib/imageAI";
import { Button } from "../../components/ui/button";


export default function ChatCreateImagePage() {
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState("");
  const [mainImage, setMainImage] = useState(null);
  const [crawlImages, setCrawlImages] = useState([]);
  const [attributeDescription] = useState("");
  const [isGettingAttributes, setIsGettingAttributes] = useState(false);
  const [sessionId, setSessionId] = useState(() => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(false);
  const [showPrompts, setShowPrompts] = useState(true);

  const mainImageRef = useRef(null);
  const crawlImagesRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/generate-image/config`)
      .then((r) => r.json())
      .then((d) => { setGeminiKey(d.gemini_api_key_masked || ""); })
      .catch(() => { });
    loadChatSessions();
  }, []);

  const loadChatSessions = () => {
    fetch(`${API_BASE}/api/chat-ai/history`)
      .then((r) => r.json())
      .then((d) => setChatSessions(Array.isArray(d) ? d : []))
      .catch(() => { });
  };

  const saveCurrentSession = (msgs) => {
    const title = msgs.find((m) => m.role === "user")?.text?.slice(0, 40) || "New Chat";
    fetch(`${API_BASE}/api/chat-ai/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: sessionId, title,
        messages: msgs.map((m) => ({ 
          role: m.role, text: m.text, images: m.images || [], concepts: m.concepts, 
          prompts: m.prompts || [], imageNames: m.imageNames || [],
          comments: m.comments, description: m.description, rows: m.rows, image_names: m.image_names,
          captchaReq: m.captchaReq, jobId: m.jobId
        })),
      }),
    }).then(() => loadChatSessions()).catch(() => { });
  };

  const loadSession = (id) => {
    fetch(`${API_BASE}/api/chat-ai/history/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setSessionId(d.id);
        const msgs = d.messages.map((m, i) => ({ ...m, id: i + 1, pending: false }));
        setMessages(msgs);
        setActiveSession(true);
      })
      .catch(() => { });
  };

  const deleteSession = async (id, e) => {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/chat-ai/history/${id}`, { method: "DELETE" });
    setChatSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === sessionId) {
      setSessionId(new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
      setMessages([]);
      setActiveSession(false);
    }
  };

  const newSession = () => {
    const newId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    setSessionId(newId);
    setMessages([]);
    setActiveSession(true);
    fetch(`${API_BASE}/api/chat-ai/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newId, title: "New Chat", messages: [] }),
    }).then(() => loadChatSessions()).catch(() => {});
  };

  const handleMainImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMainImage({ file, src: URL.createObjectURL(file) });
    e.target.value = "";
  };

  const handleCrawlImagesChange = (e) => {
    const files = Array.from(e.target.files || []);
    setCrawlImages((prev) => [...prev, ...files.map((f) => ({ file: f, src: URL.createObjectURL(f) }))]);
    e.target.value = "";
  };

  const removeCrawlImage = (idx) => setCrawlImages((prev) => prev.filter((_, i) => i !== idx));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSaveConfig = async () => {
    setSavingConfig(true); setConfigMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/generate-image/config`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: geminiKey }),
      });
      if (r.ok) { setConfigMsg("Đã lưu!"); setShowSettings(false); }
      else setConfigMsg("Lỗi lưu config.");
    } catch { setConfigMsg("Không kết nối được backend."); }
    finally { setSavingConfig(false); }
  };

  const handleSaveTable = (msgId, savedData, newConcepts) => {
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.id !== msgId) return m;
        if (savedData === null) return { ...m, concepts: newConcepts || m.concepts };
        // savedData is { rows, image_names } — keep as JSON, don't convert to text
        return {
          ...m,
          rows: savedData.rows !== undefined ? savedData.rows : m.rows,
          image_names: savedData.image_names !== undefined ? savedData.image_names : m.image_names,
          text: null,
          concepts: newConcepts || m.concepts,
        };
      });
      saveCurrentSession(updated);
      return updated;
    });
  };

  const handleGenerateNewDesign = async (tableData) => {
    if (isGenerating) return;
    let rows, imageNames;
    if (tableData && tableData.rows) {
      rows = tableData.rows;
      imageNames = tableData.image_names || [];
    } else {
      // fallback: find latest message with rows
      const tableMsg = [...messages].reverse().find((m) => m.rows?.length > 0);
      if (!tableMsg) { alert("Chưa có bảng thuộc tính nào. Hãy chạy 'Get Attribute Image' trước."); return; }
      rows = tableMsg.rows;
      imageNames = tableMsg.image_names || [];
    }
    if (!rows?.length) { alert("Bảng thuộc tính trống."); return; }

    const mainImageMsg = messages.find((m) => m.images && m.images.length > 0);
    const mainImageSrc = mainImageMsg?.images?.[0];

    setIsGenerating(true);
    const msgId = Date.now();
    setMessages((prev) => [...prev, { id: msgId, role: "user", text: `🎨 Generate New Design từ bảng thuộc tính`, images: [] }]);
    const loadingId = msgId + 1;
    setMessages((prev) => [...prev, { id: loadingId, role: "assistant", text: `Đang tạo prompt từ bảng thuộc tính...`, images: [], pending: true }]);

    let generatedPrompts = null;
    try {
      generatedPrompts = await buildImagePrompts(rows, imageNames);
      if (!generatedPrompts?.length) throw new Error("Gemini không tạo được prompt nào từ bảng thuộc tính");

      const promptsList = generatedPrompts.join("\n\n---\n\n");
      setMessages((prev) => prev.map((m) => m.id === loadingId ? { ...m, text: `Prompts (${generatedPrompts.length}):\n${promptsList}`, pending: true } : m));

      if (!mainImageSrc) throw new Error("Không tìm thấy ảnh Main Image trong lịch sử.");

      const allImages = [];
      for (const prompt of generatedPrompts) {
        try {
          const imgs = await generateImages(prompt, 1);
          allImages.push(...imgs);
        } catch (_) {}
      }

      if (!allImages.length) throw new Error("Gemini không tạo được ảnh nào");

      setMessages((prev) => {
        const updated = prev.map((m) => m.id === loadingId
          ? { ...m, text: `Tạo xong ${allImages.length} ảnh bằng Gemini (${generatedPrompts.length} prompts):\n\n${promptsList}`, images: allImages, pending: false, prompts: generatedPrompts }
          : m);
        saveCurrentSession(updated);
        return updated;
      });
    } catch (err) {
      const errorMsg = `❌ Lỗi: ${err.message}\n\nPrompts:\n${generatedPrompts?.join('\n---\n') || "Không tạo được prompt"}`;
      setMessages((prev) => {
        const updated = prev.map((m) => m.id === loadingId ? { ...m, text: errorMsg, images: [], pending: false, prompts: generatedPrompts || [] } : m);
        saveCurrentSession(updated);
        return updated;
      });
    } finally { setIsGenerating(false); }
  };


  const handleGetAttributes = async () => {
    if ((!mainImage && crawlImages.length === 0) || isGettingAttributes) return;
    const toBase64 = (src) => fetch(src).then(r => r.blob()).then(blob => new Promise(res => { const reader = new FileReader(); reader.onloadend = () => res(reader.result); reader.readAsDataURL(blob); }));
    setIsGettingAttributes(true);
    const loadingId = Date.now();
    const sources = [...(mainImage ? [mainImage.src] : []), ...crawlImages.map(c => c.src)];
    const base64Images = await Promise.all(sources.map(toBase64));
    const imageNames = [...(mainImage ? [mainImage.file?.name || "main image"] : []), ...crawlImages.map(c => c.file?.name || "crawl image")];
    const imageLabels = [...(mainImage ? [mainImage.file?.name || "Main Image"] : []), ...crawlImages.map((c, i) => c.file?.name || `Crawl ${i + 1}`)];
    setMessages((prev) => [...prev, {
      id: loadingId - 1, role: "user",
      text: `📷 Phân tích ${sources.length} ảnh: ${imageLabels.join(", ")}`,
      images: base64Images,
    }]);
    setMessages((prev) => [...prev, { id: loadingId, role: "assistant", text: `Đang phân tích ${sources.length} ảnh...`, images: [], pending: true }]);
    try {
      const data = await getImageAttributes(base64Images, imageNames, attributeDescription.trim());
      setMessages((prev) => {
        const updated = prev.map((m) => m.id === loadingId ? { ...m, rows: data.rows, image_names: data.image_names, text: null, images: [], pending: false } : m);
        saveCurrentSession(updated);
        return updated;
      });
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === loadingId ? { ...m, text: `❌ Lỗi: ${err.message}`, images: [], pending: false } : m));
    } finally { setIsGettingAttributes(false); }
  };


  return (
    <div className="flex flex-col md:flex-row h-full bg-white">
      {/* Sidebar */}
      <div className={`shrink-0 border-r border-gray-200 flex flex-col bg-gray-50 transition-all duration-300 overflow-hidden md:border-r md:border-gray-200 border-b md:border-b-0 ${showPrompts ? "w-full md:w-[240px] max-h-[160px] md:max-h-none" : "w-0 md:w-0 md:border-r-0 max-h-0 md:max-h-none border-r-0 border-b-0"}`}>
        <div className="px-3 pt-3 pb-2 shrink-0 min-w-0 md:min-w-[240px]">
          <Button variant="outline" type="button" onClick={newSession}
            className="w-full justify-center gap-2 border-dashed border-gray-300 text-gray-500 hover:border-violet-400 hover:text-violet-600 hover:bg-violet-50">
            + New Chat
          </Button>
        </div>
        <div className="flex-1 overflow-x-auto md:overflow-auto px-2 pb-2 flex flex-row md:flex-col gap-1 min-w-0 md:min-w-[240px]">
          {chatSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <Clock size={28} className="text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">Lịch sử chat sẽ hiển thị ở đây.</p>
            </div>
          ) : chatSessions.map((s, idx) => (
            <div key={s.id}
              className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors border shrink-0 md:shrink w-48 md:w-auto ${s.id === sessionId ? "bg-white border-violet-200 text-violet-700 shadow-sm" : "border-transparent hover:bg-white hover:border-gray-200 text-gray-700"}`}
              onClick={() => loadSession(s.id)}>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <p className="text-sm font-medium truncate leading-tight">{s.title || `Chat ${chatSessions.length - idx}`}</p>
                <p className="text-xs text-gray-400">{s.message_count} tin · {s.created_at?.slice(5, 16).replace("T", " ")}</p>
              </div>
              <Button variant="ghost" type="button" onClick={(e) => deleteSession(s.id, e)}
                className="px-0 h-auto opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 shrink-0 mt-0.5 transition-opacity">
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {!activeSession ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center select-none px-8 relative">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-xl">
              <Sparkles size={38} className="text-white" />
            </div>
            <div>
              <p className="text-xl font-semibold text-gray-800">Crawl & AI Chat</p>
              <p className="text-sm text-gray-500 mt-1.5 flex flex-col items-center gap-1">
                <span>Trích xuất Insight từ Comments & Tạo ảnh AI.</span>
                <span>Tất cả trong một không gian.</span>
              </p>
            </div>
            <Button variant="violet" type="button" onClick={newSession}
              className="mt-4 shadow-md flex gap-2 items-center">
              Bắt đầu ngay <Sparkles size={16} />
            </Button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-2 md:gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-gray-200 shrink-0 bg-white z-10 shadow-sm relative overflow-x-auto">
              <Button variant="ghost" type="button" onClick={() => setShowPrompts(p => !p)}
                className="px-1.5 -ml-2 text-gray-400 hover:text-gray-700 rounded-lg">
                {showPrompts ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              </Button>
              <h2 className="text-base font-bold text-gray-800 flex items-center gap-2 border-r border-gray-200 pr-4">
                <Sparkles size={18} className="text-violet-600" />
                Chat AI
              </h2>
              
              <div className="flex items-center gap-2 flex-1 min-w-0 pl-1">
                <button type="button" onClick={handleGetAttributes}
                  disabled={isGettingAttributes || (!mainImage && crawlImages.length === 0)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${isGettingAttributes ? "bg-amber-50 text-amber-500 border-amber-200 cursor-not-allowed" : (!mainImage && crawlImages.length === 0) ? "text-gray-400 border-gray-200 cursor-not-allowed bg-gray-50" : "text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"}`}>
                  {isGettingAttributes ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  <span>Get Images Attribute</span>
                </button>
              </div>
              <Button variant="ghost" type="button" onClick={() => setShowSettings(true)}
                className="ml-auto px-2 text-gray-400 hover:text-gray-700 rounded-lg">
                <Settings size={18} />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto px-4 md:px-6 py-6 flex flex-col gap-6 bg-gray-50/50">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center select-none text-gray-400">
                  <div className="flex gap-4">
                      <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm w-44">
                          <ImagePlus size={24} className="text-pink-500" />
                          <p className="text-sm font-medium text-gray-700">Tạo ảnh AI</p>
                          <p className="text-xs">Gửi prompt để AI vẽ ảnh bằng Imagen 3</p>
                      </div>
                      <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm w-44">
                          <Search size={24} className="text-violet-500" />
                          <p className="text-sm font-medium text-gray-700">Trích xuất Insight</p>
                          <p className="text-xs">Cào comment từ Etsy, IG và phân tích với Gemini</p>
                      </div>
                  </div>
                </div>
              )}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold shadow-sm ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white"}`}>
                    {msg.role === "user" ? "Me" : <Sparkles size={14} />}
                  </div>
                  <div className={`max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-2`}>
                    <div className={`px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap rounded-2xl shadow-sm ${msg.role === "user" ? "bg-violet-600 text-white rounded-tr-sm" : "bg-white text-gray-800 rounded-tl-sm border border-gray-200"}`}>
                      {msg.rows ? (
                        <MessageContent msg={msg}
                          onSave={(newRows) => handleSaveTable(msg.id, newRows)}
                          onGenerateNewDesign={handleGenerateNewDesign} />
                      ) : (
                          <div className={msg.pending ? "animate-pulse" : ""}>
                             {msg.text}
                          </div>
                      )}
                    </div>
                    {msg.images?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {msg.images.map((src, idx) => (
                          <div key={idx} className="relative group w-44 h-44 rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
                            <img src={src} alt={`gen-${idx}`} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                              <Button variant="ghost" type="button"
                                onClick={() => { const a = document.createElement("a"); a.href = src; a.download = `image-${idx + 1}.jpg`; a.click(); }}
                                className="w-8 h-8 px-0 bg-white/90 rounded-lg text-gray-700 hover:bg-white shadow-lg">
                                <Download size={16} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.role === "user" && (msg.text?.length ?? 0) > 50 && !msg.text?.includes("Crawl link:") && (
                      <Button variant="ghost" size="xs" type="button" onClick={() => navigator.clipboard.writeText(msg.text)}
                        className="px-0 h-auto text-gray-400 hover:text-gray-600 hover:bg-transparent mr-1">
                        <Copy size={11} /> Copy
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            {/* Input area */}
            <div className="px-4 md:px-6 py-4 bg-white border-t border-gray-200 shrink-0 relative z-10 shadow-[0_-10px_30px_rgba(0,0,0,0.02)]">
              {/* Attachments preview */}
              {(mainImage || crawlImages.length > 0) && (
                <div className="flex flex-wrap gap-3 pb-3 mb-2 border-b border-gray-100">
                  {mainImage && (
                    <div className="flex flex-col gap-1 items-start">
                      <span className="text-[10px] font-bold tracking-wider uppercase text-purple-500">Main Image</span>
                      <div className="relative group w-16 h-16 rounded-lg overflow-hidden border-2 border-purple-200">
                        <img src={mainImage.src} alt="main" className="w-full h-full object-cover" />
                        <Button variant="ghost" type="button" onClick={() => setMainImage(null)}
                          className="absolute -top-1 -right-1 p-0 w-4 h-4 h-auto bg-white rounded-full text-red-500 hover:bg-red-50 hidden group-hover:block drop-shadow-md">
                          <CircleX size={16} />
                        </Button>
                      </div>
                    </div>
                  )}
                  {crawlImages.length > 0 && (
                    <div className="flex flex-col gap-1 items-start">
                      <span className="text-[10px] font-bold tracking-wider uppercase text-pink-500">Crawl Images ({crawlImages.length})</span>
                      <div className="flex gap-2 flex-wrap">
                        {crawlImages.map((img, idx) => (
                          <div key={idx} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-pink-200">
                            <img src={img.src} alt={`crawl-${idx}`} className="w-full h-full object-cover" />
                            <Button variant="ghost" type="button" onClick={() => removeCrawlImage(idx)}
                              className="absolute -top-1 -right-1 p-0 w-4 h-4 h-auto bg-white rounded-full text-red-500 hover:bg-red-50 hidden group-hover:block drop-shadow-md">
                              <CircleX size={16} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => mainImageRef.current?.click()} title="Đính kèm ảnh chính"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${mainImage ? "bg-purple-50 text-purple-700 border-purple-200" : "text-gray-500 border-transparent hover:bg-gray-100"}`}>
                  <ImagePlus size={15} /><span>Main</span>
                </button>
                <button type="button" onClick={() => crawlImagesRef.current?.click()} title="Đính kèm ảnh mẫu cào được"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${crawlImages.length > 0 ? "bg-pink-50 text-pink-600 border-pink-200" : "text-gray-500 border-transparent hover:bg-gray-100"}`}>
                  <Images size={15} /><span>Refs {crawlImages.length > 0 ? `(${crawlImages.length})` : ""}</span>
                </button>
              </div>
              <input ref={mainImageRef} type="file" accept="image/*" className="hidden" onChange={handleMainImageChange} />
              <input ref={crawlImagesRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCrawlImagesChange} />
            </div>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-[420px] p-6 animation-scale-up" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Settings size={18} className="text-gray-600" /> Web Settings
              </h3>
              <button type="button" onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600 rounded-lg p-1 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">Gemini API Key</label>
                <input type="text" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400 bg-gray-50 focus:bg-white transition-colors" />
              </div>
              {configMsg && <p className={`text-sm font-medium ${configMsg.includes("Lỗi") ? "text-red-500" : "text-green-600"}`}>{configMsg}</p>}
              <button type="button" onClick={handleSaveConfig} disabled={savingConfig}
                className="w-full py-3 mt-2 bg-gray-900 hover:bg-black disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors shadow-md">
                {savingConfig ? "Đang lưu..." : "Lưu cài đặt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
