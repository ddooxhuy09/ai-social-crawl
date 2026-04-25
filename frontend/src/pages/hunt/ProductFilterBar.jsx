import React, { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

const PRODUCT_PRICE_PRESETS = [
  { label: "Unlimited", min: null, max: null },
  { label: "0.01~10", min: 0.01, max: 10 },
  { label: "10.01~30", min: 10.01, max: 30 },
  { label: "30.01~200", min: 30.01, max: 200 },
  { label: "≥200", min: 200, max: null },
];
const PRODUCT_NUM_PRESETS = [
  { label: "All", min: null, max: null },
  { label: "0~10", min: 0, max: 10 },
  { label: "11~30", min: 11, max: 30 },
  { label: "31~200", min: 31, max: 200 },
  { label: ">200", min: 201, max: null },
];
const PRODUCT_FILTER_GROUPS = [
  { key: "price", label: "Price (USD)", subs: [{ field: "price", label: "Price (USD)", presets: PRODUCT_PRICE_PRESETS }] },
  { key: "sales", label: "Sales", subs: [
    { field: "monthly_sales", label: "7-Day Sales:", presets: PRODUCT_NUM_PRESETS },
    { field: "sales_total", label: "Total Sales:", presets: PRODUCT_NUM_PRESETS },
  ]},
  { key: "favorites", label: "Favorites", subs: [
    { field: "favorites_weekly", label: "7-Day Favorites:", presets: PRODUCT_NUM_PRESETS },
    { field: "favorites", label: "Total Favorites:", presets: PRODUCT_NUM_PRESETS },
  ]},
  { key: "reviews", label: "Reviews", subs: [
    { field: "reviews_weekly", label: "7-Day Reviews:", presets: PRODUCT_NUM_PRESETS },
    { field: "reviews", label: "Total Reviews:", presets: PRODUCT_NUM_PRESETS },
  ]},
];
const PRODUCT_FIELD_DISPLAY = {
  price: "Price", monthly_sales: "7D Sales", sales_total: "Total Sales",
  favorites_weekly: "7D Fav", favorites: "Favorites",
  reviews_weekly: "7D Rev", reviews: "Reviews",
};
const RELEASE_TIME_OPTS = [
  { label: "30 Days", value: "30" },
  { label: "180 Days", value: "180" },
  { label: "1 Year", value: "365" },
  { label: "All Time", value: "" },
];
const PRODUCT_TYPE_OPTS = [
  { label: "Physical", value: "Physical" },
  { label: "Digital", value: "Digital" },
];

export default function ProductFilterBar({
  filters, setFilters,
  releaseTime, setReleaseTime,
  country, setCountry,
  labels, setLabels,
  productTypes, setProductTypes,
  availableCountries,
}) {
  const [openKey, setOpenKey] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [countrySearch, setCountrySearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpenKey(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleGroup = (key) => {
    if (openKey === key) { setOpenKey(null); return; }
    const group = PRODUCT_FILTER_GROUPS.find((g) => g.key === key);
    const init = {};
    group?.subs.forEach((sub) => {
      const cur = filters[sub.field];
      init[sub.field] = { minStr: cur?.[0] != null ? String(cur[0]) : "", maxStr: cur?.[1] != null ? String(cur[1]) : "" };
    });
    setDrafts((prev) => ({ ...prev, ...init }));
    setOpenKey(key);
  };

  const setDraftField = (field, side, val) =>
    setDrafts((prev) => ({ ...prev, [field]: { ...(prev[field] || {}), [side]: val } }));

  const applyPreset = (field, preset) =>
    setDrafts((prev) => ({
      ...prev,
      [field]: {
        minStr: preset.min != null ? String(preset.min) : "",
        maxStr: preset.max != null ? String(preset.max) : "",
      },
    }));

  const isPresetActive = (field, preset) => {
    const d = drafts[field] || {};
    return (
      (preset.min == null ? d.minStr === "" : d.minStr === String(preset.min)) &&
      (preset.max == null ? d.maxStr === "" : d.maxStr === String(preset.max))
    );
  };

  const applyGroup = (key) => {
    const group = PRODUCT_FILTER_GROUPS.find((g) => g.key === key);
    const next = { ...filters };
    group?.subs.forEach((sub) => {
      const d = drafts[sub.field] || {};
      const minV = d.minStr !== "" ? parseFloat(d.minStr) : null;
      const maxV = d.maxStr !== "" ? parseFloat(d.maxStr) : null;
      if (minV != null || maxV != null) next[sub.field] = [minV, maxV];
      else delete next[sub.field];
    });
    setFilters(next);
    setOpenKey(null);
  };

  const resetGroup = (key) => {
    const group = PRODUCT_FILTER_GROUPS.find((g) => g.key === key);
    const next = { ...filters };
    const newDrafts = {};
    group?.subs.forEach((sub) => { delete next[sub.field]; newDrafts[sub.field] = { minStr: "", maxStr: "" }; });
    setFilters(next);
    setDrafts((prev) => ({ ...prev, ...newDrafts }));
  };

  const groupActiveCount = (key) =>
    PRODUCT_FILTER_GROUPS.find((g) => g.key === key)?.subs.filter((s) => filters[s.field]).length || 0;

  const toggleLabel = (lbl) =>
    setLabels((prev) => prev.includes(lbl) ? prev.filter((l) => l !== lbl) : [...prev, lbl]);

  const toggleProductType = (t) =>
    setProductTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const fmtV = (v) => {
    if (v == null) return "";
    if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  };
  const fmtRange = (min, max) =>
    min == null ? `<${fmtV(max)}` : max == null ? `≥${fmtV(min)}` : `${fmtV(min)}~${fmtV(max)}`;

  const chipEntries = [
    ...Object.entries(filters).map(([field, [min, max]]) => ({
      key: field,
      label: `${PRODUCT_FIELD_DISPLAY[field] || field}: ${fmtRange(min, max)}`,
      remove: () => { const n = { ...filters }; delete n[field]; setFilters(n); },
    })),
    ...(country ? [{ key: "_country", label: `Country: ${country}`, remove: () => setCountry("") }] : []),
    ...labels.map((l) => ({ key: `_lbl_${l}`, label: l, remove: () => toggleLabel(l) })),
    ...productTypes.map((t) => ({ key: `_pt_${t}`, label: `Type: ${t}`, remove: () => toggleProductType(t) })),
    ...(releaseTime ? [{ key: "_rt", label: `Listed ≤${releaseTime}d`, remove: () => setReleaseTime("") }] : []),
  ];
  const hasAny = chipEntries.length > 0;
  const filteredCountries = countrySearch
    ? availableCountries.filter((c) => c.toLowerCase().includes(countrySearch.toLowerCase()))
    : availableCountries;

  const renderGroupBtn = (group) => {
    const cnt = groupActiveCount(group.key);
    const isOpen = openKey === group.key;
    return (
      <div key={group.key} className="relative">
        <Button
          variant={cnt > 0 ? "outline-sky" : "outline"}
          type="button"
          onClick={() => toggleGroup(group.key)}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 h-auto rounded transition-colors cursor-pointer ${cnt > 0 ? "border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800" : isOpen ? "border-gray-400 bg-gray-50 text-gray-800" : ""}`}
        >
          {group.label}
          {cnt > 0 && <span className="text-[0.58rem] bg-sky-500 text-white rounded-full px-1 leading-tight">{cnt}</span>}
          <span className={`text-[0.55rem] transition-transform inline-block ${isOpen ? "rotate-180" : ""}`}>▾</span>
        </Button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3" style={{ minWidth: 280 }}>
            <p className="text-xs font-semibold text-gray-800 mb-1">{group.label}</p>
            <hr className="mb-2 border-gray-200" />
            {group.subs.map((sub, si) => (
              <div key={sub.field} className={si > 0 ? "mt-3" : ""}>
                <p className="text-[0.68rem] text-gray-400 mb-1">{sub.label}</p>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {sub.presets.map((preset) => (
                    <Button
                      variant={isPresetActive(sub.field, preset) ? "sky" : "outline"}
                      key={preset.label} type="button"
                      onClick={() => applyPreset(sub.field, preset)}
                      className={`text-[0.68rem] px-2 py-0.5 h-auto rounded border transition-colors`}
                    >{preset.label}</Button>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <Input type="number" placeholder="Min" value={drafts[sub.field]?.minStr ?? ""}
                    onChange={(e) => setDraftField(sub.field, "minStr", e.target.value)}
                    className="w-20 px-2 py-0.5 h-auto text-[0.68rem] rounded focus:outline-none focus:border-sky-400" />
                  <span className="text-gray-400 text-xs">~</span>
                  <Input type="number" placeholder="Max" value={drafts[sub.field]?.maxStr ?? ""}
                    onChange={(e) => setDraftField(sub.field, "maxStr", e.target.value)}
                    className="w-20 px-2 py-0.5 h-auto text-[0.68rem] rounded focus:outline-none focus:border-sky-400" />
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2 mt-2 border-t border-gray-100">
              <Button variant="ghost" type="button" onClick={() => resetGroup(group.key)} className="text-[0.68rem] text-gray-500 hover:text-gray-700 px-2 h-auto">Reset</Button>
              <Button variant="outline" type="button" onClick={() => setOpenKey(null)} className="text-[0.68rem] px-2.5 py-0.5 rounded h-auto">Cancel</Button>
              <Button variant="sky" type="button" onClick={() => applyGroup(group.key)} className="text-[0.68rem] px-2.5 py-0.5 rounded h-auto">OK</Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="bg-white border border-gray-200 rounded-lg mb-3 text-xs">
      {hasAny && (
        <div className="px-3 py-1.5 flex flex-wrap gap-1 items-center border-b border-gray-100">
          <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0">Selected:</span>
          {chipEntries.map((chip) => (
            <span key={chip.key} className="inline-flex items-center gap-0.5 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5 text-[0.65rem] text-sky-700">
              {chip.label}
              <span onClick={chip.remove} className="cursor-pointer hover:text-sky-900 ml-0.5 font-bold">×</span>
            </span>
          ))}
          <Button
            variant="ghost"
            type="button"
            onClick={() => { setFilters({}); setReleaseTime(""); setCountry(""); setLabels([]); setProductTypes([]); }}
            className="ml-auto text-[0.65rem] text-gray-400 hover:text-red-500 px-1 h-auto p-0"
          >Reset All</Button>
        </div>
      )}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-100 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[3rem]">Basic :</span>
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[0])}
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[1])}
      </div>
      <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-100 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[4.5rem]">Advanced :</span>
        {/* Country */}
        <div className="relative">
          <Button
            variant={country ? "outline-sky" : "outline"}
            type="button"
            onClick={() => setOpenKey(openKey === "_country" ? null : "_country")}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded h-auto transition-colors cursor-pointer ${country ? "border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800" : openKey === "_country" ? "border-gray-400 bg-gray-50 text-gray-800" : ""}`}
          >
            {country || "Country"}
            <span className={`text-[0.55rem] transition-transform inline-block ${openKey === "_country" ? "rotate-180" : ""}`}>▾</span>
          </Button>
          {openKey === "_country" && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden" style={{ minWidth: 190 }}>
              <div className="p-2 border-b border-gray-100">
                <Input type="text" placeholder="Search..." value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  className="w-full px-2 py-1 h-auto text-xs rounded focus:outline-none focus:border-sky-400" />
              </div>
              <div className="max-h-44 overflow-y-auto">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => { setCountry(""); setOpenKey(null); setCountrySearch(""); }}
                  className={`w-full text-left text-xs px-3 py-1.5 h-auto transition-colors rounded-none justify-start ${!country ? "bg-sky-50 text-sky-700 font-semibold hover:bg-sky-100" : "text-gray-700"}`}
                >All Countries</Button>
                {filteredCountries.map((c) => (
                  <Button variant="ghost" key={c} type="button"
                    onClick={() => { setCountry(c); setOpenKey(null); setCountrySearch(""); }}
                    className={`w-full text-left text-xs px-3 py-1.5 h-auto transition-colors rounded-none justify-start ${country === c ? "bg-sky-50 text-sky-700 font-semibold hover:bg-sky-100" : "text-gray-700"}`}
                  >{c}</Button>
                ))}
              </div>
            </div>
          )}
        </div>
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[2])}
        {renderGroupBtn(PRODUCT_FILTER_GROUPS[3])}
        {/* Product Type */}
        <div className="relative">
          <Button
            variant={productTypes.length > 0 ? "outline-sky" : "outline"}
            type="button"
            onClick={() => setOpenKey(openKey === "_type" ? null : "_type")}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded h-auto transition-colors cursor-pointer ${productTypes.length > 0 ? "border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:text-sky-800" : openKey === "_type" ? "border-gray-400 bg-gray-50 text-gray-800" : ""}`}
          >
            Product Type
            {productTypes.length > 0 && <span className="text-[0.58rem] bg-sky-500 text-white rounded-full px-1 leading-tight">{productTypes.length}</span>}
            <span className={`text-[0.55rem] transition-transform inline-block ${openKey === "_type" ? "rotate-180" : ""}`}>▾</span>
          </Button>
          {openKey === "_type" && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1" style={{ minWidth: 140 }}>
              {PRODUCT_TYPE_OPTS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={productTypes.includes(opt.value)}
                    onChange={() => toggleProductType(opt.value)} className="accent-sky-500" />
                  <span className="text-xs text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="px-3 py-2 flex items-center gap-3 border-b border-gray-100 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[3rem]">Labels :</span>
        {["Etsy Pick", "BestSeller"].map((lbl) => (
          <label key={lbl} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700 select-none">
            <input type="checkbox" checked={labels.includes(lbl)} onChange={() => toggleLabel(lbl)} className="accent-sky-500" />
            {lbl}
          </label>
        ))}
      </div>
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-[0.65rem] font-semibold text-gray-400 shrink-0 min-w-[5.5rem]">Release Time :</span>
        {RELEASE_TIME_OPTS.map((opt) => (
          <label
            key={opt.value}
            className={`cursor-pointer px-2.5 py-1 rounded border text-xs transition-colors select-none ${
              releaseTime === opt.value ? "bg-sky-500 text-white border-sky-500" : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <input type="radio" name="pf_releaseTime" value={opt.value} checked={releaseTime === opt.value}
              onChange={() => setReleaseTime(opt.value)} className="sr-only" />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}
