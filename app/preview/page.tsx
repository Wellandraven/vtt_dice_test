import VariantAPreview from "../VariantAPreview";
import type { DevelopmentInterfaceId } from "../../study/progress.js";

export default async function InterfacePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ interface?: string | string[] }>;
}) {
  const value = (await searchParams).interface;
  const interfaceId: DevelopmentInterfaceId = value === "B" || value === "C" ? value : "A";

  return <VariantAPreview previewInterface={interfaceId} />;
}
