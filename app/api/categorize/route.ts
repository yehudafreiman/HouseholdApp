import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { SHOPPING_CATEGORIES, type ShoppingCategory } from "@/lib/shopping";

const anthropic = new Anthropic();

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Missing item name" }, { status: 400 });
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 100,
      temperature: 0,
      system:
        "אתה מסווג פריטי קניות לסופרמרקט ישראלי טיפוסי, עבור רשימת קניות משפחתית. " +
        "בהינתן שם של פריט, בחר בדיוק קטגוריה אחת מתוך רשימת הקטגוריות הבאה - זו " +
        "שבה סביר שהפריט נמצא פיזית על המדף בסופר:\n" +
        SHOPPING_CATEGORIES.map((c) => `- ${c}`).join("\n") +
        "\n\nסווג לפי הצורה הבסיסית והנפוצה ביותר של המוצר, לא לפי אסוציאציה משנית " +
        "(למשל 'שיבולת שועל' הוא דגן, לא משקה, גם אם יש 'חלב שיבולת שועל'). " +
        "אם באמת אין קטגוריה מתאימה, בחר 'אחר'.",
      messages: [{ role: "user", content: name }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: SHOPPING_CATEGORIES },
            },
            required: ["category"],
            additionalProperties: false,
          },
        },
      },
    });

    const block = response.content[0];
    const parsed =
      block?.type === "text" ? (JSON.parse(block.text) as { category?: string }) : null;
    const candidate = parsed?.category;
    const category: ShoppingCategory = (
      SHOPPING_CATEGORIES as readonly string[]
    ).includes(candidate ?? "")
      ? (candidate as ShoppingCategory)
      : "אחר";

    return NextResponse.json({ category });
  } catch (err) {
    console.error("categorize error", err);
    return NextResponse.json({ category: "אחר" satisfies ShoppingCategory });
  }
}
