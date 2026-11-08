# ProcureAI

An autonomous procurement agent built for the PayPal AI Hackathon 2026. ProcureAI helps small business owners and office managers save hours by automating vendor price comparisons, shipping calculations, and rating evaluations across multiple approved vendors.

## The Problem

Small businesses lose countless hours manually comparing vendor prices, calculating shipping costs, and evaluating product ratings when purchasing office supplies. When buying from multiple approved vendors, the complexity grows exponentially—finding the optimal combination that stays within budget while maximizing quality is a tedious, error-prone process done by hand.

## Who It's For

- Small business owners purchasing office equipment
- Office managers managing procurement across multiple vendors
- Anyone who needs to optimize purchasing decisions within budget constraints

## Key Features

- **Natural Language Commands**: Describe what you need in plain English (e.g., "We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice")
- **Vendor Quote Comparison**: Automatically gathers quotes from multiple approved vendors, comparing price, shipping, rating and availability
- **Budget Optimizer**: Deterministic algorithm finds the best bundle under your budget, maximizing value while respecting constraints
- **"Why This Bundle?" Explanation**: AI-generated insights explain why the selected bundle was chosen, with alternatives and rejected items clearly displayed
- **AI Insight with Fallback**: Uses Google Gemini for intelligent parsing and explanations, with regex-based fallbacks if the AI is unavailable
- **Human Approval**: Review the selected bundle and quotes before committing to purchase
- **PayPal Sandbox Checkout**: Secure payment flow through PayPal's test environment
- **Order Receipt**: Detailed confirmation with capture ID, payer info, and itemized breakdown
- **CSV Export**: Export quote data for further analysis

## How It Works

1. **Command**: Enter your procurement needs in natural language with your budget
2. **AI Parsing**: The LLM extracts budget, item categories, quantities, and optional rating requirements
3. **Quote Gathering**: Queries vendor catalogs via MCP to get real-time pricing and availability
4. **Optimization**: A deterministic brute-force algorithm evaluates all combinations to find the best bundle under budget
5. **Explanation**: AI generates a clear explanation of why this bundle was chosen
6. **Human Review**: You review the selected bundle, compare alternatives, and approve or modify
7. **Payment**: Redirect to PayPal Sandbox to complete the purchase
8. **Receipt**: View order confirmation with full details

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

## Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- PayPal Developer account (for Sandbox credentials)
- Google Gemini API key

### Installation

1. **Clone the repository** and navigate to the project root

2. **Install server dependencies**:
   ```bash
   cd server
   npm install
   ```

3. **Install client dependencies**:
   ```bash
   cd ../client
   npm install
   ```

### Environment Variables

Create `server/.env` from the template:

```bash
cd server
cp .env.example .env
```

Edit `.env` with your credentials (see [Environment Variables](#environment-variables) below).

### Running the Application

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

| Variable | Description | Example |
|----------|-------------|---------|
| `PAYPAL_CLIENT_ID` | PayPal Sandbox client ID | `AXxxxxxxxxxxxxxxxxxxxxxx` |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox client secret | `EKxxxxxxxxxxxxxxxxxxxxxx` |
| `PAYPAL_BASE_URL` | PayPal API base URL | `https://api-m.sandbox.paypal.com` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIxxxxxxxxxxxxxxxxxxxxxx` |
| `GEMINI_PRIMARY_MODEL` | Primary AI model | `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODEL` | Fallback AI model | `gemini-flash-latest` |
| `APP_BASE_URL` | Frontend URL for CORS | `http://localhost:5173` |
| `PORT` | Server port | `3001` |

**Note**: The `LLM_API_KEY` variable is also accepted as an alias for `GEMINI_API_KEY`.

## Important Notes

- **PayPal Sandbox**: All payments use test money only. No real transactions are processed. You'll need a PayPal Sandbox buyer account for testing.
- **Testing the payment**: Use a PayPal Sandbox buyer account (test credentials are provided in the Devpost submission). No real money is used.
- **Demo Vendor Data**: The vendor catalog uses mock data with fictional vendors (TechNova, KeyCraft Supply, OfficeHub) for demonstration purposes. In production, this would connect to real vendor APIs.
- **Sample Data Mode**: Toggle "Use sample data" in the UI to skip LLM parsing and use pre-configured demo data for testing without an API key.

## Links

- **Demo Video**: [ADD LINK]
- **Live Demo**: [ADD LINK]

## License

MIT License - see [LICENSE](LICENSE) file for details.
