import type { Metadata } from "next";
import "./globals.css";
import { StudentShell } from "../components/student-shell";
export const metadata: Metadata = { title: "NET Prep | UGC NET Geography", description: "PYQ library, practice tests and examination analytics." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><StudentShell>{children}</StudentShell></body></html>;
}
