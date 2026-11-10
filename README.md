# ProcureAI

An autonomous procurement agent built for the PayPal AI Hackathon 2026. ProcureAI helps small business owners and office managers save hours by automating vendor price comparisons, shipping calculations, and rating evaluations across multiple approved vendors.

Live demo: https://procurement-agent-hxhy.onrender.com

Demo video: (coming soon)

**Note**: Runs on a free Render plan, so the first load can take up to 50 seconds. PayPal SANDBOX mode only—test payments, no real money.

## Try It in 60 Seconds

1. Open the live demo link above (first load may take up to 50 seconds)
2. Click the first example chip ("Mechanical keyboards + mice")
3. Click "Find Best Bundle"
4. Review the "Why This Bundle?" section
5. Click "Approve & Pay"
6. Log in with the sandbox buyer email and password from the Devpost testing notes
7. See the receipt with capture ID

## The Problem

Small businesses lose countless hours manually comparing vendor prices, calculating shipping costs, and evaluating product ratings when purchasing office supplies. When buying from multiple approved vendors, the complexity grows exponentially—finding the optimal combination that stays within budget while maximizing quality is a tedious, error-prone process done by hand.

## Who It's For

- Small business owners purchasing office equipment
- Office managers managing procurement across multiple vendors
- Anyone who needs to optimize purchasing decisions within budget constraints

## Key Features

- **Natural Language Parsing**: Describe what you need in plain English (e.g., "We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice"). Powered by Google Gemini with a regex-based fallback parser for reliability.
- **Vendor Quote Fetching**: Automatically gathers quotes from multiple approved vendors via MCP, comparing price, shipping, rating, and availability.
- **Budget Optimizer**: Deterministic brute-force algorithm evaluates all combinations to find the best bundle under your budget, maximizing value while respecting constraints.
- **Trade-off Analysis**: Compares the selected bundle against the cheapest valid bundle, showing the extra cost for the extra rating gained.
- **AI Agent Insight**: AI-generated explanations of why the selected bundle was chosen, with fallback to template-based explanations.
- **Vendor Price Comparison**: Side-by-side comparison of vendor offerings with color-coded pricing.
- **Candidate Quotes Grid**: Interactive data grid with sorting, filtering, "Group by vendor" toggle, and CSV export.
- **"Why This Bundle?"**: Shows top 3 alternatives with tie-breaking logic and rejected options with reasons ("Lower rating than the selected option", "Not in the best bundle", "Doesn't fit bundle budget").
- **Human Approval Step**: Review the selected bundle, compare alternatives, and approve before committing to purchase.
- **PayPal Orders API Checkout**: Secure payment flow through PayPal's test environment with order creation and capture.
- **Order Receipt**: Detailed confirmation with capture ID, payer info, and itemized breakdown.
- **"This Order" Summary**: Shows the order just completed with status and a copy button for the capture ID.
- **Use Sample Data Mode**: Toggle to skip LLM command parsing and use preset requests. The explanation still calls Gemini for AI-generated insights (or falls back to template if unavailable).

## How It Works

1. **Ask**: Enter your procurement needs in natural language with your budget (e.g., "We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice").
2. **Compare Quotes**: The system parses your request, fetches quotes from approved vendors, and runs the optimizer to find the best bundle under budget.
3. **Approve**: Review the selected bundle, compare alternatives, and approve the purchase.
4. **Pay**: Redirect to PayPal Sandbox to complete the test payment.

## PayPal APIs Used

- **PayPal Orders API v2**: 
  - `/v2/checkout/orders` - Create payment orders with itemized breakdown
  - `/v2/checkout/orders/{id}/capture` - Capture approved payments
  - `/v1/oauth2/token` - OAuth2 authentication for API access
- **Sandbox Environment**: All payments use test money only (no real transactions)

## AI Model Usage

- **Google Gemini**: Used for two purposes:
  1. **Command Parsing**: Converts natural language to structured JSON (budget, items, quantities, ratings)
  2. **Explanation Generation**: Creates plain-English explanations of why a bundle was chosen
- **Fallback Mechanism**: If the AI is rate-limited or unavailable, regex-based parsing and template-based explanations ensure the system remains functional
- **Models**: Primary model is `gemini-3.5-flash` with `gemini-flash-latest` as fallback

## Tech Stack

### Backend (Node.js)
- **Express**: Web server and REST API
- **@google/genai**: Google Gemini AI SDK
- **@modelcontextprotocol/sdk**: MCP client for vendor catalog integration
- **zod**: Schema validation for LLM outputs
- **dotenv**: Environment variable management
- **cors**: Cross-origin resource sharing

### Frontend (React)
- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **React Router DOM**: Client-side routing
- **AG Grid**: Data grid for quote comparison with sorting, filtering, and CSV export

## Project Structure

```
procurement-agent/
├── client/                 # React frontend
│   ├── src/
│   │   ├── App.jsx        # Main React component
│   │   ├── App.css        # Component styles
│   │   ├── main.jsx       # React entry point
│   │   └── orderHistory.js # Order history utility
│   ├── package.json
│   └── vite.config.js
├── server/                # Node.js backend
│   ├── src/
│   │   ├── agent.js      # LLM parsing and orchestration
│   │   ├── optimizer.js  # Bundle optimization algorithm
│   │   ├── index.js      # Express server and API routes
│   │   ├── paypal.js     # PayPal API integration
│   │   └── mcpClient.js  # MCP client for vendor catalog
│   ├── mcp/
│   │   ├── vendorServer.js  # MCP vendor catalog server
│   │   └── catalog.json     # Mock vendor data
│   ├── data/
│   │   └── orders.json    # Order storage (local file)
│   ├── .env.example
│   └── package.json
├── package.json           # Root package with convenience scripts
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 18 or higher
- npm
- PayPal Developer account (for Sandbox credentials)
- Google Gemini API key (optional—regex/template fallback available)

### Installation

1. **Clone the repository** and navigate to the project root

2. **Install all dependencies** (root script):
   ```bash
   npm run install:all
   ```

   Or install separately:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

### Configure environment

Create `server/.env` from the template:

```bash
cd server
cp .env.example .env
```

Edit `.env` with your credentials (see [Environment Variables](#environment-variables) below).

### Running Locally

1. **Start the server** (Terminal 1):
   ```bash
   cd server
   npm run dev
   ```
   Server runs on `http://localhost:3001`

2. **Start the client** (Terminal 2):
   ```bash
   cd client
   npm run dev
   ```
   Frontend runs on `http://localhost:5173`

3. **Open browser** to `http://localhost:5173`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAYPAL_CLIENT_ID` | PayPal Sandbox client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox client secret |
| `PAYPAL_BASE_URL` | PayPal API base URL (Sandbox) - example: `https://api-m.sandbox.paypal.com` |
| `GEMINI_API_KEY` | Google Gemini API key (LLM_API_KEY is also accepted as an alias) |
| `GEMINI_PRIMARY_MODEL` | Primary AI model for parsing and explanations (default: `gemini-3.5-flash`) |
| `GEMINI_FALLBACK_MODEL` | Fallback AI model if primary is rate-limited (default: `gemini-flash-latest`) |
| `APP_BASE_URL` | Frontend URL for CORS (must match your deployment URL) |
| `PORT` | Server port (Render sets this automatically) |
| `NODE_ENV` | Environment (development or production) |

## Deployment

### Render

1. **Create a new Web Service** on Render with the following settings:
   - **Build Command**: `npm run install:all --include=dev && npm run build`
   - **Start Command**: `npm start`
   - **Root Directory**: `/` (project root)

2. **Set Environment Variables** in the Render dashboard:
   - All variables from [Environment Variables](#environment-variables) above
   - **Important**: Set `APP_BASE_URL` to your Render service URL (e.g., `https://your-app.onrender.com`)
   - Set `NODE_ENV=production`
   - Set `NPM_CONFIG_PRODUCTION=false` (required for devDependencies on Render)

3. **Deploy**: Render will automatically build and deploy your application.

**Note**: The free Render plan has a cold start time (up to 50 seconds for the first request). The server sleeps after inactivity and wakes up on the next request.

## Testing the PayPal Sandbox

To test the payment flow, you'll need PayPal Sandbox credentials:

- **Sandbox buyer email**: `<see Devpost testing notes>`
- **Sandbox buyer password**: `<see Devpost testing notes>`

All payments use test money only—no real transactions are processed.

## Example Commands to Try

Click the example chips in the UI or try these commands:

- "We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice from our approved vendors."
- "Need 5 wireless mice with a $200 budget from approved vendors."
- "Looking for 5 mechanical keyboards under $300 total from approved vendors."

## Limitations

- **PayPal Sandbox Only**: All payments use test money. No real transactions are processed.
- **Demo Vendor Catalog**: The vendor data is mock data with fictional vendors (TechNova, KeyCraft Supply, OfficeHub). In production, this would connect to real vendor APIs.
- **Free Hosting Sleep**: On the free Render plan, the server sleeps after inactivity, causing a cold start delay (up to 50 seconds) for the first request.
- **Local File Storage**: Orders are stored in a local JSON file (`server/data/orders.json`). This file resets on Render redeploys and after sleep periods. Not suitable for production deployments with multiple instances.

## Security

- Never commit real API keys, client IDs, or secrets to version control. Use environment variables.
- The `.env` file is gitignored. Use `.env.example` as a template for required variables.
- PayPal Sandbox credentials are for testing only. Never use production credentials in this demo.
- Card details are entered on PayPal, never on this site. API keys stay on the server.

## Troubleshooting

**EADDRINUSE error on port 3001**
- Port 3001 is already in use. Kill the process or change the PORT environment variable:
  ```bash
  # Windows (PowerShell)
  netstat -ano | findstr :3001
  taskkill /PID <PID> /F

  # Or set a different port (PowerShell)
  $env:PORT=3002; npm start
  ```

**"vite: not found" error on Render**
- Add `NPM_CONFIG_PRODUCTION=false` to your Render environment variables to include devDependencies during the build.

## License

MIT License - see [LICENSE](LICENSE) file for details.
