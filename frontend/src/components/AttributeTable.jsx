/**
 * Shared components for the AI attribute table workflow.
 * Used by ChatCreateImagePage and RedesignPhase.
 *
 * Exports:
 *   EditableTable  – interactive attribute table with dropdowns, AI suggestions, concepts
 *   InlineText     – renders markdown bold + whitespace
 *   MessageContent – parses a markdown string, renders EditableTable if it contains a table
 */
import { useState } from "react";
import { ChevronDown, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { API_BASE } from "../constants";

// ── EditableTable ─────────────────────────────────────────────────────────────

export function EditableTable({ initialHeaders, initialRows, initialConcepts = [], onSave, onLogMessage, onUpdateConcepts, onGenerateNewDesign }) {
  const isSavedTable = initialHeaders[initialHeaders.length - 1] === "🛠️ THIẾT KẾ MỚI (Dropdown)";
  const isAiTable = initialHeaders[initialHeaders.length - 1] === "🛠️ THIẾT KẾ MỚI";
  const hasDesignColumn = isSavedTable || isAiTable;

  const sourceHeaders = hasDesignColumn
    ? initialHeaders.slice(1, initialHeaders.length - 1)
    : initialHeaders.slice(1);

  const _normalizeSourceName = (name, i) => {
    const n = name.toLowerCase().trim();
    if (n === "main" || n.includes("main image") || n.includes("gốc")) return "Main";
    if (/^ref\d+$/.test(n)) return name; // Ref1, Ref2, … — keep as-is
    if (n.includes("crawl 1") || n.includes("tham khảo 1")) return "Crawl 1";
    if (n.includes("crawl 2") || n.includes("tham khảo 2")) return "Crawl 2";
    if (n.includes("crawl 3") || n.includes("tham khảo 3")) return "Crawl 3";
    if (n.includes("crawl")) return `Crawl ${i}`;
    return name || `Nguồn ${i + 1}`;
  };

  const [rows, setRows] = useState(() => {
    if (isSavedTable) {
      return initialRows.map(r => {
        const isCustom = r[0]?.includes("(Tự nhập)");
        const sourceValues = r.slice(1, r.length - 1);
        const selectedValue = r[r.length - 1] || "";
        let options = sourceValues.map((val, i) => {
          if (val && val.trim() !== "" && val.trim() !== "-" && val.trim() !== "Tùy chỉnh" && val.trim() !== "(Tùy chỉnh)") {
            const sourceName = _normalizeSourceName(sourceHeaders[i] || "", i);
            return { label: `${val.trim()} (${sourceName})`, value: `${val.trim()} (${sourceName})` };
          }
          return null;
        }).filter(Boolean);
        let finalSelectedValue = selectedValue;
        if (!finalSelectedValue && options.length > 0) finalSelectedValue = options[0].value;
        return { id: Math.random().toString(36).substring(7), isCustom, key: r[0]?.replace("(Tự nhập)", "").trim() || "", sourceValues, selectedValue: finalSelectedValue, options, customMode: false, suggestions: [], loadingSuggestions: false };
      });
    } else if (isAiTable) {
      return initialRows.map(r => {
        const sourceValues = r.slice(1, r.length - 1);
        const aiSuggestedValue = (r[r.length - 1] || "").trim();
        const options = sourceValues.map((val, i) => {
          if (val && val.trim() !== "" && val.trim() !== "-") {
            const sourceName = _normalizeSourceName(sourceHeaders[i] || "", i);
            return { label: `${val.trim()} (${sourceName})`, value: `${val.trim()} (${sourceName})` };
          }
          return null;
        }).filter(Boolean);
        const selectedValue = (aiSuggestedValue && aiSuggestedValue !== "-")
          ? aiSuggestedValue
          : (options.length > 0 ? options[0].value : "");
        return { id: Math.random().toString(36).substring(7), isCustom: false, key: r[0] || "", sourceValues, selectedValue, options, customMode: false, suggestions: [], loadingSuggestions: false };
      });
    } else {
      return initialRows.map(r => {
        const sourceValues = r.slice(1);
        const options = sourceValues.map((val, i) => {
          if (val && val.trim() !== "" && val.trim() !== "-") {
            const sourceName = _normalizeSourceName(sourceHeaders[i] || "", i);
            return { label: `${val.trim()} (${sourceName})`, value: `${val.trim()} (${sourceName})` };
          }
          return null;
        }).filter(Boolean);
        return { id: Math.random().toString(36).substring(7), isCustom: false, key: r[0] || "", sourceValues, selectedValue: options.length > 0 ? options[0].value : "", options, customMode: false, suggestions: [], loadingSuggestions: false };
      });
    }
  });

  const [saved, setSaved] = useState(false);
  const [concepts, setConcepts] = useState(initialConcepts);
  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [customInputValues, setCustomInputValues] = useState({});

  const addCustomRow = () => setRows(prev => [...prev, { id: Math.random().toString(36).substring(7), isCustom: true, key: "", sourceValues: sourceHeaders.map(() => ""), selectedValue: "", options: [], customMode: true, suggestions: [], loadingSuggestions: false }]);
  const removeRow = (id) => setRows(prev => prev.filter(r => r.id !== id));
  const updateRow = (id, field, value) => setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

  const buildTableMd = () => {
    const mdHeaders = ["Thuộc tính (Attribute)", ...sourceHeaders, "🛠️ THIẾT KẾ MỚI"];
    const sep = mdHeaders.map(() => "---");
    return ["| " + mdHeaders.join(" | ") + " |", "| " + sep.join(" | ") + " |", ...rows.map(r => `| ${r.isCustom ? `${r.key} (Tự nhập)` : r.key} | ${r.sourceValues.join(" | ")} | ${r.selectedValue || " "} |`)].join("\n");
  };

  const handleSuggestAttribute = async (rowId) => {
    const row = rows.find(r => r.id === rowId);
    if (!row || row.loadingSuggestions) return;
    updateRow(rowId, "loadingSuggestions", true);
    updateRow(rowId, "suggestions", []);
    try {
      const r = await fetch(`${API_BASE}/api/generate-image/suggest-attribute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute_name: row.key, current_values: row.sourceValues.filter(v => v && v.trim() !== "" && v.trim() !== "-"), full_table: buildTableMd() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Lỗi gợi ý");
      setRows(prev => prev.map(ro => ro.id === rowId ? { ...ro, suggestions: data.suggestions || [], loadingSuggestions: false } : ro));
    } catch (err) {
      console.error("Suggest attribute error:", err);
      setRows(prev => prev.map(ro => ro.id === rowId ? { ...ro, suggestions: [], loadingSuggestions: false } : ro));
    }
  };

  const handleSuggestConcepts = async () => {
    if (loadingConcepts) return;
    setLoadingConcepts(true);
    try {
      const r = await fetch(`${API_BASE}/api/generate-image/suggest-concepts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attribute_table: buildTableMd() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Lỗi sinh concept");
      const normalizedConcepts = (data.concepts || []).map(c => {
        let changes = c.changes || {};
        if (Array.isArray(changes)) { const dict = {}; for (const item of changes) { if (item.attribute && item.value) dict[item.attribute] = item.value; } changes = dict; }
        return { ...c, changes };
      });
      setConcepts(prev => { const newList = [...prev, ...normalizedConcepts]; if (onUpdateConcepts) onUpdateConcepts(newList); return newList; });
    } catch (err) { console.error("Suggest concepts error:", err); }
    finally { setLoadingConcepts(false); }
  };

  const applyConcept = (concept) => {
    let changesDict = {};
    if (concept.changes && typeof concept.changes === "object" && !Array.isArray(concept.changes)) changesDict = concept.changes;
    else if (Array.isArray(concept.changes)) { for (const item of concept.changes) { if (item.attribute && item.value) changesDict[item.attribute] = item.value; } }
    if (Object.keys(changesDict).length === 0) return;
    setRows(prev => {
      let updated = [...prev];
      for (const [key, value] of Object.entries(changesDict)) {
        const conceptValue = `${value} (Idea AI Concept)`;
        const existingIdx = updated.findIndex(r => r.key.toLowerCase().trim() === key.toLowerCase().trim());
        if (existingIdx !== -1) updated[existingIdx] = { ...updated[existingIdx], selectedValue: conceptValue };
        else updated.push({ id: Math.random().toString(36).substring(7), isCustom: true, key, sourceValues: sourceHeaders.map(() => ""), selectedValue: conceptValue, options: [], customMode: false, suggestions: [], loadingSuggestions: false });
      }
      return updated;
    });
  };

  const handleSave = () => {
    if (rows.length === 0) { onSave(""); setSaved(true); setTimeout(() => setSaved(false), 2000); return; }
    const mdHeaders = ["Thuộc tính (Attribute)", ...sourceHeaders, "🛠️ THIẾT KẾ MỚI (Dropdown)"];
    const sep = mdHeaders.map(() => "---");
    const mdLines = ["| " + mdHeaders.join(" | ") + " |", "| " + sep.join(" | ") + " |", ...rows.map(r => {
      const keyDisplay = r.isCustom ? `${r.key} (Tự nhập)` : r.key;
      let finalValue = r.selectedValue;
      if (!finalValue && r.options && r.options.length > 0) finalValue = r.options[0].value;
      return `| ${keyDisplay || " "} | ${r.sourceValues.join(" | ")} | ${finalValue || " "} |`;
    })];
    onSave(mdLines.join("\n"));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDropdownChange = (rowId, value) => {
    if (value === "__custom__") { setRows(prev => prev.map(r => r.id === rowId ? { ...r, customMode: true } : r)); setCustomInputValues(prev => ({ ...prev, [rowId]: "" })); }
    else updateRow(rowId, "selectedValue", value);
  };

  const confirmCustomInput = (rowId) => {
    const val = (customInputValues[rowId] || "").trim();
    if (val) setRows(prev => prev.map(r => r.id === rowId ? { ...r, selectedValue: val, customMode: false } : r));
    setCustomInputValues(prev => ({ ...prev, [rowId]: undefined }));
  };

  const cancelCustomInput = (rowId) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, customMode: false } : r));
    setCustomInputValues(prev => ({ ...prev, [rowId]: undefined }));
  };

  const applySuggestion = (rowId, suggestion) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, selectedValue: `${suggestion} (AI Suggestion)`, suggestions: [], customMode: false } : r));
  };

  const cellCls = "border border-gray-200 px-3 py-2";

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm mt-2 mb-2">
      <table className="w-full text-sm border-collapse text-left min-w-[600px]">
        <thead>
          <tr className="bg-violet-50 text-violet-800 font-semibold border-b border-gray-200">
            <th className={`${cellCls} min-w-[150px]`}>Thuộc tính (Attribute)</th>
            {sourceHeaders.map((h, i) => (
              <th key={i} className={`${cellCls} min-w-[160px] text-center text-gray-600 font-medium bg-gray-50`}>{h}</th>
            ))}
            <th className={`${cellCls} min-w-[280px] bg-violet-100/50`}>🛠️ THIẾT KẾ MỚI</th>
            <th className={`${cellCls} min-w-[40px] text-center bg-violet-100/50`}>AI</th>
            <th className={`${cellCls} w-[50px] text-center`}></th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((row, ri) => (
            <tr key={row.id} className={`group/row transition-colors hover:bg-gray-50 ${ri % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
              <td className={cellCls}>
                <textarea value={row.key} placeholder="Tên thuộc tính..." onChange={(e) => updateRow(row.id, "key", e.target.value)}
                  onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                  ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                  className={`w-full px-2 py-1.5 bg-transparent border-transparent hover:border-violet-200 focus:bg-white focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded text-sm transition-colors resize-none overflow-hidden ${!row.isCustom ? 'font-medium text-gray-700' : ''}`}
                  rows={1} />
              </td>
              {row.sourceValues.map((val, i) => (
                <td key={i} className={cellCls}>
                  <textarea value={val} placeholder={row.isCustom ? "Tùy chỉnh..." : "-"}
                    onChange={(e) => {
                      const newSourceValues = [...row.sourceValues]; newSourceValues[i] = e.target.value;
                      let newOptions = newSourceValues.map((v, idx) => {
                        if (v && v.trim() !== "" && v.trim() !== "-") {
                          const sourceName = _normalizeSourceName(sourceHeaders[idx] || "", idx);
                          return { label: `${v.trim()} (${sourceName})`, value: `${v.trim()} (${sourceName})` };
                        }
                        return null;
                      }).filter(Boolean);
                      setRows(prev => prev.map(r => {
                        if (r.id !== row.id) return r;
                        let newSelectedValue = r.selectedValue;
                        if (!newSelectedValue && newOptions.length > 0) newSelectedValue = newOptions[0].value;
                        return { ...r, sourceValues: newSourceValues, options: newOptions, selectedValue: newSelectedValue };
                      }));
                    }}
                    className={`w-full px-2 py-1.5 bg-transparent border-transparent hover:border-violet-200 focus:bg-white focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded text-sm text-center text-gray-700 transition-colors resize-none overflow-hidden ${row.isCustom && (!val || val === "Tùy chỉnh") ? 'italic text-gray-400 text-xs' : ''}`}
                    onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                    ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                    rows={1} />
                </td>
              ))}
              <td className={`${cellCls} bg-violet-50/30`}>
                <div className="flex flex-col gap-1.5">
                  {row.customMode ? (
                    <div className="flex items-center gap-1">
                      <input autoFocus value={customInputValues[row.id] || ""}
                        onChange={(e) => setCustomInputValues(prev => ({ ...prev, [row.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmCustomInput(row.id); if (e.key === "Escape") cancelCustomInput(row.id); }}
                        placeholder="Nhập giá trị tùy chỉnh..."
                        className="flex-1 px-2 py-1.5 bg-white border border-violet-300 rounded text-sm text-violet-700 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500" />
                      <button type="button" onClick={() => confirmCustomInput(row.id)} className="w-7 h-7 rounded flex items-center justify-center bg-violet-500 text-white hover:bg-violet-600 transition-colors text-xs font-bold">✓</button>
                      <button type="button" onClick={() => cancelCustomInput(row.id)} className="w-7 h-7 rounded flex items-center justify-center bg-gray-200 text-gray-500 hover:bg-gray-300 transition-colors text-xs font-bold">✕</button>
                    </div>
                  ) : (
                    <div className="relative">
                      <select value={row.selectedValue} onChange={(e) => handleDropdownChange(row.id, e.target.value)}
                        className="w-full appearance-none px-3 py-1.5 pr-8 bg-white border border-violet-200 rounded text-sm font-medium text-violet-700 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 cursor-pointer shadow-sm hover:bg-violet-50 transition-colors">
                        {row.options.length === 0 ? (
                          <option value={row.selectedValue || ""}>{row.selectedValue || (row.isCustom ? "Chưa có giá trị..." : "Chọn giá trị")}</option>
                        ) : (
                          <>
                            <option value="">-- Chọn giá trị --</option>
                            {row.selectedValue && !row.options.some(o => o.value === row.selectedValue) && <option value={row.selectedValue}>{row.selectedValue}</option>}
                            {row.options.map((opt, idx) => <option key={idx} value={opt.value}>Chọn: {opt.label}</option>)}
                          </>
                        )}
                        <option value="__custom__">✍️ Nhập tùy chỉnh...</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-violet-500"><ChevronDown size={14} /></div>
                    </div>
                  )}
                  {row.suggestions && row.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 animate-fadeIn">
                      {row.suggestions.map((s, idx) => (
                        <button key={idx} type="button" onClick={() => applySuggestion(row.id, s)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-violet-100 to-pink-100 text-violet-700 border border-violet-200 hover:from-violet-200 hover:to-pink-200 hover:border-violet-300 hover:shadow-sm transition-all cursor-pointer">
                          <Sparkles size={10} className="text-pink-400" />{s}
                        </button>
                      ))}
                      <button type="button" onClick={() => updateRow(row.id, "suggestions", [])}
                        className="inline-flex items-center px-1.5 py-1 rounded-full text-xs text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors" title="Đóng gợi ý">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </td>
              <td className={`${cellCls} text-center bg-violet-50/30`}>
                <button type="button" onClick={() => handleSuggestAttribute(row.id)} disabled={row.loadingSuggestions || !row.key}
                  title="✨ AI Gợi ý giá trị cho thuộc tính này"
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all ${row.loadingSuggestions ? "bg-violet-100 text-violet-400 cursor-not-allowed" : !row.key ? "text-gray-300 cursor-not-allowed" : "text-violet-500 hover:bg-violet-100 hover:text-violet-700 hover:shadow-sm"}`}>
                  {row.loadingSuggestions ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                </button>
              </td>
              <td className={`${cellCls} text-center`}>
                {row.isCustom ? (
                  <button type="button" onClick={() => removeRow(row.id)} title="Xóa thuộc tính"
                    className="inline-flex items-center justify-center w-7 h-7 rounded text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          <tr className="bg-gray-50 border-t border-gray-200">
            <td colSpan={sourceHeaders.length + 4} className="px-3 py-3">
              <div className="flex items-center justify-between">
                <button type="button" onClick={addCustomRow}
                  className="flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors border border-dashed border-violet-300">
                  <span className="text-lg leading-none">+</span> Thêm thuộc tính mới
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onGenerateNewDesign?.(buildTableMd())} disabled={rows.length === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm bg-gradient-to-r from-pink-500 to-violet-500 text-white hover:from-pink-600 hover:to-violet-600 shadow-pink-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                    <Sparkles size={14} /> Generate New Design
                  </button>
                  <button type="button" onClick={handleSave}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm ${saved ? "bg-green-100 text-green-700 border border-green-200" : "bg-violet-600 text-white hover:bg-violet-700 shadow-violet-200 hover:shadow-md"}`}>
                    {saved ? "✓ Đã chốt cấu hình" : "Lưu bảng thuộc tính"}
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* AI Creative Concepts */}
      <div className="border-t border-gray-200 bg-gradient-to-r from-violet-50/60 to-pink-50/60 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <h4 className="text-sm font-semibold text-violet-700 flex items-center gap-1.5">
            <Sparkles size={14} className="text-pink-500" /> AI Creative Concepts
          </h4>
          <span className="text-xs text-gray-400">(Batch Apply)</span>
          <button type="button" onClick={handleSuggestConcepts} disabled={loadingConcepts || rows.length === 0}
            className={`ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm ${loadingConcepts ? "bg-violet-100 text-violet-400 border border-violet-200 cursor-not-allowed" : "bg-gradient-to-r from-violet-500 to-pink-500 text-white hover:from-violet-600 hover:to-pink-600 hover:shadow-md"}`}>
            {loadingConcepts ? <><RefreshCw size={14} className="animate-spin" /> Generating...</> : <><Sparkles size={14} /> 🎨 Generate Ideas</>}
          </button>
        </div>
        {concepts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {concepts.map((concept, idx) => (
              <button key={idx} type="button" onClick={() => applyConcept(concept)}
                className="text-left p-3 rounded-xl border border-violet-200 bg-white hover:border-violet-400 hover:shadow-md transition-all group cursor-pointer">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">{idx === 0 ? "🎄" : idx === 1 ? "🌸" : "🎨"}</span>
                  <span className="text-sm font-semibold text-violet-700 group-hover:text-violet-800">{concept.name}</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">{concept.description}</p>
                {concept.changes && (
                  <div className="flex flex-col gap-1">
                    {Object.entries(concept.changes).map(([k, v], ci) => (
                      <span key={ci} className="inline-block px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-600 border border-violet-100">
                        <strong>{k}:</strong> {v}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        {concepts.length === 0 && !loadingConcepts && (
          <p className="text-xs text-gray-400 text-center py-2">👆 Click "Generate Ideas" to get AI design concepts</p>
        )}
      </div>
    </div>
  );
}

// ── InlineText ────────────────────────────────────────────────────────────────

export function InlineText({ text }) {
  return (
    <span className="whitespace-pre-wrap">
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : part
      )}
    </span>
  );
}

// ── MessageContent ────────────────────────────────────────────────────────────

export function MessageContent({ msg, onSave, onLogMessage, onGenerateNewDesign }) {
  const text = msg.text;
  if (!text) return null;

  const lines = text.split("\n");
  const tableStart = lines.findIndex((l) => l.trim().startsWith("|") && l.trim().endsWith("|"));
  if (tableStart !== -1) {
    const before = lines.slice(0, tableStart).join("\n").trim();
    let tableEnd = tableStart;
    while (tableEnd < lines.length && lines[tableEnd].trim().startsWith("|")) tableEnd++;
    const tableLines = lines.slice(tableStart, tableEnd);
    const after = lines.slice(tableEnd).join("\n").trim();

    const parseRow = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
    const headers = parseRow(tableLines[0]);
    const dataRows = tableLines.slice(2).filter((l) => !l.match(/^[\s|:\-]+$/)).map(parseRow);

    const handleTableSave = (newTableMd) => {
      const newText = [before, newTableMd, after].filter(Boolean).join("\n");
      onSave?.(newText, msg.concepts);
    };

    const handleGenerateFromTable = (tableMd) => onGenerateNewDesign?.(tableMd ?? tableLines.join("\n"));

    return (
      <div className="flex flex-col gap-2 w-full">
        {before && <InlineText text={before} />}
        <EditableTable
          initialHeaders={headers}
          initialRows={dataRows}
          initialConcepts={msg.concepts || []}
          onSave={handleTableSave}
          onLogMessage={onLogMessage}
          onUpdateConcepts={(newConcepts) => onSave?.(text, newConcepts)}
          onGenerateNewDesign={handleGenerateFromTable}
        />
        {after && <InlineText text={after} />}
      </div>
    );
  }

  return <InlineText text={text} />;
}
