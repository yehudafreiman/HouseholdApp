import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { categorizeItem } from "@/lib/categorize";
import type { ShoppingCategory } from "@/lib/shopping";

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
    const category = await categorizeItem(name);
    return NextResponse.json({ category });
  } catch (err) {
    console.error("categorize error", err);
    return NextResponse.json({ category: "אחר" satisfies ShoppingCategory });
  }
}
