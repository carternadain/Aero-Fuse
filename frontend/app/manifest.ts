import type { MetadataRoute } from "next";

// Makes the dashboard installable ("Add to Home Screen") as a standalone app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Swing Terminal",
    short_name: "Swing",
    description: "Personal swing trading terminal",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#221f1a",
    theme_color: "#221f1a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
