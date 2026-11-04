// Main agent logic
// Orchestrates the procurement workflow:
// 1. Parse user command using LLM
// 2. Query MCP server for vendor catalogs
// 3. Run optimizer to find best bundle
// 4. Generate explanation using LLM

import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { searchProducts, getQuote } from './mcpClient.js';
import { choosePlan } from './optimizer.js';

// Lazy initialization function for Gemini client
function getGeminiClient() {
  return new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });
}

function getModel() {
  return process.env.LLM_MODEL || 'gemini-1.5-flash';
}

function getFallbackModel() {
  return process.env.LLM_FALLBACK_MODEL || 'gemini-1.5-flash';
}

// Retry logic with exponential backoff and jitter
async function retryWithBackoff(fn, maxRetries = 3) {
  const delays = [1000, 2000, 4000]; // 1s, 2s, 4s
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = error.message?.includes('503') || 
                         error.message?.includes('UNAVAILABLE') ||
                         error.message?.includes('429') ||
                         error.message?.includes('RESOURCE_EXHAUSTED');
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delay = delays[attempt] + Math.random() * 200; // Add jitter
      console.log(`LLM call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Zod schema for parsed command
const ParsedCommandSchema = z.object({
  budget: z.number().positive(),
  currency: z.literal('USD'),
  items: z.array(z.object({
    category: z.enum(['mechanical_keyboard', 'wireless_mouse']),
    quantity: z.number().int().positive()
  })),
  minRating: z.number().min(1).max(5).optional()
});

// Category mapping from natural language to catalog categories
const CATEGORY_MAP = {
  'keyboard': 'mechanical_keyboard',
  'keyboards': 'mechanical_keyboard',
  'mechanical keyboard': 'mechanical_keyboard',
  'mechanical keyboards': 'mechanical_keyboard',
  'mouse': 'wireless_mouse',
  'mice': 'wireless_mouse',
  'wireless mouse': 'wireless_mouse',
  'wireless mice': 'wireless_mouse'
};

/**
 * Parse user command using LLM
 * Converts natural language to structured JSON with zod validation
 */
export async function parseCommand(text, useSampleData = false) {
  const steps = [];
  
  // Sample data fallback for demo purposes
  if (useSampleData) {
    steps.push('Using sample data (skipping LLM)');
    const sampleParsed = {
      budget: 500,
      currency: 'USD',
      items: [
        { category: 'mechanical_keyboard', quantity: 5 },
        { category: 'wireless_mouse', quantity: 5 }
      ],
      minRating: 3.5
    };
    const validated = ParsedCommandSchema.parse(sampleParsed);
    steps.push(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (sample data)`);
    return { parsed: validated, steps, usedFallback: true };
  }

  steps.push('Parsing command with LLM');

  const systemPrompt = `You are a procurement assistant. Parse the user's request into JSON.
Extract:
- budget: total budget amount (number)
- currency: always "USD"
- items: array of objects with category and quantity
- minRating: optional minimum rating (1-5)

Categories must be one of: "mechanical_keyboard" or "wireless_mouse"
Map common terms like "keyboard" to "mechanical_keyboard" and "mouse" to "wireless_mouse".

Return ONLY valid JSON, no other text.`;

  const callLLM = async (model) => {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model,
      contents: [{ text: systemPrompt }, { text: text }],
      config: { responseMimeType: 'application/json' }
    });
    return response.text;
  };

  const processResponse = (content) => {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      throw new Error('LLM returned invalid JSON');
    }

    // Map categories if needed
    if (parsed.items) {
      parsed.items = parsed.items.map(item => ({
        ...item,
        category: CATEGORY_MAP[item.category.toLowerCase()] || item.category
      }));
    }

    return ParsedCommandSchema.parse(parsed);
  };

  try {
    // Try primary model with retries
    const content = await retryWithBackoff(async () => callLLM(getModel()));
    steps.push('LLM response received');
    const validated = processResponse(content);
    steps.push(`Parsed: budget $${validated.budget}, ${validated.items.length} item types`);
    return { parsed: validated, steps, usedFallback: false };
  } catch (primaryError) {
    steps.push(`Primary model failed: ${primaryError.message}`);
    
    // Try fallback model
    try {
      steps.push('Trying fallback model...');
      const content = await retryWithBackoff(async () => callLLM(getFallbackModel()));
      steps.push('Fallback model succeeded');
      const validated = processResponse(content);
      steps.push(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (fallback)`);
      return { parsed: validated, steps, usedFallback: true };
    } catch (fallbackError) {
      steps.push(`Fallback model failed: ${fallbackError.message}`);
      
      // Use regex-based parser as final fallback
      steps.push('LLM unavailable, using fallback parser');
      const fallbackParsed = parseWithRegex(text);
      const validated = ParsedCommandSchema.parse(fallbackParsed);
      steps.push(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (regex fallback)`);
      return { parsed: validated, steps, usedFallback: true };
    }
  }
}

// Regex-based fallback parser
function parseWithRegex(text) {
  const lowerText = text.toLowerCase();
  
  // Extract budget
  const budgetMatch = text.match(/\$?(\d+(?:,\d+)*(?:\.\d+)?)/);
  const budget = budgetMatch ? parseFloat(budgetMatch[1].replace(/,/g, '')) : 500;
  
  // Extract quantities for keyboards
  const keyboardMatch = lowerText.match(/(\d+)\s*(?:mechanical\s*)?keyboard/);
  const keyboardQty = keyboardMatch ? parseInt(keyboardMatch[1]) : 0;
  
  // Extract quantities for mice
  const mouseMatch = lowerText.match(/(\d+)\s*(?:wireless\s*)?(?:mouse|mice)/);
  const mouseQty = mouseMatch ? parseInt(mouseMatch[1]) : 0;
  
  const items = [];
  if (keyboardQty > 0) {
    items.push({ category: 'mechanical_keyboard', quantity: keyboardQty });
  }
  if (mouseQty > 0) {
    items.push({ category: 'wireless_mouse', quantity: mouseQty });
  }
  
  // Fallback to default if no items found
  if (items.length === 0) {
    items.push({ category: 'mechanical_keyboard', quantity: 5 });
    items.push({ category: 'wireless_mouse', quantity: 5 });
  }
  
  return {
    budget,
    currency: 'USD',
    items,
    minRating: 3.5
  };
}

/**
 * Gather quotes for all requested items
 * Searches products and gets quotes for each SKU
 */
export async function gatherQuotes(parsed) {
  const steps = [];
  const quotes = [];

  for (const item of parsed.items) {
    steps.push(`Searching for ${item.category} (quantity: ${item.quantity})`);
    
    // Search products with optional minRating filter
    const searchFilters = { category: item.category };
    if (parsed.minRating) {
      searchFilters.minRating = parsed.minRating;
    }
    
    const products = await searchProducts(searchFilters);
    steps.push(`Found ${products.length} ${item.category} options`);
    
    // Get quote for each product
    for (const product of products) {
      try {
        const quote = await getQuote({ 
          sku: product.sku, 
          quantity: item.quantity 
        });
        
        quotes.push({
          vendor: product.vendor,
          sku: product.sku,
          name: product.name,
          category: product.category,
          unitPrice: product.price,
          quantity: item.quantity,
          lineTotal: quote.lineTotal,
          shipping: quote.shipping,
          stockOk: product.stock >= item.quantity,
          rating: product.rating,
          quoteId: quote.quoteId
        });
        
        steps.push(`Fetched quote for ${product.sku} from ${product.vendor}`);
      } catch (error) {
        // Skip products with insufficient stock
        steps.push(`Skipped ${product.sku}: ${error.message}`);
      }
    }
  }

  steps.push(`Gathered ${quotes.length} total quotes`);
  return { quotes, steps };
}

/**
 * Generate explanation using LLM
 * Creates a 2-sentence plain-English explanation of why the bundle was chosen
 */
export async function generateExplanation(plan, parsed) {
  if (!plan || plan.error) {
    return plan?.error || 'No valid bundle found.';
  }

  const systemPrompt = `You are a procurement assistant. Write a 2-sentence plain-English explanation of why this bundle was chosen.
Use ONLY the provided numbers. Do not change any values. Be concise and factual.`;

  const itemsSummary = plan.best.items.map(item => 
    `${item.quantity}x ${item.name} from ${item.vendor} ($${item.lineTotal.toFixed(2)})`
  ).join(', ');

  const userMessage = `Budget: $${parsed.budget}
Selected items: ${itemsSummary}
Items total: $${plan.best.itemsTotal.toFixed(2)}
Shipping: $${plan.best.shipping.toFixed(2)} (from ${plan.best.vendors.length} vendor(s): ${plan.best.vendors.join(', ')})
Grand total: $${plan.best.grandTotal.toFixed(2)}
Average rating: ${plan.best.avgRating.toFixed(1)}/5

Explain why this bundle was chosen in 2 sentences.`;

  const callLLM = async (model) => {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model,
      contents: [{ text: systemPrompt }, { text: userMessage }]
    });
    return response.text.trim();
  };

  try {
    // Try primary model with retries
    const explanation = await retryWithBackoff(async () => callLLM(getModel()));
    return { text: explanation, usedFallback: false };
  } catch (primaryError) {
    console.error('Primary model failed for explanation:', primaryError.message);
    
    // Try fallback model
    try {
      const explanation = await retryWithBackoff(async () => callLLM(getFallbackModel()));
      return { text: explanation, usedFallback: true };
    } catch (fallbackError) {
      console.error('Fallback model failed for explanation:', fallbackError.message);
      
      // Use template-based explanation as final fallback
      const remainingBudget = parsed.budget - plan.best.grandTotal;
      const templateExplanation = `Selected ${plan.best.items.length} items from ${plan.best.vendors.length} vendor(s) with an average rating of ${plan.best.avgRating.toFixed(1)}/5. Total cost is $${plan.best.grandTotal.toFixed(2)} ($${plan.best.itemsTotal.toFixed(2)} for items + $${plan.best.shipping.toFixed(2)} shipping), leaving $${remainingBudget.toFixed(2)} remaining from the $${parsed.budget} budget.`;
      return { text: templateExplanation, usedFallback: true };
    }
  }
}

/**
 * Process full procurement request
 * Orchestrates parsing, quote gathering, optimization, and explanation
 */
export async function processProcurementRequest(userCommand, useSampleData = false) {
  const allSteps = [];
  let usedFallback = false;
  
  try {
    // Parse command
    const { parsed, steps: parseSteps, usedFallback: parseFallback } = await parseCommand(userCommand, useSampleData);
    allSteps.push(...parseSteps);
    usedFallback = usedFallback || parseFallback;
    
    // Gather quotes
    const { quotes, steps: quoteSteps } = await gatherQuotes(parsed);
    allSteps.push(...quoteSteps);
    
    // Choose best plan
    allSteps.push('Running optimizer to find best bundle');
    const plan = choosePlan(parsed, quotes);
    allSteps.push(`Optimizer evaluated ${quotes.length} quotes`);
    
    if (plan.error) {
      allSteps.push(`Optimizer: ${plan.error}`);
      return {
        parsed,
        quotes,
        plan,
        steps: allSteps,
        explanation: plan.error,
        usedFallback
      };
    }
    
    allSteps.push(`Best bundle found: $${plan.best.grandTotal.toFixed(2)} total, avg rating ${plan.best.avgRating.toFixed(1)}`);
    
    // Generate explanation
    allSteps.push('Generating explanation with LLM');
    const { text: explanation, usedFallback: explanationFallback } = await generateExplanation(plan, parsed);
    allSteps.push('Explanation generated');
    usedFallback = usedFallback || explanationFallback;
    
    return {
      parsed,
      quotes,
      plan,
      explanation,
      steps: allSteps,
      usedFallback
    };
  } catch (error) {
    allSteps.push(`Error: ${error.message}`);
    throw error;
  }
}
