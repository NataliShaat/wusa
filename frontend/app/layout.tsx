import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "بنك تجريبي",
  description: "مساعد صوتي للخدمات المصرفية",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#002134",
  width: "device-width",
  initialScale: 1,
  // Draw behind the home indicator so the bottom nav can pad itself with
  // env(safe-area-inset-bottom).
  viewportFit: "cover",
  // Explicitly allow pinch-to-zoom up to 200%+ (WCAG AA 1.4.4 Resize Text) -
  // never set maximumScale/userScalable to disable zoom.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-ink">{children}</body>
    </html>
  );
}
