/**
 * Sort an array of pins by the given sortBy key.
 * Mutates a copy of the array — does not mutate the original.
 * Returns the sorted array unchanged when sortBy === "default".
 */
export function sortPins(pins, sortBy) {
  if (!sortBy || sortBy === "default") return pins;

  const num = (v) => (typeof v === "number" ? v : parseInt(v, 10) || 0);

  return [...pins].sort((a, b) => {
    switch (sortBy) {
      case "title_asc":        return (a.title || "").localeCompare(b.title || "");
      case "title_desc":       return (b.title || "").localeCompare(a.title || "");
      case "likes_desc":       return num(b.like_count)      - num(a.like_count);
      case "likes_asc":        return num(a.like_count)      - num(b.like_count);
      case "reactions_desc":   return num(b.reaction_count)  - num(a.reaction_count);
      case "reactions_asc":    return num(a.reaction_count)  - num(b.reaction_count);
      case "saves_desc":       return num(b.save_count)      - num(a.save_count);
      case "shares_desc":      return num(b.share_count)     - num(a.share_count);
      case "repins_desc":      return num(b.repin_count)     - num(a.repin_count);
      case "comments_desc":    return num(b.comment_count)   - num(a.comment_count);
      case "views_desc":       return num(b.view_count)      - num(a.view_count);
      case "views_asc":        return num(a.view_count)      - num(b.view_count);
      case "similarity_desc":  return (b.similarity_score  ?? 0) - (a.similarity_score  ?? 0);
      case "similarity_asc":   return (a.similarity_score  ?? 0) - (b.similarity_score  ?? 0);
      case "confidence_desc":  return (b.confidence_score  ?? 0) - (a.confidence_score  ?? 0);
      case "confidence_asc":   return (a.confidence_score  ?? 0) - (b.confidence_score  ?? 0);
      default:                 return 0;
    }
  });
}
