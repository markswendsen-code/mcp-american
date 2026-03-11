/**
 * Strider Labs - American Airlines Browser Automation
 *
 * Playwright-based browser automation for aa.com flight search,
 * booking, check-in, and AAdvantage account operations.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  saveCookies,
  loadCookies,
  saveSessionInfo,
  type SessionInfo,
} from "./auth.js";

const AA_BASE_URL = "https://www.aa.com";
const DEFAULT_TIMEOUT = 30000;

// Singleton browser instance
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface FlightResult {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  duration?: string;
  stops: number;
  stopCities?: string[];
  aircraft?: string;
  cabinClass?: string;
  fare?: string;
  price?: string;
  seatsRemaining?: number;
  upgradeable?: boolean;
}

export interface FlightDetails extends FlightResult {
  connections?: Array<{
    flightNumber: string;
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    aircraft?: string;
    duration?: string;
    layoverDuration?: string;
  }>;
  baggagePolicy?: string;
  changeFee?: string;
  refundable?: boolean;
  mileageEarned?: string;
  fareRules?: string;
}

export interface SeatMap {
  flightNumber: string;
  aircraft?: string;
  cabins: Array<{
    name: string;
    rows: Array<{
      row: number;
      seats: Array<{
        seatNumber: string;
        available: boolean;
        seatType?: string;
        fee?: string;
        features?: string[];
      }>;
    }>;
  }>;
}

export interface Reservation {
  recordLocator: string;
  passengers: Array<{ name: string; seat?: string }>;
  flights: Array<{
    flightNumber: string;
    origin: string;
    destination: string;
    date: string;
    departureTime: string;
    arrivalTime: string;
    status?: string;
    aircraft?: string;
  }>;
  totalPaid?: string;
  bags?: string;
  status?: string;
}

export interface BoardingPass {
  passenger: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  boardingTime?: string;
  departureTime: string;
  gate?: string;
  seat?: string;
  group?: string;
  barcode?: string;
  url?: string;
}

export interface AAdvantageInfo {
  memberNumber?: string;
  name?: string;
  tier?: string;
  totalMiles?: string;
  eliteMiles?: string;
  eliteSegments?: string;
  expirationDate?: string;
  milestones?: Array<{ name: string; progress: string }>;
}

// ─── Browser Lifecycle ────────────────────────────────────────────────────────

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });
  }
  return browser;
}

async function getContext(): Promise<BrowserContext> {
  if (!context) {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    await loadCookies(context);
  }
  return context;
}

async function getPage(): Promise<Page> {
  if (!page || page.isClosed()) {
    const ctx = await getContext();
    page = await ctx.newPage();

    // Stealth: remove navigator.webdriver
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    await saveCookies(context);
  }
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(dateStr: string): string {
  // Convert YYYY-MM-DD to MM/DD/YYYY
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }
  return dateStr;
}

async function dismissOverlays(p: Page): Promise<void> {
  // Dismiss cookie/consent banners and modals
  const overlaySelectors = [
    'button[aria-label="Close"]',
    'button[data-testid="modal-close"]',
    "#onetrust-accept-btn-handler",
    '.cookie-consent button[class*="accept"]',
  ];
  for (const sel of overlaySelectors) {
    try {
      const el = p.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click();
        await delay(500);
      }
    } catch {
      // ignore
    }
  }
}

// ─── Authentication ───────────────────────────────────────────────────────────

export async function checkLoginStatus(): Promise<SessionInfo> {
  const p = await getPage();

  try {
    await p.goto(`${AA_BASE_URL}/en/homepage.jsp`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT,
    });
    await delay(1500);

    // Check for logged-in indicators: name in nav, "My trips" link, etc.
    const loggedInSelectors = [
      '[data-testid="account-menu"]',
      '[aria-label="My account"]',
      ".aa-nav__account-name",
      '[class*="userGreeting"]',
      'a[href*="/aadvantage/"]',
    ];

    let isLoggedIn = false;
    let userName: string | undefined;
    let userEmail: string | undefined;
    let aadvantageNumber: string | undefined;

    for (const sel of loggedInSelectors) {
      try {
        const el = p.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          isLoggedIn = true;
          const text = await el.textContent();
          if (text && text.trim()) {
            userName = text.trim().replace(/\s+/g, " ");
          }
          break;
        }
      } catch {
        // continue
      }
    }

    const info: SessionInfo = {
      isLoggedIn,
      userName,
      userEmail,
      aadvantageNumber,
      lastUpdated: new Date().toISOString(),
    };

    if (isLoggedIn) {
      const ctx = await getContext();
      await saveCookies(ctx);
      saveSessionInfo(info);
    }

    return info;
  } catch (error) {
    return {
      isLoggedIn: false,
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function initiateLogin(): Promise<{
  url: string;
  instructions: string;
  loginPageOpened: boolean;
}> {
  const p = await getPage();

  await p.goto(`${AA_BASE_URL}/en/homepage.jsp`, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT,
  });

  const loginUrl = `${AA_BASE_URL}/en/homepage.jsp`;

  return {
    url: loginUrl,
    loginPageOpened: true,
    instructions:
      "A browser window has been opened to aa.com. Please log in manually with your AAdvantage credentials. " +
      "Once logged in, call the 'status' tool to verify and save your session. " +
      "Your session cookies will be saved to ~/.striderlabs/american/ for future use.",
  };
}

// ─── Flight Search ────────────────────────────────────────────────────────────

export interface SearchFlightsParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults?: number;
  children?: number;
  cabinClass?: string;
  maxResults?: number;
}

export async function searchFlights(
  params: SearchFlightsParams
): Promise<FlightResult[]> {
  const {
    origin,
    destination,
    departureDate,
    returnDate,
    adults = 1,
    children = 0,
    cabinClass = "coach",
    maxResults = 10,
  } = params;

  const p = await getPage();

  // Build AA flight search URL
  const tripType = returnDate ? "roundTrip" : "oneWay";
  const cabinMap: Record<string, string> = {
    coach: "COACH",
    economy: "COACH",
    "premium economy": "PREMIUM_ECONOMY",
    "premium coach": "PREMIUM_ECONOMY",
    business: "BUSINESS",
    first: "FIRST",
  };
  const cabin = cabinMap[cabinClass.toLowerCase()] || "COACH";

  // Construct search URL
  const searchUrl =
    `${AA_BASE_URL}/booking/find-flights#/` +
    `?locale=en_US` +
    `&pax.adults=${adults}` +
    `&pax.children=${children}` +
    `&slices[0].orig=${origin.toUpperCase()}` +
    `&slices[0].dest=${destination.toUpperCase()}` +
    `&slices[0].date=${departureDate}` +
    (returnDate ? `&slices[1].orig=${destination.toUpperCase()}&slices[1].dest=${origin.toUpperCase()}&slices[1].date=${returnDate}` : "") +
    `&tripType=${tripType}` +
    `&cabin=${cabin}`;

  await p.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT,
  });
  await dismissOverlays(p);

  // Wait for results to load
  const resultSelectors = [
    '[data-testid="flight-result"]',
    '[class*="flightResult"]',
    '[class*="flight-result"]',
    ".flight-listing",
    '[data-name="flight-slice"]',
  ];

  let resultsLoaded = false;
  for (const sel of resultSelectors) {
    try {
      await p.waitForSelector(sel, { timeout: 15000 });
      resultsLoaded = true;
      break;
    } catch {
      // try next
    }
  }

  if (!resultsLoaded) {
    // Fallback: wait for any price elements
    try {
      await p.waitForSelector('[class*="price"], [class*="Price"]', {
        timeout: 10000,
      });
    } catch {
      throw new Error(
        "Flight results did not load. AA.com may be blocking automation or results are unavailable for this route/date."
      );
    }
  }

  await delay(2000); // Allow dynamic content to settle

  // Extract flight data
  const flights = await p.evaluate(
    ({ maxResults }) => {
      const results: Array<{
        id: string;
        flightNumber: string;
        origin: string;
        destination: string;
        departureTime: string;
        arrivalTime: string;
        duration: string;
        stops: number;
        stopCities: string[];
        aircraft: string;
        cabinClass: string;
        fare: string;
        price: string;
        seatsRemaining: number;
        upgradeable: boolean;
      }> = [];

      // Try multiple selector strategies for AA's dynamic UI
      const flightCards = document.querySelectorAll(
        '[data-testid="flight-result"], [class*="flightResult"], [class*="flight-row"], .flight-listing-row, [data-name="flight-slice"]'
      );

      let idx = 0;
      for (const card of Array.from(flightCards)) {
        if (idx >= maxResults) break;

        const getText = (sel: string): string => {
          const el = card.querySelector(sel);
          return el ? (el as HTMLElement).innerText.trim() : "";
        };

        const flightNum =
          getText('[class*="flightNumber"], [data-testid="flight-number"], [class*="flight-num"]') ||
          getText('[class*="segment-number"]') ||
          "";
        const depTime =
          getText('[class*="departs"], [class*="departureTime"], [data-testid="departure-time"]') ||
          getText('[class*="dep-time"]') ||
          "";
        const arrTime =
          getText('[class*="arrives"], [class*="arrivalTime"], [data-testid="arrival-time"]') ||
          getText('[class*="arr-time"]') ||
          "";
        const dur =
          getText('[class*="duration"], [data-testid="duration"]') || "";
        const stopsText =
          getText('[class*="stops"], [data-testid="stops"]') || "";
        const price =
          getText('[class*="price"], [data-testid="price"], [class*="fare-price"]') || "";
        const aircraft =
          getText('[class*="aircraft"], [data-testid="aircraft"]') || "";
        const cabin =
          getText('[class*="cabin"], [data-testid="cabin-class"]') || "";
        const fare =
          getText('[class*="fareName"], [class*="fare-name"], [data-testid="fare-name"]') || "";
        const seatsText =
          getText('[class*="seatsLeft"], [class*="seats-remaining"]') || "";

        // Parse stops count
        let stopsCount = 0;
        if (stopsText.toLowerCase().includes("nonstop")) {
          stopsCount = 0;
        } else {
          const stopsMatch = stopsText.match(/(\d+)\s*stop/i);
          stopsCount = stopsMatch ? parseInt(stopsMatch[1]) : 0;
        }

        // Parse seats remaining
        const seatsMatch = seatsText.match(/(\d+)/);
        const seatsRemaining = seatsMatch ? parseInt(seatsMatch[1]) : 0;

        if (depTime || flightNum) {
          results.push({
            id: String(idx),
            flightNumber: flightNum,
            origin: "",
            destination: "",
            departureTime: depTime,
            arrivalTime: arrTime,
            duration: dur,
            stops: stopsCount,
            stopCities: [],
            aircraft: aircraft,
            cabinClass: cabin,
            fare: fare,
            price: price,
            seatsRemaining: seatsRemaining,
            upgradeable: false,
          });
          idx++;
        }
      }

      return results;
    },
    { maxResults }
  );

  // Annotate with origin/destination
  return flights.map((f) => ({
    ...f,
    origin: origin.toUpperCase(),
    destination: destination.toUpperCase(),
  }));
}

// ─── Flight Details ───────────────────────────────────────────────────────────

export async function getFlightDetails(
  flightId: string
): Promise<FlightDetails> {
  const p = await getPage();

  // Click on the flight with this index to expand details
  try {
    const cards = await p.locator(
      '[data-testid="flight-result"], [class*="flightResult"], [class*="flight-row"], .flight-listing-row'
    ).all();

    const idx = parseInt(flightId);
    if (cards.length > idx) {
      await cards[idx].click();
      await delay(1500);

      // Try to find and click "Flight details" link
      const detailsLink = p.locator(
        '[class*="flightDetails"], [data-testid="flight-details"], a:has-text("Flight details")'
      ).first();
      if (await detailsLink.isVisible({ timeout: 2000 })) {
        await detailsLink.click();
        await delay(1500);
      }
    }
  } catch {
    // Proceed with whatever is on the page
  }

  const details = await p.evaluate((flightId: string) => {
    const cards = document.querySelectorAll(
      '[data-testid="flight-result"], [class*="flightResult"], [class*="flight-row"], .flight-listing-row'
    );
    const idx = parseInt(flightId);
    const card = cards[idx] || document;

    const getText = (sel: string, ctx: Element | Document = card): string => {
      const el = ctx.querySelector(sel);
      return el ? (el as HTMLElement).innerText.trim() : "";
    };

    const connections: Array<{
      flightNumber: string;
      origin: string;
      destination: string;
      departureTime: string;
      arrivalTime: string;
      aircraft?: string;
      duration?: string;
      layoverDuration?: string;
    }> = [];

    // Parse connections/segments
    const segments = card.querySelectorAll(
      '[class*="segment"], [data-testid="segment"]'
    );
    for (const seg of Array.from(segments)) {
      const segGetText = (sel: string) => {
        const el = seg.querySelector(sel);
        return el ? (el as HTMLElement).innerText.trim() : "";
      };
      connections.push({
        flightNumber: segGetText('[class*="flightNumber"], [class*="flight-num"]'),
        origin: segGetText('[class*="origin"], [class*="dep-airport"]'),
        destination: segGetText('[class*="destination"], [class*="arr-airport"]'),
        departureTime: segGetText('[class*="departureTime"], [class*="dep-time"]'),
        arrivalTime: segGetText('[class*="arrivalTime"], [class*="arr-time"]'),
        aircraft: segGetText('[class*="aircraft"]'),
        duration: segGetText('[class*="duration"]'),
        layoverDuration: segGetText('[class*="layover"]'),
      });
    }

    return {
      id: flightId,
      flightNumber: getText(
        '[class*="flightNumber"], [data-testid="flight-number"]'
      ),
      origin: "",
      destination: "",
      departureTime: getText(
        '[class*="departureTime"], [data-testid="departure-time"]'
      ),
      arrivalTime: getText(
        '[class*="arrivalTime"], [data-testid="arrival-time"]'
      ),
      duration: getText('[class*="duration"]'),
      stops: connections.length > 1 ? connections.length - 1 : 0,
      connections: connections.length > 0 ? connections : undefined,
      aircraft: getText('[class*="aircraft"]'),
      baggagePolicy: getText('[class*="baggage"], [data-testid="baggage"]'),
      changeFee: getText('[class*="changeFee"], [class*="change-fee"]'),
      refundable:
        document.body.innerText.toLowerCase().includes("refundable") &&
        !document.body.innerText.toLowerCase().includes("non-refundable"),
      mileageEarned: getText('[class*="miles"], [class*="mileage"]'),
      price: getText('[class*="price"], [data-testid="price"]'),
      fare: getText('[class*="fareName"], [class*="fare-name"]'),
      cabinClass: getText('[class*="cabin"]'),
      seatsRemaining: 0,
      stopCities: [],
      upgradeable: false,
    };
  }, flightId);

  return details;
}

// ─── Select Flight ────────────────────────────────────────────────────────────

export async function selectFlight(params: {
  outboundFlightId: string;
  returnFlightId?: string;
}): Promise<{ success: boolean; message: string; nextStep?: string }> {
  const p = await getPage();

  try {
    // Select outbound flight
    const cards = await p.locator(
      '[data-testid="flight-result"], [class*="flightResult"], [class*="flight-row"], .flight-listing-row'
    ).all();
    const idx = parseInt(params.outboundFlightId);

    if (cards.length <= idx) {
      throw new Error(`Flight ${params.outboundFlightId} not found in results`);
    }

    // Click "Select" button on flight card
    const selectBtn = cards[idx].locator(
      'button:has-text("Select"), button:has-text("Choose"), [data-testid="select-flight"]'
    ).first();
    await selectBtn.click();
    await delay(2000);

    // Handle return flight if round trip
    if (params.returnFlightId !== undefined) {
      const returnCards = await p.locator(
        '[data-testid="flight-result"], [class*="flightResult"], [class*="flight-row"]'
      ).all();
      const retIdx = parseInt(params.returnFlightId);
      if (returnCards.length > retIdx) {
        const retSelectBtn = returnCards[retIdx].locator(
          'button:has-text("Select"), button:has-text("Choose")'
        ).first();
        await retSelectBtn.click();
        await delay(2000);
      }
    }

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      message: "Flight(s) selected. Proceed to seat selection or add bags.",
      nextStep:
        "Call get_seat_map to view available seats, or add_bags to add checked baggage.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

// ─── Seat Map ─────────────────────────────────────────────────────────────────

export async function getSeatMap(flightNumber?: string): Promise<SeatMap> {
  const p = await getPage();

  // Navigate to seat selection if not already there
  try {
    await p.waitForSelector(
      '[class*="seatMap"], [data-testid="seat-map"], .seat-map',
      { timeout: 5000 }
    );
  } catch {
    // Try navigating to seat map page
    try {
      const seatLink = p.locator(
        'a:has-text("Choose seats"), button:has-text("Choose seats"), [data-testid="seat-selection"]'
      ).first();
      if (await seatLink.isVisible({ timeout: 3000 })) {
        await seatLink.click();
        await delay(2000);
      }
    } catch {
      // proceed with what's available
    }
  }

  const seatMap = await p.evaluate(
    (flightNumber: string | undefined) => {
      const mapContainer = document.querySelector(
        '[class*="seatMap"], [data-testid="seat-map"], .seat-map, [class*="aircraft-diagram"]'
      );

      if (!mapContainer) {
        return {
          flightNumber: flightNumber || "Unknown",
          aircraft: "",
          cabins: [
            {
              name: "Main Cabin",
              rows: [],
            },
          ],
        };
      }

      const aircraft =
        (
          document.querySelector(
            '[class*="aircraftType"], [data-testid="aircraft-type"]'
          ) as HTMLElement
        )?.innerText?.trim() || "";

      // Parse seat rows
      const cabins: Array<{
        name: string;
        rows: Array<{
          row: number;
          seats: Array<{
            seatNumber: string;
            available: boolean;
            seatType?: string;
            fee?: string;
            features?: string[];
          }>;
        }>;
      }> = [];

      const cabinEls = mapContainer.querySelectorAll(
        '[class*="cabin"], [data-cabin], [class*="section"]'
      );

      if (cabinEls.length === 0) {
        // Flat structure - parse all seats
        const allSeats = mapContainer.querySelectorAll(
          '[class*="seat"], button[aria-label*="Seat"], [data-seat]'
        );

        const rowMap = new Map<
          number,
          Array<{
            seatNumber: string;
            available: boolean;
            seatType?: string;
            fee?: string;
            features?: string[];
          }>
        >();

        for (const seat of Array.from(allSeats)) {
          const label =
            (seat as HTMLElement).getAttribute("aria-label") ||
            (seat as HTMLElement).innerText.trim();
          const seatMatch = label.match(/([0-9]+)([A-F])/i);
          if (!seatMatch) continue;

          const rowNum = parseInt(seatMatch[1]);
          const seatLetter = seatMatch[2].toUpperCase();
          const seatNumber = `${rowNum}${seatLetter}`;

          const isAvailable =
            !(seat as HTMLElement).hasAttribute("disabled") &&
            !(seat as HTMLElement).classList.value
              .toLowerCase()
              .includes("occupied") &&
            !(seat as HTMLElement).classList.value
              .toLowerCase()
              .includes("unavailable") &&
            !(seat as HTMLElement).classList.value
              .toLowerCase()
              .includes("taken");

          const seatType = (seat as HTMLElement).classList.value
            .toLowerCase()
            .includes("main-cabin-extra")
            ? "Main Cabin Extra"
            : (seat as HTMLElement).classList.value
                  .toLowerCase()
                  .includes("preferred")
              ? "Preferred"
              : (seat as HTMLElement).classList.value
                    .toLowerCase()
                    .includes("first")
                ? "First Class"
                : (seat as HTMLElement).classList.value
                      .toLowerCase()
                      .includes("business")
                  ? "Business"
                  : "Main Cabin";

          const fee =
            (seat as HTMLElement)
              .querySelector('[class*="fee"], [class*="price"]')
              ?.textContent?.trim() || undefined;

          if (!rowMap.has(rowNum)) {
            rowMap.set(rowNum, []);
          }
          rowMap.get(rowNum)!.push({
            seatNumber,
            available: isAvailable,
            seatType,
            fee,
          });
        }

        const rows = Array.from(rowMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([row, seats]) => ({ row, seats }));

        cabins.push({ name: "Main Cabin", rows });
      } else {
        for (const cabinEl of Array.from(cabinEls)) {
          const cabinName =
            (cabinEl.querySelector('[class*="cabinName"], [class*="cabin-name"]') as HTMLElement)
              ?.innerText?.trim() ||
            (cabinEl as HTMLElement).getAttribute("data-cabin") ||
            "Cabin";

          const seatEls = cabinEl.querySelectorAll(
            '[class*="seat"], button[aria-label*="Seat"]'
          );
          const rowMap = new Map<
            number,
            Array<{
              seatNumber: string;
              available: boolean;
              seatType?: string;
              fee?: string;
            }>
          >();

          for (const seat of Array.from(seatEls)) {
            const label =
              (seat as HTMLElement).getAttribute("aria-label") ||
              (seat as HTMLElement).innerText.trim();
            const seatMatch = label.match(/([0-9]+)([A-F])/i);
            if (!seatMatch) continue;

            const rowNum = parseInt(seatMatch[1]);
            const seatLetter = seatMatch[2].toUpperCase();
            const seatNumber = `${rowNum}${seatLetter}`;
            const isAvailable = !(seat as HTMLElement).hasAttribute("disabled");
            const fee =
              (seat as HTMLElement)
                .querySelector('[class*="fee"]')
                ?.textContent?.trim() || undefined;

            if (!rowMap.has(rowNum)) rowMap.set(rowNum, []);
            rowMap.get(rowNum)!.push({ seatNumber, available: isAvailable, fee });
          }

          const rows = Array.from(rowMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([row, seats]) => ({ row, seats }));

          cabins.push({ name: cabinName, rows });
        }
      }

      return {
        flightNumber: flightNumber || "Unknown",
        aircraft,
        cabins,
      };
    },
    flightNumber
  );

  return seatMap;
}

// ─── Select Seats ─────────────────────────────────────────────────────────────

export async function selectSeats(params: {
  seats: string[];
  flightNumber?: string;
}): Promise<{ success: boolean; selectedSeats: string[]; fees?: string; message: string }> {
  const p = await getPage();

  const selectedSeats: string[] = [];

  try {
    for (const seatNumber of params.seats) {
      // Try to click on the seat
      const seatSelectors = [
        `[aria-label*="${seatNumber}"]`,
        `button[data-seat="${seatNumber}"]`,
        `[data-testid="seat-${seatNumber}"]`,
      ];

      let clicked = false;
      for (const sel of seatSelectors) {
        try {
          const el = p.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click();
            await delay(800);
            clicked = true;
            selectedSeats.push(seatNumber);
            break;
          }
        } catch {
          // try next selector
        }
      }

      if (!clicked) {
        console.error(`Could not find seat ${seatNumber} on page`);
      }
    }

    // Look for total fee display
    const feeEl = p.locator('[class*="seatFee"], [class*="seat-fee"], [class*="totalFee"]').first();
    const fees = await feeEl.isVisible({ timeout: 1000 })
      ? await feeEl.textContent()
      : undefined;

    // Confirm seat selection if button available
    const confirmBtn = p.locator(
      'button:has-text("Confirm seats"), button:has-text("Save seats"), [data-testid="confirm-seats"]'
    ).first();
    if (await confirmBtn.isVisible({ timeout: 2000 })) {
      await confirmBtn.click();
      await delay(1500);
    }

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: selectedSeats.length > 0,
      selectedSeats,
      fees: fees?.trim() || undefined,
      message:
        selectedSeats.length > 0
          ? `Selected seats: ${selectedSeats.join(", ")}`
          : "No seats could be selected. Verify seat numbers from get_seat_map.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, selectedSeats, message: msg };
  }
}

// ─── Add Bags ─────────────────────────────────────────────────────────────────

export async function addBags(params: {
  bags: number;
  passenger?: string;
}): Promise<{ success: boolean; bags: number; totalFee?: string; message: string }> {
  const p = await getPage();

  try {
    // Navigate to bag selection or find the bags section
    const bagLink = p.locator(
      'a:has-text("Bags"), button:has-text("Add bags"), [data-testid="bag-selection"]'
    ).first();

    if (await bagLink.isVisible({ timeout: 3000 })) {
      await bagLink.click();
      await delay(1500);
    }

    // Look for bag quantity selector
    for (let i = 0; i < params.bags; i++) {
      const addBagBtn = p.locator(
        'button[aria-label="Add bag"], button:has-text("+"), [data-testid="add-bag"]'
      ).first();
      if (await addBagBtn.isVisible({ timeout: 2000 })) {
        await addBagBtn.click();
        await delay(500);
      }
    }

    // Or use a dropdown/select
    const bagSelect = p.locator(
      'select[name*="bag"], select[id*="bag"], [data-testid="bag-count"]'
    ).first();
    if (await bagSelect.isVisible({ timeout: 1000 })) {
      await bagSelect.selectOption(String(params.bags));
      await delay(500);
    }

    // Get total fee
    const feeEl = p.locator(
      '[class*="bagFee"], [class*="bag-fee"], [class*="totalFee"]'
    ).first();
    const totalFee = await feeEl.isVisible({ timeout: 1000 })
      ? await feeEl.textContent()
      : undefined;

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      bags: params.bags,
      totalFee: totalFee?.trim() || undefined,
      message: `Added ${params.bags} checked bag(s).`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, bags: 0, message: msg };
  }
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

export interface CheckoutPreview {
  requiresConfirmation: true;
  preview: {
    flights: string[];
    passengers: string[];
    seats?: string[];
    bags?: string;
    totalPrice?: string;
    fareType?: string;
  };
}

export interface CheckoutResult {
  success: boolean;
  confirmationNumber?: string;
  recordLocator?: string;
  message: string;
}

export async function checkout(params: {
  confirm: boolean;
  paymentLastFour?: string;
}): Promise<CheckoutPreview | CheckoutResult> {
  const p = await getPage();

  // Gather preview info from current page state
  const preview = await p.evaluate(() => {
    const getText = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? (el as HTMLElement).innerText.trim() : "";
    };

    const totalPrice =
      getText('[class*="totalPrice"], [class*="total-price"], [data-testid="total-price"]') ||
      getText('[class*="grandTotal"], [class*="grand-total"]');

    const fareType = getText('[class*="fareName"], [class*="fare-name"]');

    return {
      flights: [getText('[class*="flightSummary"], [class*="trip-summary"]')].filter(Boolean),
      passengers: [getText('[class*="passenger"], [class*="traveler"]')].filter(Boolean),
      totalPrice: totalPrice || undefined,
      fareType: fareType || undefined,
    };
  });

  if (!params.confirm) {
    return {
      requiresConfirmation: true,
      preview: {
        ...preview,
        seats: [],
        bags: undefined,
      },
    };
  }

  // Proceed with actual checkout
  try {
    // Find and click purchase/confirm button
    const purchaseBtn = p.locator(
      'button:has-text("Purchase"), button:has-text("Confirm and pay"), button:has-text("Complete purchase"), [data-testid="purchase-button"]'
    ).first();

    if (!(await purchaseBtn.isVisible({ timeout: 5000 }))) {
      throw new Error(
        "Purchase button not found. Ensure you have selected flights and are on the review page."
      );
    }

    await purchaseBtn.click();
    await delay(5000); // Allow booking to process

    // Look for confirmation number
    const confirmationSelectors = [
      '[class*="confirmationNumber"], [class*="confirmation-number"]',
      '[data-testid="confirmation-number"]',
      '[class*="recordLocator"]',
      'p:has-text("Confirmation")',
      'h1:has-text("Confirmation")',
    ];

    let confirmationNumber: string | undefined;
    for (const sel of confirmationSelectors) {
      try {
        const el = p.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          const text = await el.textContent();
          const match = text?.match(/[A-Z0-9]{6}/);
          if (match) {
            confirmationNumber = match[0];
            break;
          }
        }
      } catch {
        // continue
      }
    }

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      confirmationNumber,
      message: confirmationNumber
        ? `Booking confirmed! Confirmation number: ${confirmationNumber}`
        : "Booking appears complete. Check your email for confirmation.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

// ─── Get Reservation ──────────────────────────────────────────────────────────

export async function getReservation(params: {
  recordLocator: string;
  lastName?: string;
}): Promise<Reservation> {
  const p = await getPage();

  // Navigate to trip lookup
  const lookupUrl = `${AA_BASE_URL}/booking/find-reservations.do`;
  await p.goto(lookupUrl, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT,
  });
  await dismissOverlays(p);
  await delay(1000);

  // Fill in record locator
  try {
    const codeInput = p.locator(
      'input[name*="confNum"], input[name*="recordLocator"], input[placeholder*="confirmation"], #confirmationNumber'
    ).first();
    await codeInput.fill(params.recordLocator.toUpperCase());

    if (params.lastName) {
      const lastNameInput = p.locator(
        'input[name*="lastName"], input[placeholder*="last name"], #lastName'
      ).first();
      await lastNameInput.fill(params.lastName);
    }

    const submitBtn = p.locator(
      'button[type="submit"], button:has-text("Find"), button:has-text("Search")'
    ).first();
    await submitBtn.click();
    await delay(3000);
  } catch (error) {
    throw new Error(`Failed to look up reservation: ${error}`);
  }

  // Extract reservation data
  const reservation = await p.evaluate((recordLocator: string) => {
    const getText = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? (el as HTMLElement).innerText.trim() : "";
    };

    const flights: Array<{
      flightNumber: string;
      origin: string;
      destination: string;
      date: string;
      departureTime: string;
      arrivalTime: string;
      status?: string;
      aircraft?: string;
    }> = [];

    const flightEls = document.querySelectorAll(
      '[class*="flightSegment"], [data-testid="flight-segment"], [class*="segment-info"]'
    );
    for (const el of Array.from(flightEls)) {
      const getElText = (sel: string) => {
        const child = el.querySelector(sel);
        return child ? (child as HTMLElement).innerText.trim() : "";
      };
      flights.push({
        flightNumber: getElText('[class*="flightNum"], [class*="flight-number"]'),
        origin: getElText('[class*="origin"], [class*="dep"]'),
        destination: getElText('[class*="destination"], [class*="arr"]'),
        date: getElText('[class*="date"], [class*="depart-date"]'),
        departureTime: getElText('[class*="depTime"], [class*="dep-time"]'),
        arrivalTime: getElText('[class*="arrTime"], [class*="arr-time"]'),
        status: getElText('[class*="status"]') || undefined,
        aircraft: getElText('[class*="aircraft"]') || undefined,
      });
    }

    const passengers: Array<{ name: string; seat?: string }> = [];
    const passengerEls = document.querySelectorAll(
      '[class*="passenger"], [data-testid="passenger-info"]'
    );
    for (const el of Array.from(passengerEls)) {
      const name = (el.querySelector('[class*="name"]') as HTMLElement)?.innerText?.trim();
      const seat = (el.querySelector('[class*="seat"]') as HTMLElement)?.innerText?.trim();
      if (name) passengers.push({ name, seat: seat || undefined });
    }

    return {
      recordLocator,
      passengers,
      flights,
      totalPaid: getText('[class*="totalPaid"], [class*="total-paid"]') || undefined,
      bags: getText('[class*="baggage"], [class*="bags"]') || undefined,
      status: getText('[class*="tripStatus"], [class*="booking-status"]') || undefined,
    };
  }, params.recordLocator);

  return reservation;
}

// ─── Modify Trip ──────────────────────────────────────────────────────────────

export async function modifyTrip(params: {
  recordLocator: string;
  newDepartureDate?: string;
  newReturnDate?: string;
  lastName?: string;
}): Promise<{ success: boolean; message: string; changeFee?: string; url?: string }> {
  const p = await getPage();

  // Start from reservation lookup
  const reservation = await getReservation({
    recordLocator: params.recordLocator,
    lastName: params.lastName,
  });

  // Navigate to change flight
  try {
    const changeBtn = p.locator(
      'a:has-text("Change flight"), button:has-text("Change flight"), [data-testid="change-flight"]'
    ).first();
    if (await changeBtn.isVisible({ timeout: 3000 })) {
      await changeBtn.click();
      await delay(2000);
    }

    const changeFeeEl = p.locator(
      '[class*="changeFee"], [class*="change-fee"]'
    ).first();
    const changeFee = await changeFeeEl.isVisible({ timeout: 2000 })
      ? await changeFeeEl.textContent()
      : undefined;

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      message: `Initiated change for reservation ${params.recordLocator}. Select new flights using search_flights.`,
      changeFee: changeFee?.trim() || undefined,
      url: p.url(),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

// ─── Cancel Trip ──────────────────────────────────────────────────────────────

export async function cancelTrip(params: {
  recordLocator: string;
  lastName?: string;
  confirm: boolean;
}): Promise<{ success: boolean; message: string; refundAmount?: string }> {
  const p = await getPage();

  if (!params.confirm) {
    // Preview mode — retrieve reservation details only
    const reservation = await getReservation({
      recordLocator: params.recordLocator,
      lastName: params.lastName,
    });

    return {
      success: false,
      message: `Preview: Cancellation requires confirm=true. Reservation ${params.recordLocator} has ${reservation.flights.length} flight(s). Please confirm before proceeding.`,
    };
  }

  // Actual cancellation
  try {
    await getReservation({
      recordLocator: params.recordLocator,
      lastName: params.lastName,
    });

    const cancelBtn = p.locator(
      'a:has-text("Cancel trip"), button:has-text("Cancel trip"), button:has-text("Cancel reservation"), [data-testid="cancel-trip"]'
    ).first();

    if (!(await cancelBtn.isVisible({ timeout: 3000 }))) {
      throw new Error(
        "Cancel button not found. The reservation may not be cancellable online."
      );
    }

    await cancelBtn.click();
    await delay(2000);

    // Confirm cancellation dialog
    const confirmCancelBtn = p.locator(
      'button:has-text("Confirm cancellation"), button:has-text("Yes, cancel"), [data-testid="confirm-cancel"]'
    ).first();
    if (await confirmCancelBtn.isVisible({ timeout: 3000 })) {
      await confirmCancelBtn.click();
      await delay(3000);
    }

    // Get refund info
    const refundEl = p.locator(
      '[class*="refund"], [data-testid="refund-amount"]'
    ).first();
    const refundAmount = await refundEl.isVisible({ timeout: 2000 })
      ? await refundEl.textContent()
      : undefined;

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      message: `Reservation ${params.recordLocator} has been cancelled.`,
      refundAmount: refundAmount?.trim() || undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}

// ─── Check In ─────────────────────────────────────────────────────────────────

export async function checkIn(params: {
  recordLocator: string;
  lastName: string;
}): Promise<{
  success: boolean;
  passengers: string[];
  message: string;
  boardingPassAvailable?: boolean;
}> {
  const p = await getPage();

  const checkInUrl = `${AA_BASE_URL}/checkin/find-reservations.do`;
  await p.goto(checkInUrl, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT,
  });
  await dismissOverlays(p);
  await delay(1000);

  try {
    const codeInput = p.locator(
      'input[name*="confirmationNumber"], input[name*="recordLocator"], input[placeholder*="confirmation"], #confirmationNumber'
    ).first();
    await codeInput.fill(params.recordLocator.toUpperCase());

    const lastNameInput = p.locator(
      'input[name*="lastName"], #lastName, input[placeholder*="last name"]'
    ).first();
    await lastNameInput.fill(params.lastName);

    const submitBtn = p.locator(
      'button[type="submit"], button:has-text("Find"), button:has-text("Check in")'
    ).first();
    await submitBtn.click();
    await delay(3000);

    // Check for check-in button
    const checkInBtn = p.locator(
      'button:has-text("Check in"), button:has-text("Check-in"), [data-testid="check-in-button"]'
    ).first();

    if (await checkInBtn.isVisible({ timeout: 5000 })) {
      await checkInBtn.click();
      await delay(3000);
    }

    // Gather passenger names
    const passengers = await p.evaluate(() => {
      const els = document.querySelectorAll(
        '[class*="passenger"], [data-testid="passenger"]'
      );
      return Array.from(els)
        .map((el) => {
          const nameEl = el.querySelector('[class*="name"]');
          return nameEl ? (nameEl as HTMLElement).innerText.trim() : "";
        })
        .filter(Boolean);
    });

    const boardingPassBtn = p.locator(
      'button:has-text("Boarding pass"), a:has-text("Boarding pass")'
    ).first();
    const boardingPassAvailable = await boardingPassBtn.isVisible({
      timeout: 2000,
    });

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      passengers,
      boardingPassAvailable,
      message: boardingPassAvailable
        ? "Checked in successfully. Use get_boarding_pass to retrieve boarding passes."
        : "Check-in initiated. Check your email for boarding pass.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, passengers: [], message: msg };
  }
}

// ─── Get Boarding Pass ────────────────────────────────────────────────────────

export async function getBoardingPass(params: {
  recordLocator: string;
  lastName: string;
}): Promise<BoardingPass[]> {
  const p = await getPage();

  // Check if we're already at the boarding pass step
  const bpSelectors = [
    '[class*="boardingPass"], [class*="boarding-pass"]',
    '[data-testid="boarding-pass"]',
    'a:has-text("Boarding pass")',
  ];

  let onBPPage = false;
  for (const sel of bpSelectors) {
    if (await p.locator(sel).isVisible({ timeout: 1000 })) {
      onBPPage = true;
      break;
    }
  }

  if (!onBPPage) {
    // Navigate through check-in first
    await checkIn({
      recordLocator: params.recordLocator,
      lastName: params.lastName,
    });
  }

  // Click boarding pass link if present
  try {
    const bpLink = p.locator(
      'a:has-text("View boarding pass"), button:has-text("View boarding pass"), button:has-text("Boarding pass")'
    ).first();
    if (await bpLink.isVisible({ timeout: 3000 })) {
      await bpLink.click();
      await delay(2000);
    }
  } catch {
    // proceed
  }

  const passes = await p.evaluate(() => {
    const passEls = document.querySelectorAll(
      '[class*="boardingPass"], [class*="boarding-pass"], [data-testid="boarding-pass"]'
    );

    if (passEls.length === 0) {
      // Try to extract from current page
      const getText = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? (el as HTMLElement).innerText.trim() : "";
      };

      return [
        {
          passenger: getText('[class*="passengerName"], [class*="passenger-name"]'),
          flightNumber: getText('[class*="flightNumber"]'),
          origin: getText('[class*="origin"]'),
          destination: getText('[class*="destination"]'),
          date: getText('[class*="date"]'),
          boardingTime: getText('[class*="boardingTime"], [class*="boarding-time"]') || undefined,
          departureTime: getText('[class*="departureTime"]'),
          gate: getText('[class*="gate"]') || undefined,
          seat: getText('[class*="seat"]') || undefined,
          group: getText('[class*="boardingGroup"], [class*="group"]') || undefined,
          url: window.location.href,
        },
      ];
    }

    return Array.from(passEls).map((pass) => {
      const getElText = (sel: string) => {
        const el = pass.querySelector(sel);
        return el ? (el as HTMLElement).innerText.trim() : "";
      };
      return {
        passenger: getElText('[class*="name"]'),
        flightNumber: getElText('[class*="flightNumber"]'),
        origin: getElText('[class*="origin"]'),
        destination: getElText('[class*="destination"]'),
        date: getElText('[class*="date"]'),
        boardingTime: getElText('[class*="boardingTime"]') || undefined,
        departureTime: getElText('[class*="departureTime"]'),
        gate: getElText('[class*="gate"]') || undefined,
        seat: getElText('[class*="seat"]') || undefined,
        group: getElText('[class*="boardingGroup"]') || undefined,
        url: window.location.href,
      };
    });
  });

  return passes;
}

// ─── AAdvantage ───────────────────────────────────────────────────────────────

export async function getAAdvantage(): Promise<AAdvantageInfo> {
  const p = await getPage();

  await p.goto(`${AA_BASE_URL}/aadvantage-program/account-summary`, {
    waitUntil: "domcontentloaded",
    timeout: DEFAULT_TIMEOUT,
  });
  await dismissOverlays(p);
  await delay(1500);

  // Check if login required
  const loginBtn = p.locator('a:has-text("Log in"), button:has-text("Log in"), [data-testid="login"]').first();
  if (await loginBtn.isVisible({ timeout: 2000 })) {
    throw new Error("Must be logged in to view AAdvantage account. Use login first.");
  }

  const info = await p.evaluate(() => {
    const getText = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? (el as HTMLElement).innerText.trim() : "";
    };

    const milestones: Array<{ name: string; progress: string }> = [];
    const milestoneEls = document.querySelectorAll(
      '[class*="milestone"], [class*="progress-tracker"]'
    );
    for (const el of Array.from(milestoneEls)) {
      const name = (el.querySelector('[class*="milestoneName"], [class*="name"]') as HTMLElement)?.innerText?.trim();
      const progress = (el.querySelector('[class*="progress"], [class*="value"]') as HTMLElement)?.innerText?.trim();
      if (name) milestones.push({ name, progress: progress || "" });
    }

    return {
      memberNumber:
        getText('[class*="memberNumber"], [class*="member-number"], [data-testid="member-number"]') ||
        getText('[class*="aadvantageNumber"]') ||
        undefined,
      name:
        getText('[class*="memberName"], [class*="member-name"]') || undefined,
      tier:
        getText('[class*="eliteStatus"], [class*="elite-status"], [class*="tier"]') ||
        undefined,
      totalMiles:
        getText('[class*="totalMiles"], [class*="total-miles"], [data-testid="total-miles"]') ||
        undefined,
      eliteMiles:
        getText('[class*="eliteQualifyingMiles"], [class*="eqm"]') ||
        undefined,
      eliteSegments:
        getText('[class*="eliteQualifyingSegments"], [class*="eqs"]') ||
        undefined,
      expirationDate:
        getText('[class*="milesExpiration"], [class*="expiration"]') ||
        undefined,
      milestones: milestones.length > 0 ? milestones : undefined,
    };
  });

  return info;
}

// ─── Upgrade Request ──────────────────────────────────────────────────────────

export async function upgradeRequest(params: {
  recordLocator: string;
  flightNumber: string;
  upgradeType?: string;
}): Promise<{
  success: boolean;
  message: string;
  upgradeEligible?: boolean;
  waitlistPosition?: string;
  milesRequired?: string;
}> {
  const p = await getPage();

  try {
    // Navigate to my trips / reservation
    await getReservation({ recordLocator: params.recordLocator });

    // Look for upgrade option
    const upgradeBtn = p.locator(
      'a:has-text("Upgrade"), button:has-text("Request upgrade"), button:has-text("Use miles to upgrade"), [data-testid="upgrade"]'
    ).first();

    if (!(await upgradeBtn.isVisible({ timeout: 3000 }))) {
      return {
        success: false,
        upgradeEligible: false,
        message: `No upgrade option found for flight ${params.flightNumber}. Upgrades may not be available for this fare class or flight.`,
      };
    }

    await upgradeBtn.click();
    await delay(2000);

    // Gather upgrade details
    const upgradeInfo = await p.evaluate(() => {
      const getText = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? (el as HTMLElement).innerText.trim() : "";
      };
      return {
        waitlistPosition:
          getText('[class*="waitlistPosition"], [class*="waitlist-position"]') ||
          undefined,
        milesRequired:
          getText('[class*="milesRequired"], [class*="miles-needed"]') ||
          undefined,
      };
    });

    const ctx = await getContext();
    await saveCookies(ctx);

    return {
      success: true,
      upgradeEligible: true,
      message: `Upgrade request placed for flight ${params.flightNumber}.`,
      ...upgradeInfo,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg };
  }
}
