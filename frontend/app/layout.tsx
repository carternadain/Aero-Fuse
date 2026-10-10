import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Apple devices get SF Pro from the system stack; Inter is the look-alike everywhere else.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Aero-Fuse",
  description: "Personal money and trading app",
  applicationName: "Aero-Fuse",
  appleWebApp: { capable: true, title: "Aero-Fuse", statusBarStyle: "black-translucent" },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#221f1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved gain/loss palette before first paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=localStorage.getItem("palette");if(p)document.documentElement.dataset.palette=p}catch(e){}`,
          }}
        />
      </head>
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
