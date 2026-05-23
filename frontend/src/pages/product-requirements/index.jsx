import React, { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";

// ── Toast ─────────────────────────────────────────────────────────────────────
function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id}
          className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium text-white animate-fadeIn ${
            t.type === "error" ? "bg-red-500" : "bg-gray-900"
          }`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────
function Section({ title, subtitle, accent = "sky", locked, children }) {
  const border = { sky: "border-sky-100", indigo: "border-indigo-100", emerald: "border-emerald-100" }[accent];
  const dot    = { sky: "bg-sky-500", indigo: "bg-indigo-500", emerald: "bg-emerald-500" }[accent];
  return (
    <section className={`bg-white rounded-2xl border ${border} shadow-sm overflow-hidden relative`}>
      {locked && (
        <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex items-center justify-center z-10 rounded-2xl">
          <p className="text-sm text-gray-400 font-medium">Complete previous steps first</p>
        </div>
      )}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 bg-gray-50 focus:bg-white transition-colors resize-none";

function extractTableFromMessages(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i].text || "";
    if (!text.includes("| Thuộc tính (Attribute)")) continue;
    const lines = text.split("\n");
    const start = lines.findIndex(l => l.trim().startsWith("|") && l.includes("Thuộc tính"));
    if (start === -1) continue;
    let end = start;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return lines.slice(start, end).join("\n");
  }
  return "";
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RequirementsPage() {
  const [allDocs, setAllDocs]               = useState([]);
  const [selectedDoc, setSelectedDoc]       = useState("");   // doc_name
  const [newDocName, setNewDocName]         = useState("");
  const [creating, setCreating]             = useState(false);

  // Doc fields
  const [productName, setProductName]               = useState("");
  const [purpose, setPurpose]                       = useState("");
  const [generalRequirements, setGeneralRequirements] = useState("");
  const [attributeSource, setAttributeSource]       = useState("manual");  // "manual" | "chat"
  const [attributeTable, setAttributeTable]         = useState("");
  const [chatSessionId, setChatSessionId]           = useState("");
  const [result, setResult]                         = useState("");

  // Chat sessions for attribute source
  const [chatSessions, setChatSessions] = useState([]);

  // UI state
  const [saving, setSaving]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toasts, setToasts]       = useState([]);

  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 2500);
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  };

  // Load doc list + chat sessions on mount
  useEffect(() => {
    refreshDocs();
    fetch(`${API_BASE}/api/chat-ai/history`)
      .then(r => r.json())
      .then(d => setChatSessions(Array.isArray(d) ? d : []))
      .catch(console.error);
  }, []);

  const refreshDocs = () => {
    fetch(`${API_BASE}/api/requirements/all`)
      .then(r => r.json())
      .then(d => setAllDocs(Array.isArray(d) ? d : []))
      .catch(console.error);
  };

  // Load doc when selected
  useEffect(() => {
    if (!selectedDoc) { resetFields(); return; }
    fetch(`${API_BASE}/api/requirements/${encodeURIComponent(selectedDoc)}`)
      .then(r => r.json())
      .then(applyDoc)
      .catch(() => resetFields());
  }, [selectedDoc]);

  // When chat session changes + source is "chat", extract table
  useEffect(() => {
    if (attributeSource !== "chat" || !chatSessionId) return;
    fetch(`${API_BASE}/api/chat-ai/history/${chatSessionId}`)
      .then(r => r.json())
      .then(d => {
        if (d?.messages) setAttributeTable(extractTableFromMessages(d.messages));
      })
      .catch(console.error);
  }, [chatSessionId, attributeSource]);

  const resetFields = () => {
    setProductName(""); setPurpose(""); setGeneralRequirements("");
    setAttributeSource("manual"); setAttributeTable(""); setChatSessionId(""); setResult("");
  };

  const applyDoc = (doc) => {
    setProductName(doc.product_name || "");
    setPurpose(doc.purpose || "");
    setGeneralRequirements(doc.general_requirements || "");
    setAttributeSource(doc.attribute_source || "manual");
    setAttributeTable(doc.attribute_table || "");
    setChatSessionId(doc.chat_session_id || "");
    setResult(doc.result || "");
  };

  const handleCreateDoc = async () => {
    const name = newDocName.trim();
    if (!name) { showToast("Enter a document name first.", "error"); return; }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/requirements/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_name: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error creating document");
      setNewDocName("");
      refreshDocs();
      setSelectedDoc(name);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDoc = async (docName) => {
    if (!window.confirm(`Delete document "${docName}"?`)) return;
    try {
      await fetch(`${API_BASE}/api/requirements/${encodeURIComponent(docName)}`, { method: "DELETE" });
      refreshDocs();
      if (selectedDoc === docName) { setSelectedDoc(""); resetFields(); }
    } catch (e) {
      showToast("Error deleting document", "error");
    }
  };

  const handleSave = async () => {
    if (!selectedDoc) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/requirements/${encodeURIComponent(selectedDoc)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_name: selectedDoc, product_name: productName, purpose,
          general_requirements: generalRequirements,
          attribute_table: attributeTable, attribute_source: attributeSource,
          chat_session_id: chatSessionId, result,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Save failed");
      refreshDocs();
      showToast("Saved");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!attributeTable.trim()) { showToast("Add an attribute table first.", "error"); return; }
    if (!productName.trim())    { showToast("Enter the product name first.", "error"); return; }
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/requirements/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_name: selectedDoc, product_name: productName, purpose,
          general_requirements: generalRequirements, attribute_table: attributeTable,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Generation failed");
      setResult(data.result);
      refreshDocs();
      showToast("Requirements generated and saved");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = !!attributeTable.trim() && !!productName.trim();

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden bg-gray-50">
      <ToastContainer toasts={toasts} />

      {/* ── Left sidebar ── */}
      <aside className="w-full md:w-[272px] flex-none border-r border-gray-200 bg-white flex flex-col overflow-hidden md:max-w-[272px] max-h-[200px] md:max-h-none border-b md:border-b-0">
        <div className="px-5 py-4 border-b border-gray-100 shrink-0">
          <p className="text-sm font-semibold text-gray-900">Product Requirements</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Create or select a document</p>
        </div>

        {/* Create new */}
        <div className="px-4 py-4 border-b border-gray-100 shrink-0 flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">New Document</p>
          <input
            type="text"
            placeholder="e.g. Bear Lovey"
            className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={newDocName}
            onChange={e => setNewDocName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreateDoc()}
          />
          <Button variant="sky" size="sm" disabled={!newDocName.trim() || creating} onClick={handleCreateDoc} className="w-full text-xs">
            {creating ? "Creating..." : "Create Document"}
          </Button>
        </div>

        {/* Doc list */}
        <div className="flex-1 overflow-y-auto">
          {allDocs.length === 0 ? (
            <div className="flex items-center justify-center h-24 px-4">
              <p className="text-xs text-gray-400 text-center">No documents yet.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-gray-50">
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">
                Documents ({allDocs.length})
              </p>
              {allDocs.map((doc) => {
                const isActive = selectedDoc === doc.doc_name;
                return (
                  <button key={doc.doc_name}
                    onClick={() => setSelectedDoc(doc.doc_name)}
                    className={`w-full text-left px-4 py-3 transition-colors group ${
                      isActive ? "bg-sky-50 border-l-2 border-sky-500" : "hover:bg-gray-50 border-l-2 border-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className={`text-xs font-semibold truncate ${isActive ? "text-sky-700" : "text-gray-800"}`}>
                        {doc.doc_name}
                      </p>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteDoc(doc.doc_name); }}
                        className="text-gray-200 hover:text-red-400 cursor-pointer text-sm shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >×</button>
                    </div>
                    {doc.product_name && (
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{doc.product_name}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className={`w-2 h-2 rounded-full ${doc.has_result ? "bg-emerald-400" : "bg-gray-200"}`} />
                      <span className="text-[10px] text-gray-400">{doc.has_result ? "Generated" : "Draft"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        {!selectedDoc ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-base font-semibold text-gray-400">No document selected</p>
              <p className="text-sm text-gray-400 mt-1">Create a new document or select one from the sidebar.</p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 flex flex-col gap-5">

            {/* Page title + save */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{selectedDoc}</h1>
                <p className="text-sm text-gray-400 mt-0.5">Fill in the details below, then generate the requirements document.</p>
              </div>
              <Button variant="outline" size="sm" disabled={saving} onClick={handleSave} className="shrink-0 mt-1">
                {saving ? "Saving..." : "💾 Save"}
              </Button>
            </div>

            {/* ── Section 1: Product Info ── */}
            <Section title="Product Information" subtitle="Name, purpose, and extra requirements" accent="sky">
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Product name <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Bear Lovey"
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Intended use</label>
                  <textarea
                    placeholder="e.g. Blanket for baby, keeping warm, toy..."
                    value={purpose}
                    onChange={e => setPurpose(e.target.value)}
                    rows={2}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Additional requirements</label>
                  <p className="text-[11px] text-gray-400 mb-2">Describe specific constraints, assembly notes, or special instructions not in the attribute table.</p>
                  <textarea
                    placeholder={
                      "e.g.\n- Phần tay gấu may dính lại với nhau.\n- Sản phẩm blanket là sản phẩm trơn.\n- Khi có gấu và blanket thì có thể luồn blanket qua giữa hai tay gấu..."
                    }
                    value={generalRequirements}
                    onChange={e => setGeneralRequirements(e.target.value)}
                    rows={5}
                    className={inputCls}
                  />
                </div>
              </div>
            </Section>

            {/* ── Section 2: Attribute Table ── */}
            <Section title="Attribute Table" subtitle="Paste a markdown table or extract from a Chat session" accent="indigo">
              {/* Source toggle */}
              <div className="flex gap-2 mb-4">
                {["manual", "chat"].map(src => (
                  <button key={src}
                    onClick={() => setAttributeSource(src)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      attributeSource === src
                        ? "bg-indigo-500 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {src === "manual" ? "✏️ Manual input" : "💬 From Chat session"}
                  </button>
                ))}
              </div>

              {/* Chat session picker */}
              {attributeSource === "chat" && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Chat session</label>
                  <select
                    value={chatSessionId}
                    onChange={e => setChatSessionId(e.target.value)}
                    className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">-- Select a chat session --</option>
                    {chatSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.title} ({s.message_count} messages)</option>
                    ))}
                  </select>
                  {attributeSource === "chat" && chatSessionId && !attributeTable && (
                    <p className="text-[11px] text-amber-600 mt-1.5">No attribute table found in this session. You can paste one manually below.</p>
                  )}
                  {attributeSource === "chat" && chatSessionId && attributeTable && (
                    <p className="text-[11px] text-emerald-600 mt-1.5">✓ Table extracted — you can edit it below.</p>
                  )}
                </div>
              )}

              {/* Always-editable table textarea */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Markdown table {attributeSource === "chat" && chatSessionId && "(auto-extracted, editable)"}
                </label>
                <textarea
                  value={attributeTable}
                  onChange={e => setAttributeTable(e.target.value)}
                  rows={8}
                  placeholder={"| Thuộc tính (Attribute) | Giá trị (Value) |\n|---|---|\n| Chất liệu len | Len nhung đũa |\n| Kích thước | 30x30cm |"}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50 focus:bg-white transition-colors resize-none"
                />
              </div>
            </Section>

            {/* ── Section 3: Generate & Result ── */}
            <Section title="Generate Requirements" subtitle="AI will combine all inputs into a complete document" accent="emerald" locked={!productName.trim() && !attributeTable.trim()}>
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Button
                    disabled={!canGenerate || generating}
                    onClick={handleGenerate}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 shadow-sm"
                  >
                    {generating ? "⏳ Generating..." : "✨ Generate with AI"}
                  </Button>
                  {result && (
                    <span className="text-[11px] text-emerald-600 font-medium">✓ Result ready · auto-saved</span>
                  )}
                </div>

                {result ? (
                  <div className="relative group">
                    <button
                      onClick={() => copyText(result)}
                      className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:text-emerald-600 shadow-sm"
                    >
                      📋 Copy
                    </button>
                    <textarea
                      value={result}
                      onChange={e => setResult(e.target.value)}
                      rows={20}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 leading-relaxed font-mono bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none transition-colors"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2 border border-dashed border-gray-200 rounded-xl">
                    <span className="text-4xl opacity-30">📄</span>
                    <p className="text-sm">
                      {!productName.trim() || !attributeTable.trim()
                        ? "Fill in product name and attribute table first."
                        : "Click Generate to create the requirements document."}
                    </p>
                  </div>
                )}
              </div>
            </Section>

          </div>
        )}
      </main>
    </div>
  );
}
