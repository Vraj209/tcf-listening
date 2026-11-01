import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "TCF Listening", description: "A quiet space to practise TCF Canada listening.", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f7f2" };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
