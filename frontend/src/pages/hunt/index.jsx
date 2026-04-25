import React, { useState } from "react";
import KeywordTab from "./KeywordTab";
import ProductTab from "./ProductTab";
import { Button } from "../../components/ui/button";

export default function HuntPage() {
  const [huntTab, setHuntTab] = useState("keyword");

  return (
    <div className="p-4">
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {[{ key: "keyword", label: "🔑 Keyword DB" }, { key: "product", label: "🛍 Product DB" }].map((tab) => (
          <Button
            variant="ghost"
            key={tab.key} type="button"
            onClick={() => setHuntTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 rounded-none transition-colors cursor-pointer ${
              huntTab === tab.key
                ? "border-sky-500 text-sky-600 bg-sky-50"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >{tab.label}</Button>
        ))}
      </div>

      {huntTab === "keyword" && <KeywordTab />}
      {huntTab === "product" && <ProductTab />}
    </div>
  );
}
