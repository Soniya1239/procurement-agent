// PayPal Orders API integration
// Handles order creation and checkout flow

let cachedToken = null;
let tokenExpiry = null;

// Format amount to 2 decimal places (using cents to avoid floating point issues)
function formatAmount(cents) {
  return (cents / 100).toFixed(2);
}

// Get PayPal access token with caching
export async function getAccessToken() {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch(`${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('PayPal token error:', error);
    throw new Error(`Failed to get PayPal access token: ${response.status} ${error}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  // Cache token until it expires (expires_in is in seconds)
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  
  return cachedToken;
}

// Create PayPal order
export async function createOrder({ items, total, shipping, currency = 'USD' }) {
  const token = await getAccessToken();

  // Build item list with properly formatted amounts
  const paypalItems = items.map(item => ({
    name: item.name,
    quantity: item.quantity.toString(),
    unit_amount: {
      currency_code: currency,
      value: formatAmount(item.unit_amount_cents)
    }
  }));

  // Calculate item total in cents
  const itemTotalCents = items.reduce((sum, item) => 
    sum + (item.unit_amount_cents * item.quantity), 0
  );

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: {
        currency_code: currency,
        value: formatAmount(total),
        breakdown: {
          item_total: {
            currency_code: currency,
            value: formatAmount(itemTotalCents)
          },
          shipping: {
            currency_code: currency,
            value: formatAmount(shipping)
          }
        }
      },
      items: paypalItems
    }],
    application_context: {
      return_url: `${process.env.APP_BASE_URL}/success`,
      cancel_url: `${process.env.APP_BASE_URL}/cancel`,
      user_action: 'PAY_NOW',
      payment_source: {
        experience: {
          user_action: 'PAY_NOW'
        }
      }
    }
  };

  console.log('PayPal create order payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('PayPal create order error:', error);
    throw new Error(`Failed to create PayPal order: ${response.status} ${error}`);
  }

  const data = await response.json();
  
  // Extract approve URL from links
  const approveLink = data.links?.find(link => 
    link.rel === 'payer-action' || link.rel === 'approve'
  );

  return {
    orderId: data.id,
    approveUrl: approveLink?.href || null
  };
}

// Capture PayPal order
export async function captureOrder(orderId) {
  const token = await getAccessToken();

  const response = await fetch(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('PayPal capture order error:', error);
    throw new Error(`Failed to capture PayPal order: ${response.status} ${error}`);
  }

  return response.json();
}
