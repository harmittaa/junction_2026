import type { Metadata } from "next";
import { Barlow_Condensed, Figtree } from "next/font/google";
import tokens from "../../docs/design-tokens.json";
import "./globals.css";

// Open stand-ins for S-mobiili's licensed S Bonus UX and S Bonus Display (see docs/style-guide.md).
const ux = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-ux" });
const display = Barlow_Condensed({ subsets: ["latin", "latin-ext"], weight: "800", variable: "--font-display" });

export const metadata: Metadata = { title: "Sponky — your money, a little clearer", description: "A conversational money coach in your banking app." };
function variables(object: object, prefix = ""): string {
  return Object.entries(object).map(([key, value]) => typeof value === "object" ? variables(value, `${prefix}${key}-`) : `--${prefix}${key}:${value};`).join("");
}
const themeCSS = `:root{${variables(tokens.color.light)}${Object.entries(tokens.color.brand).map(([k, v]) => `--brand-${k}:${v.value};`).join("")}}[data-theme=dark]{${variables(tokens.color.dark)}}`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${ux.variable} ${display.variable}`}><head><style>{themeCSS}</style></head><body>{children}</body></html>;
}
