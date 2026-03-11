/**
 * Strider Labs - American Airlines Auth/Session Management
 *
 * Handles cookie persistence and session management for aa.com.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { BrowserContext, Cookie } from "playwright";

const CONFIG_DIR = path.join(os.homedir(), ".striderlabs", "american");
const COOKIES_FILE = path.join(CONFIG_DIR, "cookies.json");
const SESSION_FILE = path.join(CONFIG_DIR, "session.json");

export interface SessionInfo {
  isLoggedIn: boolean;
  userEmail?: string;
  userName?: string;
  aadvantageNumber?: string;
  lastUpdated: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export async function saveCookies(context: BrowserContext): Promise<void> {
  ensureConfigDir();
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
}

export async function loadCookies(context: BrowserContext): Promise<boolean> {
  if (!fs.existsSync(COOKIES_FILE)) {
    return false;
  }

  try {
    const cookiesJson = fs.readFileSync(COOKIES_FILE, "utf-8");
    const cookies: Cookie[] = JSON.parse(cookiesJson);

    const now = Date.now() / 1000;
    const validCookies = cookies.filter((c) => !c.expires || c.expires > now);

    if (validCookies.length > 0) {
      await context.addCookies(validCookies);
      return true;
    }
  } catch (error) {
    console.error("Failed to load cookies:", error);
  }

  return false;
}

export function saveSessionInfo(info: SessionInfo): void {
  ensureConfigDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(info, null, 2));
}

export function loadSessionInfo(): SessionInfo | null {
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }

  try {
    const sessionJson = fs.readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(sessionJson);
  } catch (error) {
    console.error("Failed to load session info:", error);
    return null;
  }
}

export function clearAuthData(): void {
  if (fs.existsSync(COOKIES_FILE)) {
    fs.unlinkSync(COOKIES_FILE);
  }
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

export function hasSavedCookies(): boolean {
  return fs.existsSync(COOKIES_FILE);
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
