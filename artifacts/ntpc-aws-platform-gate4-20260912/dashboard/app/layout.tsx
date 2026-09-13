import type { Metadata } from "next";
import "./globals.css";
import "./workspace-ui.css";

export const metadata: Metadata = {
  title: "新北青年資料證據台｜三母體互動儀表板",
  description: "分清戶籍人口、勞動市場與受僱員工薪資母體，且可追溯、可查核的新北市青年資料儀表板。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
