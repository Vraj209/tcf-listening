import { NextResponse } from "next/server";
import { getCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const catalog = await getCatalog();
  return NextResponse.json(catalog, {
    status: catalog.error ? 503 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
