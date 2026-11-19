// A podcaster's own default for two people on screen (19 Nov 2026), account-wide: "My shows are: Stacked / Side by side / Follow the speaker".
// Stored as a setting per address; "auto" (the default) means no preference.
//   - A MilitaryVoices Radio show cut into their Library gets it (Radio keeps its stack unless the default is side or single).
//   - A clip job carries it to the worker, which uses it ONLY for a recording that has no layout of its own and whose person did not
//     choose one on screen, and ONLY when two people are actually on screen (Radio tiles, or exactly two equal panels). A solo show
//     is never cut in half by a default meant for two people. An on-screen choice always wins.
import type { Express, RequestHandler } from "express";
import { storage } from "./storage.js";
import { getSessionEmail } from "./session.js";

export type LayoutDefault = "auto" | "stacked" | "side" | "single";
const VALID: LayoutDefault[] = ["auto", "stacked", "side", "single"];
const key = (email: string) => `clip-layout-default:${email.trim().toLowerCase()}`;

export async function getLayoutDefault(email: string): Promise<LayoutDefault> {
  if (!email) return "auto";
  const v = ((await storage.getSetting(key(email)).catch(() => null)) ?? "").trim() as LayoutDefault;
  return VALID.includes(v) ? v : "auto";
}

export function registerLayoutDefault(app: Express, requireHostSession: RequestHandler): void {
  // The shape UI/UX asked for: { clipLayoutDefault: "" | "stacked" | "side" | "single" }, "" being Automatic.
  const shape = (v: LayoutDefault) => ({ clipLayoutDefault: v === "auto" ? "" : v });
  app.get("/api/host/clip-layout-default", requireHostSession, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(shape(await getLayoutDefault(getSessionEmail(req) ?? "")));
  });
  app.put("/api/host/clip-layout-default", requireHostSession, async (req, res) => {
    const raw = String(req.body?.clipLayoutDefault ?? "").trim();
    const layout = (raw === "" ? "auto" : raw) as LayoutDefault;
    if (!VALID.includes(layout)) return res.status(400).json({ message: "Pick Stacked, Side by side, Follow the speaker or Automatic." });
    await storage.setSetting(key(getSessionEmail(req) ?? ""), layout);
    res.json(shape(layout));
  });
}
