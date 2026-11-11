import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./holiday-decor.css";

// Apple devices get SF Pro from the system stack; Inter is the look-alike everywhere else.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Aero",
  description: "Personal money and trading app",
  applicationName: "Aero",
  appleWebApp: { capable: true, title: "Aero", statusBarStyle: "black-translucent" },
  icons: {
    // ?v= busts browsers' long-lived favicon cache (they kept showing the old icon).
    icon: [
      { url: "/favicon.ico?v=2", sizes: "any" },
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
      { url: "/favicon.png?v=2", sizes: "64x64", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png?v=2",
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
        {/* Apply the saved gain/loss palette and appearance before first paint (no flash),
            and follow the device when appearance is "Match device". See lib/theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement,p=localStorage.getItem("palette");if(p)d.dataset.palette=p;`
              + `var m=matchMedia("(prefers-color-scheme: light)"),a=function(){var t=localStorage.getItem("theme");`
              + `if(t!=="light"&&t!=="auto")t="dark";var r=t==="auto"?(m.matches?"light":"dark"):t;d.dataset.theme=r;d.dataset.themePref=t;`
              + `var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",r==="light"?"#f5f1e9":"#221f1a");`
              + `window.dispatchEvent(new Event("themechange"))};a();m.addEventListener("change",a);`
              + `document.addEventListener("DOMContentLoaded",a)}catch(e){}`,
          }}
        />
      </head>
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
