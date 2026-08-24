import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lume — Flashcards, al tuo ritmo",
  description:
    "Flashcards. Unlimited learning. Free. Organizza i tuoi set in cartelle e studia con flashcard personalizzate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
