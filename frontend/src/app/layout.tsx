import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaceVision — Private face detection",
  description: "Private, browser-based face detection powered by YuNet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
