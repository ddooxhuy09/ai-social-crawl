import React, { useEffect, useState } from "react";
import { Save, Plus, Trash2 } from "lucide-react";
import { API_BASE } from "../../constants";
import { Button } from "../../components/ui/button";

const LANG_COLS = [
  { key: "en_us", label: "EN / US" },
  { key: "en_uk", label: "EN / UK" },
  { key: "fr",    label: "French" },
  { key: "de",    label: "German" },
  { key: "es",    label: "Spanish" },
];

function LangCell({ data, onChange }) {
  const abbr = data?.abbr ?? [];

  const updateAbbr = (i, val) => {
    const next = abbr.map((a, idx) => (idx === i ? val : a));
    onChange({ ...data, abbr: next });
  };

  const removeAbbr = (i) => {
    onChange({ ...data, abbr: abbr.filter((_, idx) => idx !== i) });
  };

  const addAbbr = () => {
    onChange({ ...data, abbr: [...abbr, ""] });
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Full name */}
      <input
        className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-sky-400"
        placeholder="full name"
        value={data?.full ?? ""}
        onChange={(e) => onChange({ ...data, full: e.target.value })}
      />
      {/* Abbreviations */}
      {abbr.map((a, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-1.5 py-1 font-mono focus:outline-none focus:ring-1 focus:ring-sky-400"
            placeholder="abbr"
            value={a}
            onChange={(e) => updateAbbr(i, e.target.value)}
          />
          <button
            type="button"
            onClick={() => removeAbbr(i)}
            className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addAbbr}
        className="flex items-center gap-0.5 text-[10px] text-sky-600 hover:text-sky-700 font-medium mt-0.5 w-fit"
      >
        <Plus size={10} /> abbr
      </button>
    </div>
  );
}

export default function TerminologyEditor() {
  const [terms, setTerms] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newKey, setNewKey] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/translate-chart/terminology`)
      .then((r) => r.json())
      .then((data) => setTerms(data))
      .catch(() => setMsg({ type: "error", text: "Failed to load terminology." }))
      .finally(() => setLoading(false));
  }, []);

  const updateLang = (termKey, langKey, value) => {
    setTerms((prev) => ({
      ...prev,
      [termKey]: { ...prev[termKey], [langKey]: value },
    }));
  };

  const addTerm = () => {
    const k = newKey.trim().toLowerCase();
    if (!k) return;
    if (terms[k]) { setMsg({ type: "error", text: `Key "${k}" already exists.` }); return; }
    const blank = {};
    LANG_COLS.forEach(({ key }) => { blank[key] = { full: "", abbr: [] }; });
    setTerms((prev) => ({ ...prev, [k]: blank }));
    setNewKey("");
  };

  const deleteTerm = (key) => {
    setTerms((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/translate-chart/terminology`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(terms),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg({ type: "ok", text: "Saved successfully." });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading terminology…</div>;

  return (
    <div className="flex flex-col gap-4 p-6 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Terminology Table</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Crochet abbreviation mapping used during translation. Abbreviations are applied exactly and never translated by the AI.
          </p>
        </div>
        <Button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
          <Save size={14} /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {msg && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${msg.type === "ok" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-600"}`}>
          {msg.text}
        </div>
      )}

      {/* Add new row */}
      <div className="flex items-center gap-2">
        <input
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-400 w-40 font-mono"
          placeholder="new key (e.g. mr)"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTerm()}
        />
        <button onClick={addTerm} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 font-medium transition-colors">
          <Plus size={13} /> Add Term
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {LANG_COLS.map(({ key, label }) => (
                <th key={key} className="px-3 py-2.5 text-left font-semibold text-gray-600">{label}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {Object.entries(terms).map(([termKey, langMap]) => (
              <tr key={termKey} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                {LANG_COLS.map(({ key }) => (
                  <td key={key} className="px-3 py-2 align-top min-w-[140px]">
                    <LangCell
                      data={langMap[key] ?? { full: "", abbr: [] }}
                      onChange={(val) => updateLang(termKey, key, val)}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 align-top">
                  <button onClick={() => deleteTerm(termKey)} className="text-gray-300 hover:text-red-500 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
