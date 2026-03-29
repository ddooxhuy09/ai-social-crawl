// Khi build production (chạy từ exe hoặc serve cùng backend): gọi API cùng origin. Dev: localhost:8000
export const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.PROD
    ? ""
    : "http://localhost:8000";

export const SORT_OPTIONS = [
  { value: "default", label: "Mặc định", sources: null },
  { value: "title_asc", label: "Tên A → Z", sources: null },
  { value: "title_desc", label: "Tên Z → A", sources: null },
  { value: "views_desc", label: "Lượt xem nhiều nhất", sources: ["tiktok", "youtube"] },
  { value: "views_asc", label: "Lượt xem ít nhất", sources: ["tiktok", "youtube"] },
  { value: "likes_desc", label: "Like nhiều nhất", sources: null },
  { value: "likes_asc", label: "Like ít nhất", sources: null },
  { value: "reactions_desc", label: "Reaction nhiều nhất", sources: ["pinterest"] },
  { value: "reactions_asc", label: "Reaction ít nhất", sources: ["pinterest"] },
  { value: "saves_desc", label: "Save nhiều nhất", sources: ["pinterest", "tiktok"] },
  { value: "shares_desc", label: "Chia sẻ nhiều nhất", sources: ["tiktok"] },
  { value: "repins_desc", label: "Repin nhiều nhất", sources: ["pinterest"] },
  { value: "comments_desc", label: "Bình luận nhiều nhất", sources: null },
  { value: "similarity_desc", label: "Độ giống cao → thấp", sources: null },
  { value: "similarity_asc", label: "Độ giống thấp → cao", sources: null },
  { value: "confidence_desc", label: "Độ khớp cao → thấp", sources: null },
  { value: "confidence_asc", label: "Độ khớp thấp → cao", sources: null },
];

export const HUNT_FILTERS = [
  {
    group: "competition", label: "Competition", rows: [
      {
        key: "competition", label: "Competition", presets: [
          [null, 10000, "< 10K"], [10000, 20000, "10K~20K"], [20000, 50000, "20K~50K"],
          [50000, 100000, "50K~100K"], [100000, null, "≥ 100K"],
        ]
      },
    ]
  },
  {
    group: "views", label: "Views", rows: [
      {
        key: "views", label: "Total Views", presets: [
          [0, 20e6, "0~20M"], [20e6, 50e6, "20M~50M"], [50e6, 100e6, "50M~100M"],
        ]
      },
      {
        key: "views_monthly", label: "Monthly Views", presets: [
          [0, 10e6, "0~10M"], [10e6, 30e6, "10M~30M"], [30e6, 100e6, "30M~100M"],
        ]
      },
    ]
  },
  {
    group: "favorites", label: "Favorites", rows: [
      {
        key: "favorites", label: "Total Favorites", presets: [
          [0, 100e3, "0~100K"], [100e3, 1e6, "100K~1M"], [1e6, 10e6, "1M~10M"],
        ]
      },
      {
        key: "favorites_monthly", label: "Monthly Favorites", presets: [
          [0, 30e3, "0~30K"], [30e3, 500e3, "30K~500K"], [500e3, 1e6, "500K~1M"],
        ]
      },
    ]
  },
  {
    group: "sales", label: "Sales", rows: [
      {
        key: "sales", label: "Total Sales", presets: [
          [0, 10e3, "0~10K"], [10e3, 500e3, "10K~500K"], [500e3, 1e6, "500K~1M"],
        ]
      },
      {
        key: "sales_monthly", label: "Monthly Sales", presets: [
          [0, 10e3, "0~10K"], [10e3, 250e3, "10K~250K"], [250e3, 1e6, "250K~1M"],
        ]
      },
    ]
  },
  {
    group: "reviews", label: "Reviews", rows: [
      {
        key: "reviews", label: "Total Reviews", presets: [
          [0, 50e3, "0~50K"], [50e3, 100e3, "50K~100K"], [100e3, 1e6, "100K~1M"],
        ]
      },
      {
        key: "reviews_monthly", label: "Monthly Reviews", presets: [
          [0, 200, "0~200"], [200, 2e3, "200~2K"], [2e3, 7e3, "2K~7K"],
        ]
      },
    ]
  },
];

export const CLASSIFY_FILTERS = [
  {
    group: "score", label: "Score", rows: [
      {
        key: "score", label: "Score", presets: [
          [null, 30, "< 30"], [30, 50, "30~50"], [50, 70, "50~70"], [70, null, "≥ 70"],
        ]
      },
    ]
  },
  {
    group: "favorites", label: "Favorites", rows: [
      {
        key: "favorites", label: "Favorites", presets: [
          [0, 100e3, "0~100K"], [100e3, 1e6, "100K~1M"], [1e6, 10e6, "1M~10M"],
        ]
      },
    ]
  },
  {
    group: "competition", label: "Competition", rows: [
      {
        key: "competition", label: "Competition", presets: [
          [null, 10000, "< 10K"], [10000, 20000, "10K~20K"], [20000, 50000, "20K~50K"],
          [50000, 100000, "50K~100K"], [100000, null, "≥ 100K"],
        ]
      },
    ]
  },
  {
    group: "sales", label: "Sales", rows: [
      {
        key: "sales", label: "Sales", presets: [
          [0, 10e3, "0~10K"], [10e3, 500e3, "10K~500K"], [500e3, 1e6, "500K~1M"],
        ]
      },
    ]
  },
];

export const SOURCE_COLORS = {
  pinterest: "#e60023",
  instagram: "#e1306c",
  tiktok: "#00f2ea",
  youtube: "#ff0000",
  reddit: "#ff4500",
};

export const SOURCE_LABELS = {
  pinterest: "📌 Pinterest",
  instagram: "📷 Instagram",
  tiktok: "🎵 TikTok",
  youtube: "▶️ YouTube",
  reddit: "📰 Reddit",
};

export function matchesSource(pinSource, filterSource) {
  const src = (pinSource || "").toLowerCase();
  if (filterSource === "instagram") {
    return src === "instagram" || src === "instagram_photo" || src === "instagram_reels";
  }
  return src === filterSource;
}

export const PRODUCT_FILTERS = [
  {
    group: "price", label: "Price ($)", rows: [
      {
        key: "price", label: "Price", presets: [
          [null, 5, "< $5"], [5, 15, "$5~$15"], [15, 30, "$15~$30"], [30, null, "≥ $30"],
        ]
      },
    ]
  },
  {
    group: "sales", label: "Sales", rows: [
      {
        key: "sales_total", label: "Total Sales", presets: [
          [0, 100, "0~100"], [100, 1000, "100~1K"], [1000, 10000, "1K~10K"], [10000, null, "≥ 10K"],
        ]
      },
      {
        key: "monthly_sales", label: "Monthly Sales", presets: [
          [0, 30, "0~30"], [30, 100, "30~100"], [100, 500, "100~500"], [500, null, "≥ 500"],
        ]
      },
    ]
  },
  {
    group: "favorites", label: "Favorites", rows: [
      {
        key: "favorites", label: "Total Favorites", presets: [
          [0, 500, "0~500"], [500, 2000, "500~2K"], [2000, 10000, "2K~10K"], [10000, null, "≥ 10K"],
        ]
      },
      {
        key: "favorites_month", label: "Monthly Favorites", presets: [
          [0, 100, "0~100"], [100, 300, "100~300"], [300, null, "≥ 300"],
        ]
      },
      {
        key: "favorites_weekly", label: "Weekly Favorites", presets: [
          [0, 50, "0~50"], [50, 150, "50~150"], [150, null, "≥ 150"],
        ]
      },
    ]
  },
  {
    group: "reviews", label: "Reviews", rows: [
      {
        key: "reviews", label: "Total Reviews", presets: [
          [0, 100, "0~100"], [100, 500, "100~500"], [500, 2000, "500~2K"], [2000, null, "≥ 2K"],
        ]
      },
      {
        key: "reviews_month", label: "Monthly Reviews", presets: [
          [0, 10, "0~10"], [10, 30, "10~30"], [30, null, "≥ 30"],
        ]
      },
      {
        key: "reviews_weekly", label: "Weekly Reviews", presets: [
          [0, 5, "0~5"], [5, 15, "5~15"], [15, null, "≥ 15"],
        ]
      },
    ]
  },
  {
    group: "store_rating", label: "Store Rating", rows: [
      {
        key: "store_rating", label: "Store Rating", presets: [
          [null, 460, "< 460"], [460, 480, "460~480"], [480, 495, "480~495"], [495, null, "≥ 495"],
        ]
      },
    ]
  },
];

