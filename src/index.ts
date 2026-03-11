#!/usr/bin/env node

/**
 * Strider Labs American Airlines MCP Server
 *
 * MCP server that gives AI agents the ability to search flights, manage
 * bookings, check in, retrieve boarding passes, and access AAdvantage
 * rewards on aa.com via browser automation.
 * https://striderlabs.ai
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  checkLoginStatus,
  initiateLogin,
  searchFlights,
  getFlightDetails,
  selectFlight,
  getSeatMap,
  selectSeats,
  addBags,
  checkout,
  getReservation,
  modifyTrip,
  cancelTrip,
  checkIn,
  getBoardingPass,
  getAAdvantage,
  upgradeRequest,
  closeBrowser,
} from "./browser.js";
import { loadSessionInfo, clearAuthData, getConfigDir } from "./auth.js";

// Initialize server
const server = new Server(
  {
    name: "strider-american",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "status",
        description:
          "Check American Airlines login status and AAdvantage session info. Use this to verify authentication before performing other actions.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "login",
        description:
          "Initiate American Airlines login flow. Opens aa.com so the user can log in manually with their AAdvantage credentials. After logging in, call status to verify and save the session.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "logout",
        description:
          "Clear saved American Airlines session and cookies. Use this to log out or reset authentication state.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_flights",
        description:
          "Search for flights on American Airlines (aa.com). Returns flight options with flight numbers, times, stops, aircraft, and fares.",
        inputSchema: {
          type: "object",
          properties: {
            origin: {
              type: "string",
              description:
                "Origin airport code (e.g., 'DFW', 'LAX', 'JFK')",
            },
            destination: {
              type: "string",
              description:
                "Destination airport code (e.g., 'ORD', 'MIA', 'LHR')",
            },
            departureDate: {
              type: "string",
              description:
                "Departure date in YYYY-MM-DD format (e.g., '2025-07-01')",
            },
            returnDate: {
              type: "string",
              description:
                "Return date in YYYY-MM-DD format for round trips. Omit for one-way.",
            },
            adults: {
              type: "number",
              description: "Number of adult passengers (default: 1)",
            },
            children: {
              type: "number",
              description: "Number of child passengers (default: 0)",
            },
            cabinClass: {
              type: "string",
              enum: ["coach", "premium economy", "business", "first"],
              description: "Cabin class (default: 'coach')",
            },
            maxResults: {
              type: "number",
              description:
                "Maximum number of results to return (default: 10, max: 50)",
            },
          },
          required: ["origin", "destination", "departureDate"],
        },
      },
      {
        name: "get_flight_details",
        description:
          "Get detailed information about a specific flight from search results, including connection info, aircraft type, baggage policy, and fare rules.",
        inputSchema: {
          type: "object",
          properties: {
            flightId: {
              type: "string",
              description:
                "Flight result ID from search_flights (e.g., '0', '1', '2')",
            },
          },
          required: ["flightId"],
        },
      },
      {
        name: "select_flight",
        description:
          "Select an outbound (and optionally a return) flight after searching. This adds the flight to your booking session.",
        inputSchema: {
          type: "object",
          properties: {
            outboundFlightId: {
              type: "string",
              description:
                "ID of the outbound flight from search_flights results",
            },
            returnFlightId: {
              type: "string",
              description:
                "ID of the return flight for round trips. Omit for one-way.",
            },
          },
          required: ["outboundFlightId"],
        },
      },
      {
        name: "get_seat_map",
        description:
          "View the seat map for the selected flight showing available and occupied seats, seat types (Main Cabin Extra, Preferred, First), and fees.",
        inputSchema: {
          type: "object",
          properties: {
            flightNumber: {
              type: "string",
              description:
                "Optional flight number to retrieve seat map for (e.g., 'AA123')",
            },
          },
        },
      },
      {
        name: "select_seats",
        description:
          "Choose seats for passengers on the selected flight. Use get_seat_map first to see available seats.",
        inputSchema: {
          type: "object",
          properties: {
            seats: {
              type: "array",
              items: { type: "string" },
              description:
                "List of seat numbers to select (e.g., ['14A', '14B'])",
            },
            flightNumber: {
              type: "string",
              description: "Optional flight number for multi-segment trips",
            },
          },
          required: ["seats"],
        },
      },
      {
        name: "add_bags",
        description:
          "Add checked baggage to the booking. AA charges per bag per segment.",
        inputSchema: {
          type: "object",
          properties: {
            bags: {
              type: "number",
              description: "Number of checked bags to add (1 or 2)",
            },
            passenger: {
              type: "string",
              description:
                "Passenger name if adding bags for a specific traveler in a group booking",
            },
          },
          required: ["bags"],
        },
      },
      {
        name: "checkout",
        description:
          "Complete the American Airlines booking. IMPORTANT: Set confirm=true only after getting explicit user confirmation. Without confirm=true returns a preview.",
        inputSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              description:
                "Set to true to actually complete the booking. If false or omitted, returns a preview only. NEVER set to true without explicit user confirmation.",
            },
          },
        },
      },
      {
        name: "get_reservation",
        description:
          "Look up an existing American Airlines reservation by record locator (confirmation code).",
        inputSchema: {
          type: "object",
          properties: {
            recordLocator: {
              type: "string",
              description:
                "The 6-character confirmation/record locator code (e.g., 'ABC123')",
            },
            lastName: {
              type: "string",
              description:
                "Passenger last name (required for unauthenticated lookups)",
            },
          },
          required: ["recordLocator"],
        },
      },
      {
        name: "modify_trip",
        description:
          "Change flights on an existing American Airlines reservation. Initiates the flight change flow — use search_flights to find new options.",
        inputSchema: {
          type: "object",
          properties: {
            recordLocator: {
              type: "string",
              description: "The 6-character confirmation code (e.g., 'ABC123')",
            },
            lastName: {
              type: "string",
              description: "Passenger last name",
            },
            newDepartureDate: {
              type: "string",
              description: "New departure date in YYYY-MM-DD format",
            },
            newReturnDate: {
              type: "string",
              description: "New return date in YYYY-MM-DD format (round trips)",
            },
          },
          required: ["recordLocator"],
        },
      },
      {
        name: "cancel_trip",
        description:
          "Cancel an American Airlines reservation. IMPORTANT: Set confirm=true only after explicit user confirmation. Without confirm=true returns a preview.",
        inputSchema: {
          type: "object",
          properties: {
            recordLocator: {
              type: "string",
              description: "The 6-character confirmation code (e.g., 'ABC123')",
            },
            lastName: {
              type: "string",
              description: "Passenger last name",
            },
            confirm: {
              type: "boolean",
              description:
                "Set to true to actually cancel. If false or omitted, returns a preview only. NEVER set to true without explicit user confirmation.",
            },
          },
          required: ["recordLocator"],
        },
      },
      {
        name: "check_in",
        description:
          "Complete online check-in for an American Airlines flight. Available starting 24 hours before departure.",
        inputSchema: {
          type: "object",
          properties: {
            recordLocator: {
              type: "string",
              description: "The 6-character confirmation code (e.g., 'ABC123')",
            },
            lastName: {
              type: "string",
              description: "Passenger last name",
            },
          },
          required: ["recordLocator", "lastName"],
        },
      },
      {
        name: "get_boarding_pass",
        description:
          "Retrieve digital boarding passes for a checked-in flight. Requires prior check-in.",
        inputSchema: {
          type: "object",
          properties: {
            recordLocator: {
              type: "string",
              description: "The 6-character confirmation code (e.g., 'ABC123')",
            },
            lastName: {
              type: "string",
              description: "Passenger last name",
            },
          },
          required: ["recordLocator", "lastName"],
        },
      },
      {
        name: "get_aadvantage",
        description:
          "Check AAdvantage miles balance, elite status, and account summary. Requires being logged in.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "upgrade_request",
        description:
          "Request an upgrade on an American Airlines flight using miles or elite status. Returns eligibility and waitlist position if available.",
        inputSchema: {
          type: "object",
          properties: {
            recordLocator: {
              type: "string",
              description: "The 6-character confirmation code (e.g., 'ABC123')",
            },
            flightNumber: {
              type: "string",
              description: "Flight number to request upgrade for (e.g., 'AA201')",
            },
            upgradeType: {
              type: "string",
              enum: ["miles", "systemwide", "500-mile", "complimentary"],
              description:
                "Type of upgrade to request (default: system determines best available)",
            },
          },
          required: ["recordLocator", "flightNumber"],
        },
      },
    ],
  };
});

// Tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "status": {
        const sessionInfo = loadSessionInfo();
        const liveStatus = await checkLoginStatus();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  session: liveStatus,
                  savedSession: sessionInfo,
                  configDir: getConfigDir(),
                  message: liveStatus.isLoggedIn
                    ? `Logged in${
                        liveStatus.userName
                          ? ` as ${liveStatus.userName}`
                          : liveStatus.userEmail
                          ? ` as ${liveStatus.userEmail}`
                          : ""
                      }`
                    : "Not logged in. Use login to authenticate.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "login": {
        const result = await initiateLogin();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  ...result,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "logout": {
        clearAuthData();
        await closeBrowser();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Logged out. Session and cookies cleared.",
              }),
            },
          ],
        };
      }

      case "search_flights": {
        const {
          origin,
          destination,
          departureDate,
          returnDate,
          adults,
          children,
          cabinClass,
          maxResults = 10,
        } = args as {
          origin: string;
          destination: string;
          departureDate: string;
          returnDate?: string;
          adults?: number;
          children?: number;
          cabinClass?: string;
          maxResults?: number;
        };

        const flights = await searchFlights({
          origin,
          destination,
          departureDate,
          returnDate,
          adults,
          children,
          cabinClass,
          maxResults: Math.min(maxResults, 50),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  origin: origin.toUpperCase(),
                  destination: destination.toUpperCase(),
                  departureDate,
                  returnDate,
                  tripType: returnDate ? "roundTrip" : "oneWay",
                  count: flights.length,
                  flights,
                  nextStep:
                    flights.length > 0
                      ? "Use get_flight_details for more info, or select_flight to choose a flight."
                      : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_flight_details": {
        const { flightId } = args as { flightId: string };
        const details = await getFlightDetails(flightId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, details }, null, 2),
            },
          ],
        };
      }

      case "select_flight": {
        const { outboundFlightId, returnFlightId } = args as {
          outboundFlightId: string;
          returnFlightId?: string;
        };

        const result = await selectFlight({ outboundFlightId, returnFlightId });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case "get_seat_map": {
        const { flightNumber } = (args as { flightNumber?: string }) || {};
        const seatMap = await getSeatMap(flightNumber);

        // Summarize for readability
        const summary = {
          flightNumber: seatMap.flightNumber,
          aircraft: seatMap.aircraft,
          cabins: seatMap.cabins.map((c) => ({
            name: c.name,
            totalSeats: c.rows.reduce((acc, r) => acc + r.seats.length, 0),
            availableSeats: c.rows.reduce(
              (acc, r) => acc + r.seats.filter((s) => s.available).length,
              0
            ),
            rows: c.rows,
          })),
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, seatMap: summary }, null, 2),
            },
          ],
        };
      }

      case "select_seats": {
        const { seats, flightNumber } = args as {
          seats: string[];
          flightNumber?: string;
        };

        const result = await selectSeats({ seats, flightNumber });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case "add_bags": {
        const { bags, passenger } = args as {
          bags: number;
          passenger?: string;
        };

        const result = await addBags({ bags, passenger });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case "checkout": {
        const { confirm = false } = (args as { confirm?: boolean }) || {};
        const result = await checkout({ confirm });

        if ("requiresConfirmation" in result) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    requiresConfirmation: result.requiresConfirmation,
                    preview: result.preview,
                    note: "Call checkout with confirm=true to complete booking. IMPORTANT: Only do this after getting explicit user confirmation.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  confirmationNumber: result.confirmationNumber,
                  recordLocator: result.recordLocator,
                  message: result.message,
                },
                null,
                2
              ),
            },
          ],
          isError: !result.success,
        };
      }

      case "get_reservation": {
        const { recordLocator, lastName } = args as {
          recordLocator: string;
          lastName?: string;
        };

        const reservation = await getReservation({ recordLocator, lastName });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  reservation,
                  flightCount: reservation.flights.length,
                  passengerCount: reservation.passengers.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "modify_trip": {
        const { recordLocator, lastName, newDepartureDate, newReturnDate } =
          args as {
            recordLocator: string;
            lastName?: string;
            newDepartureDate?: string;
            newReturnDate?: string;
          };

        const result = await modifyTrip({
          recordLocator,
          lastName,
          newDepartureDate,
          newReturnDate,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case "cancel_trip": {
        const { recordLocator, lastName, confirm = false } = args as {
          recordLocator: string;
          lastName?: string;
          confirm?: boolean;
        };

        const result = await cancelTrip({ recordLocator, lastName, confirm });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...result,
                  ...(confirm
                    ? {}
                    : {
                        note: "Call cancel_trip with confirm=true to proceed. IMPORTANT: Only after explicit user confirmation.",
                      }),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "check_in": {
        const { recordLocator, lastName } = args as {
          recordLocator: string;
          lastName: string;
        };

        const result = await checkIn({ recordLocator, lastName });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case "get_boarding_pass": {
        const { recordLocator, lastName } = args as {
          recordLocator: string;
          lastName: string;
        };

        const passes = await getBoardingPass({ recordLocator, lastName });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  count: passes.length,
                  boardingPasses: passes,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_aadvantage": {
        const info = await getAAdvantage();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  aadvantage: info,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "upgrade_request": {
        const { recordLocator, flightNumber, upgradeType } = args as {
          recordLocator: string;
          flightNumber: string;
          upgradeType?: string;
        };

        const result = await upgradeRequest({
          recordLocator,
          flightNumber,
          upgradeType,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result }, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`,
              }),
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: errorMessage,
              suggestion: errorMessage.toLowerCase().includes("login") ||
                errorMessage.toLowerCase().includes("auth") ||
                errorMessage.toLowerCase().includes("sign in")
                ? "Try running login to authenticate with your AAdvantage credentials."
                : errorMessage.toLowerCase().includes("captcha")
                ? "CAPTCHA encountered. Try again in a moment or use a different network."
                : errorMessage.toLowerCase().includes("timeout")
                ? "The page took too long to load. Try again."
                : errorMessage.toLowerCase().includes("not found")
                ? "The resource was not found. Verify the record locator or flight ID."
                : undefined,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Cleanup on server close
server.onclose = async () => {
  await closeBrowser();
};

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Strider American Airlines MCP server running");
  console.error(`Config directory: ${getConfigDir()}`);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
