import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createOrder, captureOrder, getAccessToken } from './paypal.js';
import { processProcurementRequest } from './agent.js';
import { getQuote } from './mcpClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load orders from file on startup
let orders = [];
if (fs.existsSync(ORDERS_FILE)) {
  try {
    const data = fs.readFileSync(ORDERS_FILE, 'utf8');
    orders = JSON.parse(data);
    console.log(`Loaded ${orders.length} orders from ${ORDERS_FILE}`);
  } catch (err) {
    console.error('Failed to load orders from file:', err);
    orders = [];
  }
}

// Save orders to file
function saveOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (err) {
    console.error('Failed to save orders to file:', err);
  }
}

// Startup check for required environment variables
const requiredEnvVars = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_BASE_URL', 'GEMINI_API_KEY', 'APP_BASE_URL'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`  - ${varName}`));
  console.error('\nPlease create a .env file with these variables. See .env.example for reference.');
  process.exit(1);
}

console.log('✅ All required environment variables are set');
const geminiKeyLoaded = !!process.env.GEMINI_API_KEY || !!process.env.LLM_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
console.log(`🔑 Gemini key loaded: ${geminiKeyLoaded}, length: ${geminiKey?.length || 0}`);
console.log(`🤖 Primary model: ${process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.5-flash (default)'}`);
console.log(`🤖 Fallback model: ${process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest (default)'}`);

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
  const { orderId } = req.params;
  const clientId = req.headers['x-client-id'];
  
  try {
    // Check if order is already captured (idempotency)
    const existingOrder = orders.find(o => o.orderId === orderId && o.status === 'COMPLETED');
    if (existingOrder) {
      // Return normalized capture response with all required fields
      const normalizedResponse = {
        orderId: existingOrder.orderId,
        captureId: existingOrder.captureId,
        status: existingOrder.status,
        capturedAt: existingOrder.capturedAt,
        grandTotal: existingOrder.grandTotal,
        amountPaid: existingOrder.amountPaid,
        currency: 'USD',
        payerName: existingOrder.payerName,
        payerEmail: existingOrder.payerEmail,
        items: existingOrder.items,
        itemsTotal: existingOrder.itemsTotal,
        shipping: existingOrder.shipping
      };
      return res.json(normalizedResponse);
    }
    
    const result = await captureOrder(orderId);
    
    // Update order status in history
    const orderIndex = orders.findIndex(o => o.orderId === orderId);
    
    if (orderIndex !== -1) {
      // Ensure clientId matches for security
      if (clientId && orders[orderIndex].clientId && orders[orderIndex].clientId !== clientId) {
        console.warn(`ClientId mismatch for order ${orderId}, denying capture`);
        return res.status(403).json({ error: 'Order does not belong to this client' });
      }
      
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
      
      saveOrders();
      
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
        const orderResponse = await fetch(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (orderResponse.ok) {
          const orderDetails = await orderResponse.json();
          
          // Find and update our order record
          const orderIndex = orders.findIndex(o => o.orderId === orderId);
          if (orderIndex !== -1) {
            // Ensure clientId matches for security
            if (clientId && orders[orderIndex].clientId && orders[orderIndex].clientId !== clientId) {
              console.warn(`ClientId mismatch for order ${orderId}, denying capture`);
              return res.status(403).json({ error: 'Order does not belong to this client' });
            }
            
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
            
            saveOrders();
            return res.json(orders[orderIndex]);
          }
          
          return res.json(orderDetails);
        }
      } catch (fetchError) {
        console.error('Failed to fetch order details:', fetchError.message);
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

// Streaming plan endpoint - emits steps as newline-delimited JSON
app.post('/api/agent/stream', async (req, res) => {
  const { command, useSampleData } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  // Set headers for streaming response
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendLine = (data) => {
    res.write(JSON.stringify(data) + '\n');
  };

  try {
    const result = await processProcurementRequest(command, useSampleData, (step) => {
      sendLine({ type: 'step', text: step, time: new Date().toISOString() });
    });

    sendLine({ type: 'result', ...result });
    res.end();
    console.log(`Streaming request completed: ${command.substring(0, 50)}...`);
  } catch (error) {
    sendLine({ type: 'error', message: error.message });
    res.end();
    console.error('Streaming error:', error);
  }
});

// Checkout endpoint - validates plan and creates PayPal order
app.post('/api/checkout', async (req, res) => {
  const clientId = req.headers['x-client-id'];
  try {
    const { plan } = req.body;
    
    if (!plan || !plan.best) {
      return res.status(400).json({ error: 'Valid plan is required' });
    }

    console.log(`Checkout: ${plan.best.items.length} items, total $${plan.best.grandTotal.toFixed(2)}`);

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
      clientId: clientId || null,
      items: validatedItems,
      itemsTotal: Math.round((itemsTotalCents / 100) * 100) / 100,
      shipping: Math.round((shippingCents / 100) * 100) / 100,
      grandTotal: Math.round((totalCents / 100) * 100) / 100,
      vendors: Array.from(distinctVendors),
      status: 'CREATED',
      createdAt: new Date().toISOString()
    };
    orders.push(orderRecord);
    saveOrders();

    res.json({
      approveUrl: paypalResult.approveUrl,
      orderId: paypalResult.orderId
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get orders endpoint - returns order history for client
app.get('/api/orders', (req, res) => {
  const clientId = req.headers['x-client-id'];
  if (!clientId) {
    return res.json([]);
  }
  const clientOrders = orders.filter(order => order.clientId === clientId);
  res.json(clientOrders);
});

// Clear orders endpoint - clears order history for client
app.post('/api/orders/clear', (req, res) => {
  const clientId = req.headers['x-client-id'];
  if (!clientId) {
    return res.json({ success: true, message: 'No client ID provided' });
  }
  // Remove only orders matching this client
  const initialLength = orders.length;
  for (let i = orders.length - 1; i >= 0; i--) {
    if (orders[i].clientId === clientId) {
      orders.splice(i, 1);
    }
  }
  saveOrders();
  res.json({ success: true, message: 'Order history cleared', cleared: initialLength - orders.length });
});

// Serve static files from client/dist in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
  
  // Only serve static files if dist directory exists
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    
    // SPA routing: serve index.html for all non-API routes
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
      }
    });
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
