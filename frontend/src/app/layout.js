import "./globals.css";

export const metadata = {
  title: "Şelale İşitme | Yönetim Paneli",
  description: "Şelale İşitme yönetim paneli",
  // Internal tool: keep it out of search results.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
