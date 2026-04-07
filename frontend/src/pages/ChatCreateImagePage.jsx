import React, { useState, useRef, useEffect } from "react";
import { Send, Image as ImageIcon, Download, Copy, Settings, BookMarked, Clock, ImagePlus, Images, CircleX, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import { API_BASE } from "../constants";
import { EditableTable, InlineText, MessageContent } from "../components/AttributeTable";

const MODELS = [
  { id: "imagen-3.0-generate-002", label: "Gemini Imagen 3", desc: "Google Imagen" },
];

const STYLE_PRESETS = [
  "Product photo, white background",
  "Watercolor illustration",
  "Minimalist flat design",
  "Photorealistic",
  "Cute cartoon style",
  "Pinterest aesthetic",
  "Dark moody style",
  "Bright pastel colors",
];

export default function ChatCreateImagePage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [numImages, setNumImages] = useState(2);
  const [showSettings, setShowSettings] = useState(false);
  const [hfToken, setHfToken] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState("");
  const [savedPrompts, setSavedPrompts] = useState([]);
  const [showPrompts, setShowPrompts] = useState(true);
  const [mainImage, setMainImage] = useState(null);
  const [crawlImages, setCrawlImages] = useState([]);
  const [attributeDescription, setAttributeDescription] = useState("");
  const [isGettingAttributes, setIsGettingAttributes] = useState(false);
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);
  const [sessionId, setSessionId] = useState(() => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(false);
  const mainImageRef = useRef(null);
  const crawlImagesRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Load masked token on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/generate-image/config`)
      .then((r) => r.json())
      .then((d) => {
        setGeminiKey(d.gemini_api_key_masked || "");
      })
      .catch(() => { });
    loadSavedPrompts();
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
        id: sessionId,
        title,
        messages: msgs.map((m) => ({ role: m.role, text: m.text, images: m.images || [], concepts: m.concepts, prompts: m.prompts || [], imageNames: m.imageNames || [] })),
      }),
    })
      .then(() => loadChatSessions())
      .catch(() => { });
  };

  const loadSession = (id) => {
    fetch(`${API_BASE}/api/chat-ai/history/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setSessionId(d.id);
        setMessages(d.messages.map((m, i) => ({ ...m, id: i + 1, pending: false })));
        setActiveSession(true);
      })
      .catch(() => { });
  };

  const deleteSession = async (id, e) => {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/chat-ai/history/${id}`, { method: "DELETE" });
    setChatSessions((prev) => prev.filter((s) => s.id !== id));
    if (id === sessionId) {
      const newId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      setSessionId(newId);
      setMessages([]);
      setActiveSession(false);
    }
  };

  const newSession = () => {
    const newId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    setSessionId(newId);
    setMessages([]);
    setActiveSession(true);
  };

  const loadSavedPrompts = () => {
    fetch(`${API_BASE}/api/generate-image/prompts`)
      .then((r) => r.json())
      .then((d) => setSavedPrompts(Array.isArray(d) ? d : []))
      .catch(() => { });
  };

  const handleDeletePrompt = async (id) => {
    await fetch(`${API_BASE}/api/generate-image/prompts/${id}`, { method: "DELETE" });
    setSavedPrompts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleMainImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const src = URL.createObjectURL(file);
    setMainImage({ file, src });
    e.target.value = "";
  };

  const handleCrawlImagesChange = (e) => {
    const files = Array.from(e.target.files || []);
    const items = files.map((f) => ({ file: f, src: URL.createObjectURL(f) }));
    setCrawlImages((prev) => [...prev, ...items]);
    e.target.value = "";
  };

  const removeCrawlImage = (idx) => {
    setCrawlImages((prev) => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setConfigMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/generate-image/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: geminiKey }),
      });
      if (r.ok) {
        setConfigMsg("Đã lưu!");
        setShowSettings(false);
      } else {
        setConfigMsg("Lỗi lưu config.");
      }
    } catch {
      setConfigMsg("Không kết nối được backend.");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveTable = (msgId, newText, newConcepts) => {
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.id !== msgId) return m;
        // Nếu newText là null (chỉ update concepts), giữ nguyên rows/text
        if (newText === null) return { ...m, concepts: newConcepts || m.concepts };
        // Nếu save markdown, clear rows để dùng markdown path
        return { ...m, text: newText, rows: undefined, image_names: undefined, concepts: newConcepts || m.concepts };
      });
      saveCurrentSession(updated);
      return updated;
    });
  };

  const handleGenerateNewDesign = async (tableMarkdown) => {
    if (isGenerating) return;

    // Parse table markdown để lấy bảng
    let tableText = tableMarkdown;

    // Nếu không có table markdown được truyền, thử lấy từ messages
    if (!tableText) {
      const tableMsg = [...messages].reverse().find((m) => m.text && m.text.includes("|"));
      if (!tableMsg) {
        alert("Chưa có bảng thuộc tính nào. Hãy chạy 'Get Attribute Image' trước.");
        return;
      }
      tableText = tableMsg.text;
    }

    // Lấy mainImage từ messages (ảnh đầu tiên trong history)
    const mainImageMsg = messages.find((m) => m.images && m.images.length > 0);
    const mainImageSrc = mainImageMsg?.images?.[0];

    const lines = tableText.split("\n");
    const headerLine = lines.find(l => l.includes("Thuộc tính") && l.includes("THIẾT KẾ MỚI"));
    if (!headerLine) {
      alert("Không tìm thấy bảng thuộc tính hợp lệ.");
      return;
    }

    // Bước 1: Gọi API build-prompt để Gemini sinh prompt từ bảng thuộc tính
    setIsGenerating(true);
    const msgId = Date.now();

    setMessages((prev) => [
      ...prev,
      { id: msgId, role: "user", text: `🎨 Generate New Design từ bảng thuộc tính`, images: [] },
    ]);

    const loadingId = msgId + 1;
    setMessages((prev) => [
      ...prev,
      { id: loadingId, role: "assistant", text: `Đang tạo prompt từ bảng thuộc tính...`, images: [], pending: true },
    ]);

    try {
      // B1: Gọi API build-prompt
      const buildPromptRes = await fetch(`${API_BASE}/api/generate-image/build-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute_table: tableText }),
      });

      if (!buildPromptRes.ok) {
        const errData = await buildPromptRes.json();
        throw new Error(errData.detail || "Lỗi tạo prompt từ bảng");
      }

      const { prompts: generatedPrompts } = await buildPromptRes.json();

      if (!generatedPrompts || generatedPrompts.length === 0) {
        throw new Error("Gemini không tạo được prompt nào từ bảng thuộc tính");
      }

      // Cập nhật message: đang generate ảnh
      const promptsList = generatedPrompts.join("\n\n---\n\n");
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `Prompts (${generatedPrompts.length}):\n${promptsList}`, pending: true }
            : m
        );
        return updated;
      });

      // B2: Gọi API Fal AI để generate ảnh (cần có mainImage từ history)
      if (!mainImageSrc) {
        throw new Error("Không tìm thấy ảnh Main Image trong lịch sử. Hãy chạy 'Get Attribute Image' trước.");
      }

      // Convert mainImage to base64
      const toBase64 = (src) =>
        fetch(src)
          .then((r) => r.blob())
          .then(
            (blob) =>
              new Promise((res) => {
                const reader = new FileReader();
                reader.onloadend = () => res(reader.result);
                reader.readAsDataURL(blob);
              })
          );

      const mainImageB64 = await toBase64(mainImageSrc);

      // Gọi Gemini API để generate ảnh cho từng prompt
      const allImages = [];
      for (let i = 0; i < generatedPrompts.length; i++) {
        const prompt = generatedPrompts[i];

        const generateRes = await fetch(`${API_BASE}/api/generate-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt,
            num_images: 1,
          }),
        });

        if (!generateRes.ok) {
          const errData = await generateRes.json();
          console.error(`Lỗi Gemini prompt ${i + 1}:`, errData);
          continue;
        }

        const data = await generateRes.json();
        if (data.images && data.images.length > 0) {
          allImages.push(...data.images);
        }
      }

      if (allImages.length === 0) {
        throw new Error("Gemini không tạo được ảnh nào");
      }

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `Tạo xong ${allImages.length} ảnh bằng Gemini (${generatedPrompts.length} prompts):\n\n${promptsList}`, images: allImages, pending: false, prompts: generatedPrompts }
            : m
        );
        saveCurrentSession(updated);
        return updated;
      });
    } catch (err) {
      const errorMsg = `❌ Lỗi: ${err.message}\n\nPrompts (Bước 1):\n${generatedPrompts ? generatedPrompts.join('\n---\n') : "Không tạo được prompt"}`;
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: errorMsg, images: [], pending: false, prompts: generatedPrompts || [] }
            : m
        );
        saveCurrentSession(updated);
        return updated;
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateIdea = async () => {
    if (isGeneratingIdea) return;
    // Lấy nội dung table từ message cuối cùng có table
    const tableMsg = [...messages].reverse().find((m) => m.text && m.text.includes("|"));
    if (!tableMsg) {
      alert("Chưa có attribute table. Hãy chạy 'Get Attribute Image' trước.");
      return;
    }
    setIsGeneratingIdea(true);
    const loadingId = Date.now();
    setMessages((prev) => [
      ...prev,
      { id: loadingId, role: "assistant", text: "Đang sinh ý tưởng...", images: [], pending: true },
    ]);
    try {
      const r = await fetch(`${API_BASE}/api/generate-image/idea`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute_table: tableMsg.text, description: attributeDescription.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Lỗi sinh idea");
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingId ? { ...m, text: data.idea, images: [], pending: false } : m
        );
        saveCurrentSession(updated);
        return updated;
      });
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId ? { ...m, text: `❌ Lỗi: ${err.message}`, images: [], pending: false } : m
        )
      );
    } finally {
      setIsGeneratingIdea(false);
    }
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || isGenerating) return;

    const fullPrompt = selectedStyle ? `${prompt}, ${selectedStyle}` : prompt;
    const msgId = Date.now();

    setMessages((prev) => [
      ...prev,
      { id: msgId, role: "user", text: prompt, images: [] },
    ]);
    setInput("");
    setIsGenerating(true);

    // Add loading assistant message
    const loadingId = msgId + 1;
    setMessages((prev) => [
      ...prev,
      { id: loadingId, role: "assistant", text: `Đang tạo ${numImages} ảnh...`, images: [], pending: true },
    ]);

    try {
      const r = await fetch(`${API_BASE}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, model: selectedModel.id, num_images: numImages }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Lỗi tạo ảnh");

      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `Tạo xong ${data.images.length} ảnh cho: "${prompt}"`, images: data.images, pending: false }
            : m
        );
        saveCurrentSession(updated);
        return updated;
      });
      loadSavedPrompts();
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `❌ Lỗi: ${err.message}`, images: [], pending: false }
            : m
        )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyPrompt = (text) => {
    navigator.clipboard.writeText(text).catch(() => { });
  };

  const handleGetAttributes = async () => {
    if ((!mainImage && crawlImages.length === 0) || isGettingAttributes) return;

    const toBase64 = (src) =>
      fetch(src)
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise((res) => {
              const reader = new FileReader();
              reader.onloadend = () => res(reader.result);
              reader.readAsDataURL(blob);
            })
        );

    setIsGettingAttributes(true);
    const loadingId = Date.now();
    const imgCount = (mainImage ? 1 : 0) + crawlImages.length;

    // Build ordered list: main first, then crawl images
    const sources = [
      ...(mainImage ? [mainImage.src] : []),
      ...crawlImages.map((c) => c.src),
    ];

    // Convert all images to base64 for persistence
    const base64Images = await Promise.all(sources.map(toBase64));

    // Lấy tên file ảnh
    const imageNames = [
      ...(mainImage ? [mainImage.file?.name || "main image"] : []),
      ...crawlImages.map((c) => c.file?.name || "crawl image"),
    ];

    // Add user message showing uploaded images (mainImage, crawlImages)
    const userMsgId = loadingId - 1;
    const imageLabels = [
      ...(mainImage ? [mainImage.file?.name || "Main Image"] : []),
      ...crawlImages.map((c, i) => c.file?.name || `Crawl ${i + 1}`),
    ];
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        text: `📷 Phân tích ${imgCount} ảnh: ${imageLabels.join(", ")}${attributeDescription ? `\n📝 Mô tả: ${attributeDescription}` : ""}`,
        images: base64Images,
        mainImage: mainImage?.file?.name || null,
        crawlImages: crawlImages.map((c) => c.file?.name),
      },
    ]);

    // Add assistant loading message
    setMessages((prev) => [
      ...prev,
      { id: loadingId, role: "assistant", text: `Đang phân tích ${imgCount} ảnh...`, images: [], pending: true },
    ]);

    try {
      // Use base64Images already computed above
      const images = base64Images;

      const r = await fetch(`${API_BASE}/api/generate-image/attributes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, image_names: imageNames, description: attributeDescription.trim() || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Lỗi phân tích ảnh");
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === loadingId
            ? { ...m, rows: data.rows, image_names: data.image_names, text: null, images: [], pending: false }
            : m
        );
        saveCurrentSession(updated);
        return updated;
      });
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? { ...m, text: `❌ Lỗi: ${err.message}`, images: [], pending: false }
            : m
        )
      );
    } finally {
      setIsGettingAttributes(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Chat Sidebar — collapsible */}
      <div className={`shrink-0 border-r border-gray-200 flex flex-col bg-gray-50 transition-all duration-300 overflow-hidden ${showPrompts ? "w-[240px]" : "w-0 border-r-0"}`}>
        {/* New chat button */}
        <div className="px-3 pt-3 pb-2 shrink-0 min-w-[240px]">
          <button
            type="button"
            onClick={newSession}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:border-pink-300 hover:text-pink-500 transition-colors"
          >
            + New Chat
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2 pb-2 flex flex-col gap-1 min-w-[240px]">
          {chatSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <Clock size={28} className="text-gray-300 mb-2" />
              <p className="text-xs text-gray-400">Lịch sử chat<br />sẽ hiển thị ở đây.</p>
            </div>
          ) : (
            chatSessions.map((s, idx) => {
              const chatNumber = chatSessions.length - idx;
              return (
                <div
                  key={s.id}
                  className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors border ${s.id === sessionId ? "bg-white border-pink-200 text-pink-600" : "border-transparent hover:bg-white hover:border-gray-200 text-gray-700"
                    }`}
                  onClick={() => loadSession(s.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">Chat {chatNumber}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.message_count} tin · {s.created_at?.slice(0, 10)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => deleteSession(s.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 shrink-0 mt-0.5"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {!activeSession ? (
          /* Landing screen — shown before any session is started */
          <div className="flex flex-col items-center justify-center h-full gap-5 text-center select-none px-8">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center shadow-xl">
              <Sparkles size={38} className="text-white" />
            </div>
            <div>
              <p className="text-xl font-semibold text-gray-700">Chat Create Image</p>
              <p className="text-sm text-gray-400 mt-1.5">Tạo ảnh AI với Gemini Imagen từ mô tả văn bản</p>
            </div>
            <button
              type="button"
              onClick={newSession}
              className="mt-2 px-6 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-sm font-semibold transition-colors shadow-md"
            >
              + New Chat
            </button>
            {chatSessions.length > 0 && (
              <p className="text-xs text-gray-400">hoặc chọn một cuộc trò chuyện từ danh sách bên trái</p>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-200 shrink-0">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Sparkles size={20} className="text-pink-500" />
                Chat Create Image
              </h2>
              <button type="button" onClick={() => setShowPrompts(p => !p)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title={showPrompts ? "Ẩn sidebar" : "Hiện sidebar"}>
                {showPrompts ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>

              {/* Description input + Get Attribute Image button */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="text"
                  value={attributeDescription}
                  onChange={(e) => setAttributeDescription(e.target.value)}
                  placeholder="Mô tả sản phẩm (tùy chọn)..."
                  className="flex-1 min-w-0 px-3 py-2 text-sm rounded-xl border border-gray-200 focus:outline-none focus:border-amber-300 bg-white"
                />
                <button
                  type="button"
                  onClick={handleGetAttributes}
                  disabled={isGettingAttributes || (!mainImage && crawlImages.length === 0)}
                  title="Phân tích thuộc tính ảnh"
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors border ${isGettingAttributes
                    ? "bg-amber-50 text-amber-400 border-amber-200 cursor-not-allowed"
                    : (!mainImage && crawlImages.length === 0)
                      ? "text-gray-300 border-gray-200 cursor-not-allowed"
                      : "text-amber-600 border-amber-200 hover:bg-amber-50"
                    }`}
                >
                  {isGettingAttributes ? (
                    <RefreshCw size={15} className="animate-spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  <span>Get Attribute Image</span>
                </button>
              </div>

              {/* Settings button */}
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="ml-auto p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                title="Cài đặt API token"
              >
                <Settings size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${msg.role === "user"
                      ? "bg-violet-600 text-white"
                      : "bg-gradient-to-br from-pink-400 to-purple-500 text-white"
                      }`}
                  >
                    {msg.role === "user" ? "U" : <Sparkles size={14} />}
                  </div>

                  {/* Bubble */}
                  <div className={`max-w-[75%] ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-2`}>
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === "user"
                        ? "bg-violet-600 text-white rounded-tr-sm"
                        : "bg-gray-100 text-gray-800 rounded-tl-sm"
                        }`}
                    >
                      <MessageContent msg={msg} onSave={(newText, newConcepts) => handleSaveTable(msg.id, newText, newConcepts)} onLogMessage={(role, text) => {
                        const newId = Date.now();
                        setMessages((prev) => {
                          const updated = [...prev, { id: newId, role, text, images: [] }];
                          saveCurrentSession(updated);
                          return updated;
                        });
                      }} onGenerateNewDesign={(tableMd) => {
                        // Lưu table vào message trước, rồi generate
                        const tableMsg = [...messages].reverse().find((m) => m.text && m.text.includes("|"));
                        const fullTableMd = tableMsg?.text || tableMd;
                        handleGenerateNewDesign(fullTableMd);
                      }} />
                    </div>

                    {/* Generated images (when real logic added) */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {msg.images.map((src, idx) => (
                          <div key={idx} className="relative group w-40 h-40 rounded-xl overflow-hidden border border-gray-200">
                            <img src={src} alt={`gen-${idx}`} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => { const a = document.createElement("a"); a.href = src; a.download = `image-${idx + 1}.jpg`; a.click(); }}
                                className="p-2 bg-white/90 rounded-lg text-gray-700 hover:bg-white"
                              >
                                <Download size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    {msg.role === "user" && (
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt(msg.text)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <Copy size={11} />
                        Copy prompt
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Image attachments preview */}
            {(mainImage || crawlImages.length > 0) && (
              <div className="px-6 pt-3 pb-0 flex flex-wrap gap-3 shrink-0">
                {/* Main image */}
                {mainImage && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-violet-500 px-1">Main Image</span>
                    <div className="relative group w-20 h-20 rounded-xl overflow-hidden border-2 border-violet-300">
                      <img src={mainImage.src} alt="main" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setMainImage(null)}
                        className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <CircleX size={13} />
                      </button>
                    </div>
                  </div>
                )}
                {/* Crawl images */}
                {crawlImages.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-pink-500 px-1">Crawl Images ({crawlImages.length})</span>
                    <div className="flex gap-2 flex-wrap">
                      {crawlImages.map((img, idx) => (
                        <div key={idx} className="relative group w-20 h-20 rounded-xl overflow-hidden border-2 border-pink-200">
                          <img src={img.src} alt={`crawl-${idx}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => removeCrawlImage(idx)}
                            className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <CircleX size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Input area */}
            <div className="px-6 py-4 border-t border-gray-200 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => mainImageRef.current?.click()}
                  title="Upload Main Image (1 ảnh)"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors border ${mainImage ? "bg-violet-50 text-violet-600 border-violet-200" : "text-gray-500 border-gray-200 hover:bg-gray-100"}`}
                >
                  <ImagePlus size={15} />
                  <span>Main Image</span>
                </button>
                <button
                  type="button"
                  onClick={() => crawlImagesRef.current?.click()}
                  title="Upload Crawl Images (nhiều ảnh)"
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors border ${crawlImages.length > 0 ? "bg-pink-50 text-pink-500 border-pink-200" : "text-gray-500 border-gray-200 hover:bg-gray-100"}`}
                >
                  <Images size={15} />
                  <span>Crawl Images{crawlImages.length > 0 ? ` (${crawlImages.length})` : ""}</span>
                </button>
                <input ref={mainImageRef} type="file" accept="image/*" className="hidden" onChange={handleMainImageChange} />
                <input ref={crawlImagesRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCrawlImagesChange} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSettings(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 text-base flex items-center gap-2">
                <Settings size={16} className="text-pink-500" />
                Cài đặt AI Image
              </h3>
              <button type="button" onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                  Gemini API Key
                </label>
                <input
                  type="text"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Lấy tại <span className="text-pink-500">aistudio.google.com/apikey</span> — dùng cho tạo ảnh, phân tích & sinh ý tưởng
                </p>
              </div>

              {configMsg && (
                <p className={`text-sm font-medium ${configMsg.includes("Lỗi") || configMsg.includes("phải") ? "text-red-500" : "text-green-600"}`}>
                  {configMsg}
                </p>
              )}

              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="w-full py-2.5 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
              >
                {savingConfig ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
