export const DEFAULT_GROUP_ID = "00000000-0000-0000-0000-000000000001";

export const SHOPPING_CATEGORIES = [
  "פירות וירקות",
  "מוצרי חלב וביצים",
  "בשר, עוף ודגים",
  "לחם ומאפים",
  "שימורים ומזון יבש",
  "קפואים",
  "משקאות",
  "חטיפים וממתקים",
  "תבלינים ורטבים",
  "מוצרי ניקיון",
  "טיפוח והיגיינה",
  "אחר",
] as const;

export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];
