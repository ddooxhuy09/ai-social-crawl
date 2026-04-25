/**
 * Shared components for the AI attribute table workflow.
 * Used by ChatCreateImagePage and RedesignPhase.
 *
 * Exports:
 *   EditableTable  – interactive attribute table with dropdowns, AI suggestions, concepts
 *   MessageContent – renders EditableTable for JSON row messages
 */
import { useState } from "react";
import { ChevronDown, Sparkles, Lightbulb } from "lucide-react";

// ── EditableTable ─────────────────────────────────────────────────────────────

export function EditableTable({ initialJsonRows = [], imageNames = [], onSave, onGenerateNewDesign, onGenerateIdea }) {
  const _normalizeSourceName = (name, i) => {
    const n = name.toLowerCase().trim();
    if (n === "main" || n.includes("main image") || n.includes("gốc")) return "Main";
    if (/^ref\d+$/.test(n)) return name;
    if (n.includes("crawl 1") || n.includes("tham khảo 1")) return "Crawl 1";
    if (n.includes("crawl 2") || n.includes("tham khảo 2")) return "Crawl 2";
    if (n.includes("crawl 3") || n.includes("tham khảo 3")) return "Crawl 3";
    if (n.includes("crawl")) return `Crawl ${i}`;
    return name || `Nguồn ${i + 1}`;
  };

  const [rows, setRows] = useState(() =>
    initialJsonRows.map(r => {
      const sourceValues = imageNames.map(name => r.values?.[name] || "");
      const options = sourceValues.map((val, i) => {
        if (val && val.trim() !== "" && val.trim() !== "-") {
          const sName = _normalizeSourceName(imageNames[i] || "", i);
          return { label: `${val.trim()} (${sName})`, value: `${val.trim()} (${sName})` };
        }
        return null;
      }).filter(Boolean);
      const viValues = imageNames.map(name => r.vi_values?.[name] || "");
      return { id: Math.random().toString(36).substring(7), isCustom: false, key: r.attribute || "", vi: r.vi || "", sourceValues, viValues, selectedValue: options.length > 0 ? options[0].value : "", options, customMode: false };
    })
  );

  const [saved, setSaved] = useState(false);
  const [customInputValues, setCustomInputValues] = useState({});

  const addCustomRow = () => setRows(prev => [...prev, { id: Math.random().toString(36).substring(7), isCustom: true, key: "", vi: "", sourceValues: imageNames.map(() => ""), viValues: imageNames.map(() => ""), selectedValue: "", options: [], customMode: true }]);
  const updateRow = (id, field, value) => setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

  const buildRowsPayload = (extraRows) => {
    const src = extraRows || rows;
    return src.map(r => {
      let finalValue = r.selectedValue;
      if (!finalValue && r.options?.length > 0) finalValue = r.options[0].value;
      return { attribute: r.key, vi: r.vi || "", isCustom: r.isCustom || false, sourceValues: r.sourceValues, viValues: r.viValues || [], selectedValue: finalValue || "" };
    });
  };

  const handleSave = () => {
    onSave({ rows: buildRowsPayload(), image_names: imageNames });
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

  const cellCls = "border border-gray-200 px-3 py-2";

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm mt-2 mb-2">
      <table className="w-full text-sm border-collapse text-left min-w-[600px]">
        <thead>
          <tr className="bg-violet-50 text-violet-800 font-semibold border-b border-gray-200">
            <th className={`${cellCls} min-w-[150px]`}>Thuộc tính (Attribute)</th>
            {imageNames.map((h, i) => (
              <th key={i} className={`${cellCls} min-w-[160px] text-center text-gray-600 font-medium bg-gray-50`}>{h}</th>
            ))}
            <th className={`${cellCls} min-w-[280px] bg-violet-100/50`}>🛠️ THIẾT KẾ MỚI</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((row, ri) => (
            <tr key={row.id} className={`group/row transition-colors hover:bg-gray-50 ${ri % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
              <td className={cellCls}>
                <div className="flex items-start gap-1">
                  <textarea value={row.key} placeholder="Tên thuộc tính..." onChange={(e) => updateRow(row.id, "key", e.target.value)}
                    onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                    ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                    className={`flex-1 px-2 py-1.5 bg-transparent border-transparent hover:border-violet-200 focus:bg-white focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded text-sm transition-colors resize-none overflow-hidden ${!row.isCustom ? 'font-medium text-gray-700' : ''}`}
                    rows={1} />
                  {row.vi && (
                    <div className="relative group/vi flex-shrink-0 mt-1.5">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold bg-violet-100 text-violet-500 cursor-default select-none border border-violet-200 hover:bg-violet-200 transition-colors">
                        VN
                      </span>
                      <div className="absolute left-0 top-full mt-1 z-50 hidden group-hover/vi:block w-max max-w-[200px] px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-xs leading-snug shadow-lg pointer-events-none">
                        {row.vi}
                        <div className="absolute -top-1 left-2 w-2 h-2 bg-gray-800 rotate-45" />
                      </div>
                    </div>
                  )}
                </div>
              </td>
              {row.sourceValues.map((val, i) => (
                <td key={i} className={cellCls}>
                  <div className="flex items-start gap-1">
                    <textarea value={val} placeholder={row.isCustom ? "Tùy chỉnh..." : "-"}
                      onChange={(e) => {
                        const newSourceValues = [...row.sourceValues]; newSourceValues[i] = e.target.value;
                        let newOptions = newSourceValues.map((v, idx) => {
                          if (v && v.trim() !== "" && v.trim() !== "-") {
                            const sourceName = _normalizeSourceName(imageNames[idx] || "", idx);
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
                      className={`flex-1 px-2 py-1.5 bg-transparent border-transparent hover:border-violet-200 focus:bg-white focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 rounded text-sm text-center text-gray-700 transition-colors resize-none overflow-hidden ${row.isCustom && (!val || val === "Tùy chỉnh") ? 'italic text-gray-400 text-xs' : ''}`}
                      onInput={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
                      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                      rows={1} />
                    {row.viValues?.[i] && (
                      <div className="relative group/viv flex-shrink-0 mt-1.5">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold bg-blue-100 text-blue-500 cursor-default select-none border border-blue-200 hover:bg-blue-200 transition-colors">
                          VN
                        </span>
                        <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover/viv:block w-max max-w-[220px] px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-xs leading-snug shadow-lg pointer-events-none">
                          {row.viValues[i]}
                          <div className="absolute -top-1 right-2 w-2 h-2 bg-gray-800 rotate-45" />
                        </div>
                      </div>
                    )}
                  </div>
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
                </div>
              </td>
            </tr>
          ))}
          <tr className="bg-gray-50 border-t border-gray-200">
            <td colSpan={imageNames.length + 3} className="px-3 py-3">
              <div className="flex items-center justify-between">
                <button type="button" onClick={addCustomRow}
                  className="flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors border border-dashed border-violet-300">
                  <span className="text-lg leading-none">+</span> Thêm thuộc tính mới
                </button>
                <div className="flex items-center gap-2">
                  {onGenerateIdea && (
                    <button type="button" onClick={() => onGenerateIdea({ rows: buildRowsPayload(), image_names: imageNames })} disabled={rows.length === 0}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:from-amber-500 hover:to-orange-600 shadow-orange-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                      <Lightbulb size={14} /> Generate Idea
                    </button>
                  )}
                  <button type="button" onClick={() => onGenerateNewDesign?.({ rows: buildRowsPayload(), image_names: imageNames })} disabled={rows.length === 0}
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

    </div>
  );
}

// ── MessageContent ────────────────────────────────────────────────────────────

export function MessageContent({ msg, onSave, onGenerateNewDesign, onGenerateIdea }) {
  if (!msg.rows || !Array.isArray(msg.rows)) return null;
  return (
    <EditableTable
      initialJsonRows={msg.rows}
      imageNames={msg.image_names || []}
      onSave={(savedData) => onSave?.(savedData)}
      onGenerateNewDesign={onGenerateNewDesign}
      onGenerateIdea={onGenerateIdea}
    />
  );
}
