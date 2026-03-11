# @striderlabs/mcp-american

MCP server for American Airlines — let AI agents search flights, manage bookings, check in, retrieve boarding passes, and access AAdvantage rewards on aa.com via Playwright browser automation.

Built by [Strider Labs](https://striderlabs.ai).

## Features

- **Flight Search** — Search AA flights by origin, destination, dates, and cabin class
- **Flight Details** — Get connection info, aircraft type, baggage policy, and fare rules
- **Flight Selection** — Select outbound and return flights into a booking session
- **Seat Maps** — View available seats including Main Cabin Extra, Preferred, and First Class
- **Seat Selection** — Choose specific seats by seat number
- **Baggage** — Add checked bags to a booking
- **Checkout** — Complete bookings with a confirmation gate
- **Reservations** — Look up existing reservations by record locator
- **Modify Trips** — Initiate flight changes on existing bookings
- **Cancellations** — Cancel reservations with a confirmation gate
- **Check-In** — Online check-in starting 24 hours before departure
- **Boarding Passes** — Retrieve digital boarding passes after check-in
- **AAdvantage** — Check miles balance, elite status, and earning milestones
- **Upgrades** — Request upgrades using miles, systemwide certificates, or elite status

## Installation

```bash
npm install -g @striderlabs/mcp-american
npx playwright install chromium
```

Or run directly with npx:

```bash
npx @striderlabs/mcp-american
```

## Claude Desktop Setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "american": {
      "command": "npx",
      "args": ["-y", "@striderlabs/mcp-american"]
    }
  }
}
```

Config file locations:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

## Authentication

This server uses browser automation and stores session cookies locally. To authenticate:

1. Call the `login` tool — it opens aa.com in a browser window
2. Log in manually with your AAdvantage credentials
3. Call `status` to verify and save the session

Sessions are saved to `~/.striderlabs/american/` and reused across invocations. You typically only need to log in once until the session expires.

## Tools

| Tool | Description |
|------|-------------|
| `status` | Check login status and session info |
| `login` | Open aa.com for manual login |
| `logout` | Clear saved session and cookies |
| `search_flights` | Search AA flights by route, date, cabin |
| `get_flight_details` | Get detailed info on a search result |
| `select_flight` | Choose outbound/return flight for booking |
| `get_seat_map` | View available seats and fees |
| `select_seats` | Choose seats by seat number |
| `add_bags` | Add checked baggage |
| `checkout` | Complete booking (requires `confirm: true`) |
| `get_reservation` | Look up reservation by record locator |
| `modify_trip` | Change flights on existing reservation |
| `cancel_trip` | Cancel reservation (requires `confirm: true`) |
| `check_in` | Online check-in (opens 24h before departure) |
| `get_boarding_pass` | Retrieve digital boarding passes |
| `get_aadvantage` | Check miles, elite status, milestones |
| `upgrade_request` | Request upgrade using miles or elite status |

## Example Workflow

```
User: Search for flights from DFW to JFK next Friday

Agent:
1. search_flights { origin: "DFW", destination: "JFK", departureDate: "2025-07-11" }
2. get_flight_details { flightId: "0" }
3. select_flight { outboundFlightId: "0" }
4. get_seat_map {}
5. select_seats { seats: ["14A"] }
6. add_bags { bags: 1 }
7. checkout {}  → preview
8. checkout { confirm: true }  → booking confirmed
```

## Safety Gates

Destructive or financial actions require explicit confirmation:

- **`checkout`** — pass `confirm: true` only after user confirms the purchase
- **`cancel_trip`** — pass `confirm: true` only after user confirms the cancellation

Without `confirm: true`, these tools return a preview instead of taking action.

## Environment Variables

Optional — credentials can be provided via environment variables for automated workflows:

| Variable | Description |
|----------|-------------|
| `AA_USERNAME` | AAdvantage number or email |
| `AA_PASSWORD` | Account password |

When set, the server will attempt auto-login on first use.

## Session Storage

Cookies and session info are stored at:

```
~/.striderlabs/american/
├── cookies.json    # Browser session cookies
└── session.json    # Account info cache
```

To reset authentication: call `logout` or delete this directory.

## Development

```bash
git clone https://github.com/markswendsen-code/mcp-american
cd mcp-american
npm install
npx playwright install chromium
npm run build
npm start
```

## License

MIT — Strider Labs
