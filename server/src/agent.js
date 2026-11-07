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
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  return new GoogleGenAI({ apiKey });
}

function getPrimaryModel() {
  return process.env.GEMINI_PRIMARY_MODEL || 'gemini-3.5-flash';
}

function getFallbackModel() {
  return process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest';
}

// In-memory cache for explanations (only for real LLM responses)
const explanationCache = new Map();

function getCacheKey(prompt, bundle) {
  const bundleKey = bundle?.items?.map(i => `${i.sku}:${i.quantity}`).join('|') || '';
  return `${prompt}:${bundleKey}`;
}

// Track 429 errors to skip models for 30 minutes
const modelSkipUntil = new Map(); // model -> timestamp

function isModelSkipped(model) {
  const skipUntil = modelSkipUntil.get(model);
  if (!skipUntil) return false;
  if (Date.now() > skipUntil) {
    modelSkipUntil.delete(model);
    return false;
  }
  return true;
}

function skipModelFor30Minutes(model) {
  const skipUntil = Date.now() + (30 * 60 * 1000); // 30 minutes
  modelSkipUntil.set(model, skipUntil);
  console.log(`Skipping ${model} for 30 minutes due to 429 quota error`);
}

// Call LLM with hard 7 second timeout (abort controller)
async function callLLMWithTimeout(model, systemPrompt, userMessage, config = {}) {
  const ai = getGeminiClient();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000); // 7 second hard timeout
  
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ text: systemPrompt }, { text: userMessage }],
      config,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response.text;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError' || error.message?.includes('abort')) {
      throw new Error('Request timeout (7s)');
    }
    throw error;
  }
}

// Retry logic with exponential backoff and jitter (only for 503/500)
async function retryWithBackoff(fn, maxRetries = 2) {
  const delays = [1000, 2000]; // 1s, 2s (max 2 retries)
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = error.message?.includes('503') || 
                         error.message?.includes('UNAVAILABLE') ||
                         error.message?.includes('500') ||
                         error.message?.includes('INTERNAL');
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const delay = delays[attempt] + Math.random() * 200; // Add jitter
      console.log(`LLM retry ${attempt + 1}/${maxRetries + 1} in ${Math.round(delay)}ms`);
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
  minRating: z.number().min(1).max(5).nullable().optional()
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

// Display name mapping for log messages (user-friendly)
const DISPLAY_NAME_MAP = {
  'mechanical_keyboard': 'mechanical keyboards',
  'wireless_mouse': 'wireless mice'
};

function getDisplayName(category) {
  return DISPLAY_NAME_MAP[category] || category.replace(/_/g, ' ');
}

/**
 * Parse user command using LLM
 * Converts natural language to structured JSON with zod validation
 */
export async function parseCommand(text, useSampleData = false, onStep) {
  const steps = [];
  const emitStep = (step) => {
    steps.push(step);
    if (onStep) onStep(step);
  };

  // Sample data fallback for demo purposes
  if (useSampleData) {
    emitStep('Using sample data (skipping LLM)');
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
    emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (sample data)`);
    return { parsed: validated, steps, usedFallback: true };
  }

  emitStep('Parsing command with LLM');

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
    return await callLLMWithTimeout(model, systemPrompt, text, { responseMimeType: 'application/json' });
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

    const validated = ParsedCommandSchema.parse(parsed);
    
    // Convert null minRating to 0
    if (validated.minRating === null || validated.minRating === undefined) {
      validated.minRating = 0;
    }
    
    return validated;
  };

  const callWithRetry = async (model) => {
    try {
      return await callLLM(model);
    } catch (error) {
      // Don't retry on validation errors - they're not transient
      if (error.message?.includes('ZodError') || error.message?.includes('validation')) {
        throw error;
      }
      throw error;
    }
  };

  const startTime = Date.now();
  const primaryModel = getPrimaryModel();
  const fallbackModel = getFallbackModel();

  // Hard 8-second timeout for entire parsing step
  const parseWithTimeout = new Promise(async (resolve, reject) => {
    try {
      // Check if primary model is skipped due to 429
      if (isModelSkipped(primaryModel)) {
        console.log(`Primary model ${primaryModel} is skipped due to 429, trying fallback`);
        emitStep('Primary AI model rate-limited, trying backup');
      } else {
        // Try primary model once (7s timeout)
        emitStep('Parsing command with LLM');
        const content = await callLLM(primaryModel);
        const validated = processResponse(content);
        emitStep('LLM response received');
        emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types`);
        return resolve({ parsed: validated, steps, usedFallback: false });
      }

      // Try fallback model once (8s timeout)
      try {
        // Check if fallback model is skipped due to 429
        if (isModelSkipped(fallbackModel)) {
          console.log(`Fallback model ${fallbackModel} is skipped due to 429, using regex parser`);
          emitStep('Backup AI model rate-limited, using fallback parser');
        } else {
          emitStep('Using backup AI model...');
          const content = await callLLM(fallbackModel);
          const validated = processResponse(content);
          emitStep('Fallback model succeeded');
          emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (fallback)`);
          return resolve({ parsed: validated, steps, usedFallback: true });
        }
      } catch (fallbackError) {
        const is429 = fallbackError.message?.includes('429') || fallbackError.message?.includes('RESOURCE_EXHAUSTED');
        const is404 = fallbackError.message?.includes('404') || fallbackError.message?.includes('NOT_FOUND');
        const isValidation = fallbackError.message?.includes('ZodError') || fallbackError.message?.includes('validation');
        const isTimeout = fallbackError.message?.includes('timeout') || fallbackError.message?.includes('abort');

        if (is429) {
          skipModelFor30Minutes(fallbackModel);
          console.log('LLM fallback 429 quota exceeded, using regex parser');
        } else if (is404) {
          console.log('LLM fallback 404 model not found, using regex parser');
        } else if (isValidation) {
          console.log('LLM fallback validation failed, using regex parser');
        } else if (isTimeout) {
          console.log('LLM fallback timeout (8s), using regex parser');
        } else {
          console.log(`LLM fallback failed: ${fallbackError.message}`);
        }

        // Use regex-based parser as final fallback
        console.log('parse source: regex-fallback');
        emitStep('parse source: regex-fallback');
        const fallbackParsed = parseWithRegex(text);
        const validated = ParsedCommandSchema.parse(fallbackParsed);

        // Convert null minRating to 0
        if (validated.minRating === null || validated.minRating === undefined) {
          validated.minRating = 0;
        }

        emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (regex fallback)`);
        return resolve({ parsed: validated, steps, usedFallback: true });
      }
    } catch (primaryError) {
      const is429 = primaryError.message?.includes('429') || primaryError.message?.includes('RESOURCE_EXHAUSTED');
      const is404 = primaryError.message?.includes('404') || primaryError.message?.includes('NOT_FOUND');
      const isValidation = primaryError.message?.includes('ZodError') || primaryError.message?.includes('validation');
      const isTimeout = primaryError.message?.includes('timeout') || primaryError.message?.includes('abort');

      if (is429) {
        skipModelFor30Minutes(primaryModel);
        console.log('LLM 429 quota exceeded, skipping to fallback');
      } else if (is404) {
        console.log('LLM 404 model not found, skipping to fallback');
      } else if (isValidation) {
        console.log('LLM validation failed, skipping to fallback');
      } else if (isTimeout) {
        console.log('LLM primary timeout (8s), skipping to fallback');
      } else {
        console.log(`LLM primary failed: ${primaryError.message}`);
      }

      emitStep(`AI model busy, trying backup`);

      // Try fallback model once (8s timeout)
      try {
        // Check if fallback model is skipped due to 429
        if (isModelSkipped(fallbackModel)) {
          console.log(`Fallback model ${fallbackModel} is skipped due to 429, using regex parser`);
          emitStep('Backup AI model rate-limited, using fallback parser');
        } else {
          emitStep('Using backup AI model...');
          const content = await callLLM(fallbackModel);
          const validated = processResponse(content);
          emitStep('Fallback model succeeded');
          emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (fallback)`);
          return resolve({ parsed: validated, steps, usedFallback: true });
        }
      } catch (fallbackError) {
        const totalElapsed = Date.now() - startTime;
        const is429 = fallbackError.message?.includes('429') || fallbackError.message?.includes('RESOURCE_EXHAUSTED');
        const is404 = fallbackError.message?.includes('404') || fallbackError.message?.includes('NOT_FOUND');
        const isValidation = fallbackError.message?.includes('ZodError') || fallbackError.message?.includes('validation');
        const isTimeout = fallbackError.message?.includes('timeout') || fallbackError.message?.includes('abort');

        if (is429) {
          skipModelFor30Minutes(fallbackModel);
          console.log('LLM fallback 429 quota exceeded, using regex parser');
        } else if (is404) {
          console.log('LLM fallback 404 model not found, using regex parser');
        } else if (isValidation) {
          console.log('LLM fallback validation failed, using regex parser');
        } else if (isTimeout) {
          console.log('LLM fallback timeout (8s), using regex parser');
        } else {
          console.log(`LLM fallback failed: ${fallbackError.message}`);
        }

        console.log(`Total parse time: ${totalElapsed}ms`);

        emitStep('LLM slow, using fallback parser');

        // Use regex-based parser as final fallback
        console.log('parse source: regex-fallback');
        emitStep('parse source: regex-fallback');
        const fallbackParsed = parseWithRegex(text);
        const validated = ParsedCommandSchema.parse(fallbackParsed);

        // Convert null minRating to 0
        if (validated.minRating === null || validated.minRating === undefined) {
          validated.minRating = 0;
        }

        emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (regex fallback)`);
        return resolve({ parsed: validated, steps, usedFallback: true });
      }
    }
  });

  // Race with 8-second timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Parse timeout (8s)')), 8000);
  });

  try {
    return await Promise.race([parseWithTimeout, timeoutPromise]);
  } catch (error) {
    if (error.message === 'Parse timeout (8s)') {
      console.log('LLM slow, using fallback parser');
      emitStep('LLM slow, using fallback parser');
      
      // Use regex-based parser as final fallback
      console.log('parse source: regex-fallback');
      emitStep('parse source: regex-fallback');
      const fallbackParsed = parseWithRegex(text);
      const validated = ParsedCommandSchema.parse(fallbackParsed);

      // Convert null minRating to 0
      if (validated.minRating === null || validated.minRating === undefined) {
        validated.minRating = 0;
      }

      emitStep(`Parsed: budget $${validated.budget}, ${validated.items.length} item types (regex fallback)`);
      return { parsed: validated, steps, usedFallback: true };
    }
    throw error;
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
export async function gatherQuotes(parsed, onStep) {
  const steps = [];
  const quotes = [];
  const emitStep = (step) => {
    steps.push(step);
    if (onStep) onStep(step);
  };

  for (const item of parsed.items) {
    emitStep(`Searching for ${getDisplayName(item.category)} (quantity: ${item.quantity})`);

    // Search products with optional minRating filter
    const searchFilters = { category: item.category };
    if (parsed.minRating) {
      searchFilters.minRating = parsed.minRating;
    }

    const products = await searchProducts(searchFilters);
    emitStep(`Found ${products.length} ${getDisplayName(item.category)} options`);

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

        emitStep(`Fetched quote for ${product.name} from ${product.vendor}`);
      } catch (error) {
        // Skip products with insufficient stock
        emitStep(`Skipped ${product.name}: ${error.message}`);
      }
    }
  }

  emitStep(`Gathered ${quotes.length} total quotes`);
  return { quotes, steps };
}

/**
 * Generate explanation using LLM
 * Creates a 2-sentence plain-English explanation of why the bundle was chosen
 */
export async function generateExplanation(plan, parsed) {
  if (!plan || plan.error) {
    return { text: plan?.error || 'No valid bundle found.', explanationSource: 'template' };
  }

  // Check cache (only for real LLM responses)
  const cacheKey = getCacheKey(parsed.budget.toString(), plan.best);
  if (explanationCache.has(cacheKey)) {
    console.log('Explanation cache hit');
    return { text: explanationCache.get(cacheKey), explanationSource: 'cache' };
  }

  const systemPrompt = `You are a procurement assistant. Write a 2-sentence plain-English explanation of why this bundle was chosen.
Use ONLY the provided numbers. Do not change any values. Be concise and factual.`;

  const itemsSummary = plan.best.items.map(item => 
    `${item.quantity}x ${item.name} from ${item.vendor} ($${item.lineTotal.toFixed(2)})`
  ).join(', ');

  const userMessage = `Budget: $${parsed.budget.toFixed(2)}
Selected items: ${itemsSummary}
Items total: $${plan.best.itemsTotal.toFixed(2)}
Shipping: $${plan.best.shipping.toFixed(2)} (from ${plan.best.vendors.length} vendor(s): ${plan.best.vendors.join(', ')})
Grand total: $${plan.best.grandTotal.toFixed(2)}
Average rating: ${plan.best.avgRating.toFixed(2)}/5

Explain why this bundle was chosen in 2 sentences.`;

  const callLLM = async (model) => {
    return await callLLMWithTimeout(model, systemPrompt, userMessage);
  };

  const startTime = Date.now();
  
  try {
    // Try primary model once (8s timeout)
    const explanation = await callLLM(getPrimaryModel());
    explanationCache.set(cacheKey, explanation);
    return { text: explanation, explanationSource: 'llm' };
  } catch (primaryError) {
    const elapsed = Date.now() - startTime;
    const is429 = primaryError.message?.includes('429') || primaryError.message?.includes('RESOURCE_EXHAUSTED');
    const is404 = primaryError.message?.includes('404') || primaryError.message?.includes('NOT_FOUND');
    const isTimeout = primaryError.message?.includes('timeout') || primaryError.message?.includes('abort');
    
    if (is429) {
      console.log('LLM 429 quota exceeded, skipping to fallback');
    } else if (is404) {
      console.log('LLM 404 model not found, skipping to fallback');
    } else if (isTimeout) {
      console.log('LLM primary timeout (8s), skipping to fallback');
    } else {
      console.log(`LLM primary failed: ${primaryError.message}`);
    }
    
    // Try fallback model once (8s timeout)
    try {
      const explanation = await callLLM(getFallbackModel());
      explanationCache.set(cacheKey, explanation);
      return { text: explanation, explanationSource: 'fallback-model' };
    } catch (fallbackError) {
      const totalElapsed = Date.now() - startTime;
      const is429 = fallbackError.message?.includes('429') || fallbackError.message?.includes('RESOURCE_EXHAUSTED');
      const is404 = fallbackError.message?.includes('404') || fallbackError.message?.includes('NOT_FOUND');
      const isTimeout = fallbackError.message?.includes('timeout') || fallbackError.message?.includes('abort');
      
      if (is429) {
        console.log('LLM fallback 429 quota exceeded, using template');
      } else if (is404) {
        console.log('LLM fallback 404 model not found, using template');
      } else if (isTimeout) {
        console.log('LLM fallback timeout (8s), using template');
      } else {
        console.log(`LLM fallback failed: ${fallbackError.message}`);
      }
      
      console.log(`Total explanation time: ${totalElapsed}ms`);
      
      // Use template-based explanation as final fallback (NOT cached)
      const remainingBudget = Math.round((parsed.budget - plan.best.grandTotal) * 100) / 100;
      const templateExplanation = `Selected ${plan.best.items.length} items from ${plan.best.vendors.length} vendor(s) with an average rating of ${plan.best.avgRating.toFixed(2)}/5. Total cost is $${plan.best.grandTotal.toFixed(2)} ($${plan.best.itemsTotal.toFixed(2)} for items + $${plan.best.shipping.toFixed(2)} shipping), leaving $${remainingBudget.toFixed(2)} remaining from the $${parsed.budget.toFixed(2)} budget.`;
      // Do NOT cache template responses
      return { text: templateExplanation, explanationSource: 'template' };
    }
  }
}

/**
 * Process full procurement request
 * Orchestrates parsing, quote gathering, optimization, and explanation
 */
export async function processProcurementRequest(userCommand, useSampleData = false, onStep) {
  const allSteps = [];
  const emitStep = (step) => {
    allSteps.push(step);
    if (onStep) onStep(step);
  };
  let usedFallback = false;
  let explanationSource = 'llm';

  try {
    // Parse command
    const { parsed, steps: parseSteps, usedFallback: parseFallback } = await parseCommand(userCommand, useSampleData, emitStep);
    usedFallback = usedFallback || parseFallback;

    // Gather quotes
    const { quotes, steps: quoteSteps } = await gatherQuotes(parsed, emitStep);

    // Choose best plan
    emitStep('Running optimizer to find best bundle');
    const plan = choosePlan(parsed, quotes);
    emitStep(`Optimizer evaluated ${quotes.length} quotes`);

    if (plan.error) {
      emitStep(`Optimizer: ${plan.error}`);
      return {
        parsed,
        quotes,
        plan,
        steps: allSteps,
        explanation: plan.error,
        explanationSource: 'template',
        usedFallback
      };
    }

    emitStep(`Best bundle found: $${plan.best.grandTotal.toFixed(2)} total, avg rating ${plan.best.avgRating.toFixed(2)}/5`);

    // Generate explanation asynchronously (don't block the response)
    // Return immediately with a placeholder, then update via streaming if possible
    let explanation, source;
    
    // Start explanation generation in background
    const explanationPromise = (async () => {
      try {
        const result = await generateExplanation(plan, parsed);
        return { text: result.text, source: result.explanationSource };
      } catch (error) {
        console.log('Explanation generation failed, using template:', error.message);
        const remainingBudget = Math.round((parsed.budget - plan.best.grandTotal) * 100) / 100;
        return { 
          text: `Selected ${plan.best.items.length} items from ${plan.best.vendors.length} vendor(s) with an average rating of ${plan.best.avgRating.toFixed(2)}/5. Total cost is $${plan.best.grandTotal.toFixed(2)} ($${plan.best.itemsTotal.toFixed(2)} for items + $${plan.best.shipping.toFixed(2)} shipping), leaving $${remainingBudget.toFixed(2)} remaining from the $${parsed.budget.toFixed(2)} budget.`,
          source: 'template'
        };
      }
    })();

    // Return immediately with placeholder explanation
    explanation = 'Loading AI insight...';
    source = 'pending';
    explanationSource = source;

    // Store the promise for later resolution (for streaming endpoint)
    const result = {
      parsed,
      quotes,
      plan,
      explanation,
      explanationSource,
      steps: allSteps,
      usedFallback,
      _explanationPromise: explanationPromise
    };

    return result;
  } catch (error) {
    emitStep(`Error: ${error.message}`);
    throw error;
  }
}
