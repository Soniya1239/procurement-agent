import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createOrder, captureOrder, getAccessToken } from './paypal.js';
import { processProcurementRequest } from './agent.js';
import { getQuote } from './mcpClient.js';

// Startup check for required environment variables
const requiredEnvVars = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_BASE_URL', 'LLM_API_KEY', 'APP_BASE_URL'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`  - ${varName}`));
  console.error('\nPlease create a .env file with these variables. See .env.example for reference.');
  process.exit(1);
}

console.log('✅ All required environment variables are set');
const llmKeyLoaded = !!process.env.LLM_API_KEY;
console.log(`🔑 LLM key loaded: ${llmKeyLoaded}, length: ${process.env.LLM_API_KEY?.length || 0}`);
console.log(`🤖 Using Gemini model: ${process.env.LLM_MODEL || 'gemini-1.5-flash (default)'}`);

// In-memory order log
const orders = [];

// In-memory duplicate request protection (plan fingerprint -> timestamp)
const recentCheckoutRequests = new Map();
const DUPLICATE_WINDOW_MS = 5000; // 5 seconds

// Generate a simple fingerprint of a plan for duplicate detection
function planFingerprint(plan) {
  if (!plan?.best?.items) return '';
  const items = plan.best.items.map(i => `${i.sku}:${i.quantity}`).sort().join('|');
  return items;
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.APP_BASE_URL || 'http://localhost:5173'
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Capture order endpoint
app.post('/api/capture/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Check if order is already captured (idempotency)
    const existingOrder = orders.find(o => o.orderId === orderId && o.status === 'COMPLETED');
    if (existingOrder) {
      console.log(`Order ${orderId} already captured, returning stored result`);
      return res.json(existingOrder);
    }
    
    const result = await captureOrder(orderId);
    
    // Update order status in history
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    if (orderIndex !== -1) {
      orders[orderIndex].status = 'COMPLETED';
      orders[orderIndex].capturedAt = new Date().toISOString();
      orders[orderIndex].captureResult = result;
      
      // Extract payer info from PayPal response
      if (result.purchase_units?.[0]?.payments?.captures?.[0]) {
        const capture = result.purchase_units[0].payments.captures[0];
        orders[orderIndex].captureId = capture.id;
        orders[orderIndex].amountPaid = capture.amount?.value;
      }
      
      if (result.payer?.name) {
        orders[orderIndex].payerName = `${result.payer.name.given_name} ${result.payer.name.surname}`;
      }
      if (result.payer?.email_address) {
        orders[orderIndex].payerEmail = result.payer.email_address;
      }
      
      // Return the full order record with capture details
      return res.json(orders[orderIndex]);
    }
    
    // If order not found in our records, still return the PayPal result
    res.json(result);
  } catch (error) {
    console.error('Capture order error:', error.message);
    
    // Check if it's a PayPal "already captured" error
    const errorMessage = error.message || '';
    if (errorMessage.includes('ORDER_ALREADY_CAPTURED') || errorMessage.includes('already been captured')) {
      console.log(`Order ${orderId} already captured in PayPal, fetching details`);
      
      // Try to fetch order details from PayPal
      try {
        const token = await getAccessToken();
        const orderResponse = await fetch(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${req.params.orderId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (orderResponse.ok) {
          const orderDetails = await orderResponse.json();
          
          // Find and update our order record
          const orderIndex = orders.findIndex(o => o.orderId === req.params.orderId);
          if (orderIndex !== -1) {
            orders[orderIndex].status = 'COMPLETED';
            orders[orderIndex].capturedAt = new Date().toISOString();
            orders[orderIndex].captureResult = orderDetails;
            
            if (orderDetails.purchase_units?.[0]?.payments?.captures?.[0]) {
              const capture = orderDetails.purchase_units[0].payments.captures[0];
              orders[orderIndex].captureId = capture.id;
              orders[orderIndex].amountPaid = capture.amount?.value;
            }
            
            if (orderDetails.payer?.name) {
              orders[orderIndex].payerName = `${orderDetails.payer.name.given_name} ${orderDetails.payer.name.surname}`;
            }
            if (orderDetails.payer?.email_address) {
              orders[orderIndex].payerEmail = orderDetails.payer.email_address;
            }
            
            return res.json(orders[orderIndex]);
          }
          
          return res.json(orderDetails);
        }
      } catch (fetchError) {
        console.error('Failed to fetch order details after already-captured error:', fetchError.message);
      }
    }
    
    res.status(500).json({ error: `Failed to capture order: ${error.message}` });
  }
});

// Plan endpoint - parses command and gathers quotes
app.post('/api/plan', async (req, res) => {
  try {
    const { command, useSampleData } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    
    const result = await processProcurementRequest(command, useSampleData);
    res.json(result);
  } catch (error) {
    console.error('Plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Checkout endpoint - validates plan and creates PayPal order
app.post('/api/checkout', async (req, res) => {
  try {
    const { plan } = req.body;
    
    if (!plan || !plan.best) {
      return res.status(400).json({ error: 'Valid plan is required' });
    }

    // Check for duplicate requests within the window
    const fingerprint = planFingerprint(plan);
    const now = Date.now();
    const lastRequestTime = recentCheckoutRequests.get(fingerprint);
    
    if (lastRequestTime && (now - lastRequestTime < DUPLICATE_WINDOW_MS)) {
      console.log('Duplicate checkout request detected, rejecting');
      return res.status(429).json({ error: 'Please wait before creating another order' });
    }
    
    recentCheckoutRequests.set(fingerprint, now);

    // Server-side validation: recompute totals from catalog
    const validatedItems = [];
    let itemsTotalCents = 0;
    const distinctVendors = new Set();

    for (const item of plan.best.items) {
      try {
        // Get fresh quote from catalog to validate price and stock
        const quote = await getQuote({ sku: item.sku, quantity: item.quantity });
        
        // Validate price matches (within small tolerance for floating point)
        const expectedPriceCents = Math.round(item.unitPrice * 100);
        const actualPriceCents = Math.round(quote.unitPrice * 100);
        
        if (Math.abs(expectedPriceCents - actualPriceCents) > 1) {
          throw new Error(`Price mismatch for ${item.sku}: expected $${item.unitPrice}, got $${quote.unitPrice}`);
        }

        validatedItems.push({
          name: item.name,
          vendor: item.vendor,
          quantity: item.quantity,
          unit_amount_cents: actualPriceCents
        });

        itemsTotalCents += actualPriceCents * item.quantity;
        distinctVendors.add(item.vendor);
      } catch (error) {
        return res.status(400).json({ error: `Validation failed for ${item.sku}: ${error.message}` });
      }
    }

    // Calculate shipping (once per distinct vendor)
    let shippingCents = 0;
    for (const vendor of distinctVendors) {
      const vendorItem = plan.best.items.find(i => i.vendor === vendor);
      if (vendorItem) {
        shippingCents += Math.round(vendorItem.shipping * 100);
      }
    }

    const totalCents = itemsTotalCents + shippingCents;

    // Create PayPal order
    const paypalResult = await createOrder({
      items: validatedItems,
      total: totalCents,
      shipping: shippingCents
    });

    // Log order for history
    const orderRecord = {
      orderId: paypalResult.orderId,
      items: validatedItems,
      itemsTotal: itemsTotalCents / 100,
      shipping: shippingCents / 100,
      grandTotal: totalCents / 100,
      vendors: Array.from(distinctVendors),
      status: 'CREATED',
      createdAt: new Date().toISOString()
    };
    orders.push(orderRecord);

    res.json({
      approveUrl: paypalResult.approveUrl,
      orderId: paypalResult.orderId
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get orders endpoint - returns order history
app.get('/api/orders', (req, res) => {
  res.json(orders);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
