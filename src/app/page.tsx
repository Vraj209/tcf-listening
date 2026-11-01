import { getCatalog } from "@/lib/catalog";
import { ListeningApp } from "@/components/listening-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const catalog = await getCatalog();
  return <ListeningApp tests={catalog.tests} persistence={catalog.persistence} catalogError={catalog.error} />;
}
