import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, resolve, sep } from "path";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// Must match the directory the upload route writes to.
function getUploadDir(): string {
  if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR, "uploads");
  return resolve(/* turbopackIgnore: true */ process.cwd(), "public", "uploads");
}

// Serve uploaded files — needed because standalone mode doesn't serve
// files written to public/ after build time
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const ext = path[path.length - 1]?.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext];
  const baseDir = getUploadDir();
  const filePath = resolve(join(baseDir, ...path));

  // Only images, and never anything outside the uploads directory.
  if (!contentType || !filePath.startsWith(baseDir + sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
