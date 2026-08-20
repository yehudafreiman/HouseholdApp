// Regression test for the shopping-item categorizer (lib/categorize.ts).
// Run with: npm run test:categorize
//
// Calls categorizeItem() twice per item — not just once — because the bug
// that motivated this script wasn't wrong reasoning, it was silent
// non-determinism: Sonnet 5 sometimes emits a leading `thinking` block
// before the answer, and the code used to grab content[0] blindly, so the
// exact same item could come back "אחר" on one call and correct on the
// next. A single run per item would not have caught that.

import { categorizeItem } from "../lib/categorize";

type Case = { name: string; expected: string };

const CASES: Case[] = [
  // Flavor/variant consistency — the exact cluster that exposed the
  // content-block bug (see chat-room.tsx git history).
  { name: "מעדן שוקולד", expected: "מוצרי חלב, ביצים וגבינות" },
  { name: "מעדן וניל", expected: "מוצרי חלב, ביצים וגבינות" },
  { name: "מעדן קרמל", expected: "מוצרי חלב, ביצים וגבינות" },
  { name: "יוגורט תות", expected: "מוצרי חלב, ביצים וגבינות" },
  { name: "יוגורט וניל", expected: "מוצרי חלב, ביצים וגבינות" },

  // Freshness-by-default (rule 2).
  { name: "עגבניה", expected: "פירות וירקות" },
  { name: "בצל", expected: "פירות וירקות" },
  { name: "שום", expected: "פירות וירקות" },

  // Processing keywords override the default (rule 3).
  { name: "שום יבש", expected: "תבלינים, רטבים ושמנים" },
  { name: "כורכום טחון", expected: "תבלינים, רטבים ושמנים" },
  { name: "עוף קפוא", expected: "קפואים" },
  { name: "תירס קפוא", expected: "קפואים" },
  { name: "ריבת תות", expected: "שימורים ואוכל מוכן" },

  // Confusable non-food anchors (rule 4).
  { name: "מגבת", expected: "טקסטיל, מצעים וביגוד בסיסי" },
  { name: "מגבונים", expected: "מוצרים חד פעמיים" },

  // Brand names (rule 5).
  { name: "אקמול", expected: "בריאות, תרופות ותוספי תזונה" },
  { name: "קוקה קולה", expected: "משקאות קרים" },

  // Typo tolerance (rule 1).
  { name: "עגבניא", expected: "פירות וירקות" },
  { name: "יוגרט תות", expected: "מוצרי חלב, ביצים וגבינות" },

  // Basic staples — should never be surprising.
  { name: "חלב", expected: "מוצרי חלב, ביצים וגבינות" },
  { name: "לחם פרוס", expected: "לחם ומאפייה" },
  { name: "אורז בסמטי", expected: "דגנים, קטניות, אורז ופסטה" },
  { name: "נייר טואלט", expected: "מוצרים חד פעמיים" },
];

async function runCase(c: Case) {
  const [first, second] = await Promise.all([
    categorizeItem(c.name),
    categorizeItem(c.name),
  ]);

  const consistent = first === second;
  const correct = first === c.expected && second === c.expected;

  return { ...c, first, second, consistent, correct };
}

async function main() {
  console.log(`Running ${CASES.length} categorization cases (2 calls each)...\n`);

  const results = await Promise.all(CASES.map(runCase));

  let failures = 0;
  for (const r of results) {
    if (r.correct) {
      console.log(`  ok    ${r.name} → ${r.first}`);
      continue;
    }
    failures++;
    if (!r.consistent) {
      console.log(
        `  FAIL  ${r.name} → inconsistent across calls: "${r.first}" vs "${r.second}" (expected "${r.expected}")`
      );
    } else {
      console.log(`  FAIL  ${r.name} → "${r.first}" (expected "${r.expected}")`);
    }
  }

  console.log(`\n${results.length - failures}/${results.length} passed.`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
