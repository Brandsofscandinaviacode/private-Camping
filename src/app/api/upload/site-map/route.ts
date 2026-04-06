import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Store uploads in a persistent data directory, not inside .next/standalone/public
function getUploadDir(): string {
  // Use DATA_DIR env or fallback to project root's public/uploads
  if (process.env.DATA_DIR) {
    return join(process.env.DATA_DIR, "uploads");
  }
  // In standalone mode, process.cwd() is .next/standalone
  // We need to write to the actual public/uploads that gets served
  return join(process.cwd(), "public", "uploads");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only images allowed" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const filename = `site-map.${ext}`;
    const uploadDir = getUploadDir();

    // Ensure directory exists
    await mkdir(uploadDir, { recursive: true });

    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}` }, { status: 500 });
  }
}
