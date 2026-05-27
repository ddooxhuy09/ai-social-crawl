import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { FileText, UploadCloud, RefreshCw, Languages, Check, ChevronRight, ChevronLeft, ClipboardPaste } from "lucide-react";
import { API_BASE } from "../../constants";

const LANG_OPTIONS = [
  { key: "en_uk", label: "English (UK)" },
  { key: "fr",    label: "French" },
  { key: "de",    label: "German" },
  { key: "es",    label: "Spanish" },
];

const STEPS = [
  { id: 1, label: "Add Source",    sublabel: "OCR or paste" },
  { id: 2, label: "Edit Source",  sublabel: "Review & edit" },
  { id: 3, label: "Translate",    sublabel: "Select languages" },
  { id: 4, label: "Compare",      sublabel: "Side-by-side view" },
];

// ── Step progress bar ─────────────────────────────────────────────────────────
function StepBar({ current, completed, onStep }) {
  return (
    <div className="flex items-center px-6 pt-5 pb-4 border-b border-gray-100 bg-white shrink-0">
      {STEPS.map((step, idx) => {
        const done    = completed.includes(step.id);
        const active  = current === step.id;
        const reachable = done || active || (step.id === Math.min(...STEPS.map(s => s.id).filter(id => !completed.includes(id))));
        return (
          <React.Fragment key={step.id}>
            {/* Step node */}
            <button
              type="button"
              onClick={() => onStep(step.id)}
              className="flex flex-col items-center gap-1 group shrink-0"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all border-2
                ${done    ? "bg-emerald-500 border-emerald-500 text-white"
                : active  ? "bg-sky-600 border-sky-600 text-white shadow-md shadow-sky-200"
                           : "bg-white border-gray-200 text-gray-400 group-hover:border-gray-300"}`}
              >
                {done ? <Check size={13} strokeWidth={3} /> : step.id}
              </div>
              <div className="text-center">
                <div className={`text-[11px] font-semibold leading-tight ${active ? "text-sky-700" : done ? "text-emerald-600" : "text-gray-400"}`}>
                  {step.label}
                </div>
                <div className="text-[10px] text-gray-400 leading-tight">{step.sublabel}</div>
              </div>
            </button>

            {/* Connector */}
            {idx < STEPS.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 mb-5 rounded-full overflow-hidden bg-gray-100">
                <div className={`h-full transition-all duration-300 ${completed.includes(step.id) ? "bg-emerald-400 w-full" : active ? "bg-sky-300 w-1/2" : "w-0"}`} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function MdView({ content, placeholder = "No content yet." }) {
  return content
    ? <ReactMarkdown rehypePlugins={[rehypeRaw]}>{content}</ReactMarkdown>
    : <span className="text-gray-300 italic text-sm">{placeholder}</span>;
}

// ── Color legend ──────────────────────────────────────────────────────────────
const LEGEND_ITEMS = [
  { color: "#16a34a", label: "Original source text" },
  { color: "#fca5a5", label: "Flagged error" },
  { color: "#fef08a", label: "Review note" },
];

function ColorLegend() {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs shrink-0 flex-wrap">
      <span className="text-gray-400 font-medium">Legend:</span>
      {LEGEND_ITEMS.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
          <span className="text-gray-600">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProjectEditor({ project, onProjectUpdated }) {
  const [step, setStep]             = useState(1);
  const [inputMd, setInputMd]       = useState(project.input_md ?? "");
  const [inputMode, setInputMode]   = useState("edit");
  const [step1Mode, setStep1Mode]   = useState("ocr"); // "ocr" | "paste"
  const [savingInput, setSavingInput] = useState(false);
  const [savedOnce, setSavedOnce]   = useState((project.input_md ?? "").trim().length > 0);
  const [ocrFile, setOcrFile]       = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrMsg, setOcrMsg]         = useState("");
  const [selectedLangs, setSelectedLangs] = useState([]);
  const [bilingual, setBilingual]   = useState(false);
  const [translating, setTranslating] = useState(false);
  const [transMsg, setTransMsg]     = useState(null);
  const [results, setResults]       = useState({});
  const [viewLang, setViewLang]     = useState(null);
  const pollRef                     = useRef(null);
  const fileInputRef                = useRef(null);

  // ── Step completion logic ─────────────────────────────────────────────────
  const ocrDone   = project.ocr_status === "ready";
  const hasInput  = savedOnce && inputMd.trim().length > 0;
  const hasTrans  = Object.keys(results).length > 0;
  const completed = [
    ...(ocrDone || hasInput ? [1] : []),
    ...(hasInput             ? [2] : []),
    ...(hasTrans             ? [3] : []),
  ];

  // Sync project prop
  useEffect(() => {
    const md = project.input_md ?? "";
    setInputMd(md);
    if (md.trim()) setSavedOnce(true);
    setOcrMsg(
      project.ocr_status === "error"  ? `OCR error: ${project.ocr_error}`
      : project.ocr_status === "ready" ? "OCR complete — text extracted below."
      : ""
    );
  }, [project]);

  // Load existing translations
  useEffect(() => {
    const langs = project.available_langs ?? [];
    if (!langs.length) return;
    const next = {};
    Promise.all(
      langs.map((lang) =>
        fetch(`${API_BASE}/api/translate-chart/projects/${project.id}/result/${lang}`)
          .then((r) => (r.ok ? r.text() : null))
          .then((text) => { if (text) next[lang] = text; })
          .catch(() => {})
      )
    ).then(() => {
      setResults(next);
      if (!viewLang && Object.keys(next).length > 0) setViewLang(Object.keys(next)[0]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // OCR polling
  const pollOcr = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/translate-chart/projects/${project.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ocr_status !== "processing") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setOcrLoading(false);
          if (data.ocr_status === "ready") {
            setInputMd(data.input_md ?? "");
            setSavedOnce(true);
            setOcrMsg("OCR complete — text extracted below.");
            onProjectUpdated(data);
          } else {
            setOcrMsg(`OCR error: ${data.ocr_error}`);
            onProjectUpdated(data);
          }
        }
      } catch (_) {}
    }, 3000);
  }, [project.id, onProjectUpdated]);

  useEffect(() => {
    if (project.ocr_status === "processing") { setOcrLoading(true); pollOcr(); }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [project.id, project.ocr_status, pollOcr]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleUploadOcr = async () => {
    if (!ocrFile) return;
    setOcrLoading(true);
    setOcrMsg("Uploading and starting OCR…");
    const form = new FormData();
    form.append("file", ocrFile);
    try {
      const res = await fetch(`${API_BASE}/api/translate-chart/projects/${project.id}/ocr`, {
        method: "POST", body: form,
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail ?? res.statusText); }
      setOcrMsg("OCR running in background… this may take a few minutes.");
      pollOcr();
    } catch (e) { setOcrLoading(false); setOcrMsg(`Error: ${e.message}`); }
  };

  const handleSaveInput = async () => {
    setSavingInput(true);
    try {
      const res = await fetch(`${API_BASE}/api/translate-chart/projects/${project.id}/input`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_md: inputMd }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedOnce(true);
    } catch (e) { alert(e.message); }
    finally { setSavingInput(false); }
  };

  const toggleLang = (lang) =>
    setSelectedLangs((prev) => prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]);

  const handleTranslate = async () => {
    if (!selectedLangs.length) return;
    setTranslating(true); setTransMsg(null);
    try {
      const res  = await fetch(`${API_BASE}/api/translate-chart/projects/${project.id}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ langs: selectedLangs, bilingual }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err  = data?.detail ?? res.statusText;
        const errs = typeof err === "object" ? err.errors : null;
        setTransMsg({ type: "error", text: errs ? Object.entries(errs).map(([l, e]) => `${l}: ${e}`).join(" | ") : String(err) });
        if (typeof data?.detail?.translated === "object") await loadResults(data.detail.translated);
      } else {
        setTransMsg({ type: "ok", text: `Translated: ${data.translated.join(", ")}` });
        await loadResults(data.translated);
        onProjectUpdated({ ...project, available_langs: [...new Set([...(project.available_langs ?? []), ...data.translated])] });
      }
    } catch (e) { setTransMsg({ type: "error", text: e.message }); }
    finally { setTranslating(false); }
  };

  const loadResults = async (langs) => {
    const next = { ...results };
    await Promise.all(
      langs.map((lang) =>
        fetch(`${API_BASE}/api/translate-chart/projects/${project.id}/result/${lang}`)
          .then((r) => (r.ok ? r.text() : null))
          .then((text) => { if (text) next[lang] = text; })
          .catch(() => {})
      )
    );
    setResults(next);
    if (!viewLang && langs.length > 0) setViewLang(langs[0]);
  };

  const availableLangs = Object.keys(results);
  const canNext = step < 4 && (
    (step === 1 && (ocrDone || hasInput)) ||
    (step === 2 && hasInput) ||
    (step === 3 && hasTrans)
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Progress bar */}
      <StepBar current={step} completed={completed} onStep={setStep} />

      {/* Step content */}
      <div className="flex-1 overflow-auto p-6">
        {/* ── Step 1: Upload PDF / Paste Text ── */}
        {step === 1 && (
          <div className="max-w-xl mx-auto flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Add Source Text</h2>
              <p className="text-xs text-gray-500 mt-0.5">Upload a PDF for OCR extraction, or paste the text directly.</p>
            </div>

            {/* Tab toggle */}
            <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium bg-gray-50">
              <button
                type="button"
                onClick={() => setStep1Mode("ocr")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 transition-colors
                  ${step1Mode === "ocr" ? "bg-white text-sky-700 shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"}`}
              >
                <UploadCloud size={13} /> Upload PDF (OCR)
              </button>
              <button
                type="button"
                onClick={() => setStep1Mode("paste")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 transition-colors
                  ${step1Mode === "paste" ? "bg-white text-indigo-700 shadow-sm font-semibold" : "text-gray-500 hover:text-gray-700"}`}
              >
                <ClipboardPaste size={13} /> Paste Text
              </button>
            </div>

            {/* OCR panel */}
            {step1Mode === "ocr" && (
              <>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl px-6 py-10 flex flex-col items-center gap-3 cursor-pointer hover:border-sky-300 hover:bg-sky-50/30 transition-colors"
                >
                  <UploadCloud size={32} className={ocrFile ? "text-sky-500" : "text-gray-300"} />
                  <div className="text-sm text-center">
                    {ocrFile
                      ? <span className="font-medium text-sky-700">{ocrFile.name}</span>
                      : <><span className="font-medium text-gray-600">Click to select</span> <span className="text-gray-400">or drag a PDF here</span></>
                    }
                  </div>
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                    onChange={(e) => { setOcrFile(e.target.files?.[0] ?? null); setOcrMsg(""); }} />
                </div>

                <button
                  onClick={handleUploadOcr}
                  disabled={!ocrFile || ocrLoading}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:opacity-40 transition-colors"
                >
                  {ocrLoading ? <><RefreshCw size={14} className="animate-spin" /> Processing…</> : <><FileText size={14} /> Run OCR</>}
                </button>

                {ocrMsg && (
                  <div className={`text-xs px-4 py-3 rounded-xl border flex items-start gap-2
                    ${ocrMsg.startsWith("OCR error") ? "bg-red-50 border-red-200 text-red-600" : "bg-sky-50 border-sky-200 text-sky-700"}`}>
                    {ocrLoading && <RefreshCw size={11} className="animate-spin mt-0.5 shrink-0" />}
                    {ocrMsg}
                  </div>
                )}
              </>
            )}

            {/* Paste panel */}
            {step1Mode === "paste" && (
              <>
                <textarea
                  className="w-full h-56 text-xs font-mono border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="Paste your crochet pattern text here…"
                  value={inputMd}
                  onChange={(e) => setInputMd(e.target.value)}
                />
                <button
                  onClick={handleSaveInput}
                  disabled={savingInput || !inputMd.trim()}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  {savingInput ? <><RefreshCw size={14} className="animate-spin" /> Saving…</> : <><ClipboardPaste size={14} /> Save Text</>}
                </button>
              </>
            )}

            {(ocrDone || hasInput) && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-xl">
                <Check size={13} strokeWidth={3} className="shrink-0" />
                Text is ready. You can proceed to the next step.
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Edit Source ── */}
        {step === 2 && (
          <div className="flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold text-gray-800">Edit Source Text</h2>
                <p className="text-xs text-gray-500 mt-0.5">Review and correct the extracted English (US) text before translating.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                  {["edit", "preview"].map((m) => (
                    <button key={m} type="button" onClick={() => setInputMode(m)}
                      className={`px-3 py-1.5 capitalize transition-colors ${inputMode === m ? "bg-gray-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <button onClick={handleSaveInput} disabled={savingInput}
                  className="px-4 py-1.5 bg-gray-800 text-white rounded-lg text-xs font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors">
                  {savingInput ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {inputMode === "edit" ? (
                <textarea
                  className="w-full h-full text-xs font-mono border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-1 focus:ring-sky-400"
                  placeholder="Paste or edit your crochet pattern text here…"
                  value={inputMd}
                  onChange={(e) => setInputMd(e.target.value)}
                />
              ) : (
                <div className="h-full overflow-auto border border-gray-200 rounded-xl p-5 prose prose-sm max-w-none text-gray-800 text-[13px] leading-relaxed">
                  <MdView content={inputMd} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Translate ── */}
        {step === 3 && (
          <div className="max-w-xl mx-auto flex flex-col gap-5">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Translate</h2>
              <p className="text-xs text-gray-500 mt-0.5">Select one or more target languages. Crochet abbreviations will be mapped exactly from the terminology table.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {LANG_OPTIONS.map(({ key, label }) => {
                const done = (project.available_langs ?? []).includes(key);
                const selected = selectedLangs.includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleLang(key)}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all
                      ${selected ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}>
                    <span>{label}</span>
                    <div className="flex items-center gap-1.5">
                      {done && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">done</span>}
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all
                        ${selected ? "bg-indigo-500 border-indigo-500" : "border-gray-300"}`}>
                        {selected && <Check size={10} strokeWidth={3} className="text-white" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bilingual toggle */}
            <button
              type="button"
              onClick={() => setBilingual((v) => !v)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl border-2 text-sm transition-all text-left
                ${bilingual ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
            >
              <div className={`w-9 h-5 rounded-full flex items-center transition-colors shrink-0 ${bilingual ? "bg-violet-500" : "bg-gray-200"}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${bilingual ? "translate-x-4" : "translate-x-0"}`} />
              </div>
              <div>
                <div className={`font-semibold leading-tight ${bilingual ? "text-violet-700" : "text-gray-600"}`}>
                  Bilingual output
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Each original line followed by its translation in italics
                </div>
              </div>
            </button>

            {!hasInput && (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl">
                Please save your source text in Step 2 before translating.
              </div>
            )}

            <button
              onClick={handleTranslate}
              disabled={translating || !selectedLangs.length || !hasInput}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {translating ? <><RefreshCw size={14} className="animate-spin" /> Translating…</> : <><Languages size={14} /> Translate Selected</>}
            </button>

            {transMsg && (
              <div className={`text-xs px-4 py-3 rounded-xl border
                ${transMsg.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>
                {transMsg.text}
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Compare ── */}
        {step === 4 && (
          <div className="flex flex-col gap-3 h-full">
            <div className="shrink-0">
              <h2 className="text-base font-semibold text-gray-800">Side-by-Side Comparison</h2>
              <p className="text-xs text-gray-500 mt-0.5">Compare the original source with each translation.</p>
            </div>

            {availableLangs.length > 0 && (
              <div className="flex gap-1 flex-wrap shrink-0">
                {availableLangs.map((lang) => {
                  const opt = LANG_OPTIONS.find((o) => o.key === lang);
                  return (
                    <button key={lang} onClick={() => setViewLang(lang)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors
                        ${viewLang === lang ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                      {opt?.label ?? lang}
                    </button>
                  );
                })}
              </div>
            )}

            <ColorLegend />

            <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
              {[
                { content: inputMd, title: "Original — English (US)" },
                {
                  content: viewLang ? results[viewLang] : null,
                  title: viewLang ? `Translation — ${LANG_OPTIONS.find((o) => o.key === viewLang)?.label ?? viewLang}` : "Translation",
                },
              ].map(({ content, title }) => (
                <div key={title} className="border border-gray-200 rounded-xl overflow-hidden flex flex-col">
                  <div className="text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-200 shrink-0">{title}</div>
                  <div className="flex-1 overflow-auto p-4 prose prose-sm max-w-none text-gray-800 text-[13px] leading-relaxed">
                    {content
                      ? <MdView content={content} />
                      : <span className="text-gray-300 italic text-sm">
                          {availableLangs.length === 0 ? "No translations yet. Go to Step 3." : "Select a language above."}
                        </span>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom navigation */}
      <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white shrink-0">
        <button
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 1}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={15} /> Back
        </button>

        <span className="text-xs text-gray-400">Step {step} of {STEPS.length}</span>

        <button
          onClick={() => setStep((s) => s + 1)}
          disabled={step === 4 || !canNext}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-30 transition-colors"
        >
          Next <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
