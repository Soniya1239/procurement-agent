// Deterministic budget optimizer
// Uses plain code (not LLM) to select best bundle under budget

/**
 * Choose the best plan from available quotes
 * Implements deterministic brute-force optimization
 */
export function choosePlan(parsed, quotes) {
  const minRating = parsed.minRating || 3.5;
  const rejected = [];
  
  // Filter quotes by stock and rating
  const validQuotes = quotes.filter(quote => {
    if (!quote.stockOk) {
      rejected.push({ sku: quote.sku, reason: 'low stock' });
      return false;
    }
    if (quote.rating < minRating) {
      rejected.push({ sku: quote.sku, reason: 'low rating' });
      return false;
    }
    return true;
  });

  // Group quotes by category
  const quotesByCategory = {};
  for (const quote of validQuotes) {
    if (!quotesByCategory[quote.category]) {
      quotesByCategory[quote.category] = [];
    }
    quotesByCategory[quote.category].push(quote);
  }

  // Generate all combinations (one SKU per category)
  const combinations = [];
  const categories = parsed.items.map(item => item.category);
  
  function generateCombination(index, currentCombination) {
    if (index >= categories.length) {
      if (currentCombination.length > 0) {
        combinations.push([...currentCombination]);
      }
      return;
    }

    const category = categories[index];
    const categoryQuotes = quotesByCategory[category] || [];

    for (const quote of categoryQuotes) {
      currentCombination.push(quote);
      generateCombination(index + 1, currentCombination);
      currentCombination.pop();
    }
  }

  generateCombination(0, []);

  // Evaluate each combination
  const evaluated = combinations.map(combination => {
    const itemsTotalCents = Math.round(combination.reduce((sum, q) => sum + q.lineTotal, 0) * 100);
    
    // Calculate shipping (once per distinct vendor)
    const distinctVendors = new Set(combination.map(q => q.vendor));
    const shippingCents = Math.round(Array.from(distinctVendors).reduce((sum, vendor) => {
      const vendorQuote = combination.find(q => q.vendor === vendor);
      return sum + (vendorQuote?.shipping || 0);
    }, 0) * 100);
    
    const grandTotalCents = itemsTotalCents + shippingCents;
    const avgRating = combination.reduce((sum, q) => sum + q.rating, 0) / combination.length;
    
    // Get keyboard rating for tie-breaking
    const keyboardItem = combination.find(i => i.category === 'mechanical_keyboard');
    const keyboardRating = keyboardItem ? keyboardItem.rating : 0;

    return {
      items: combination,
      itemsTotal: itemsTotalCents / 100,
      shipping: shippingCents / 100,
      grandTotal: grandTotalCents / 100,
      grandTotalCents,
      avgRating,
      keyboardRating,
      vendors: Array.from(distinctVendors)
    };
  });

  // Filter by budget
  const withinBudget = evaluated.filter(e => e.grandTotal <= parsed.budget);
  const overBudget = evaluated.filter(e => e.grandTotal > parsed.budget);
  
  // Add over budget items to rejected (only if item's own total exceeds budget)
  for (const combo of overBudget) {
    for (const item of combo.items) {
      const itemTotal = item.lineTotal + item.shipping;
      if (itemTotal > parsed.budget && !rejected.find(r => r.sku === item.sku)) {
        rejected.push({ sku: item.sku, reason: "Doesn't fit bundle budget" });
      }
    }
  }

  // If no valid combinations, return clear error
  if (withinBudget.length === 0) {
    return {
      best: null,
      alternatives: [],
      rejected,
      error: 'No valid bundle found within budget'
    };
  }

  // Sort by: highest average rating first, then lowest grandTotal (using cents to avoid floating-point noise), then higher keyboard rating
  withinBudget.sort((a, b) => {
    if (b.avgRating !== a.avgRating) {
      return b.avgRating - a.avgRating;
    }
    if (a.grandTotalCents !== b.grandTotalCents) {
      return a.grandTotalCents - b.grandTotalCents;
    }
    return b.keyboardRating - a.keyboardRating;
  });

  const best = withinBudget[0];
  const alternatives = withinBudget.slice(1, 4); // Top 3 alternatives

  // Build accurate rejected list: exclude selected items, use accurate reasons
  const selectedSkus = new Set(best.items.map(i => i.sku));
  const accurateRejected = [];
  
  // Add stock/rating rejections
  for (const rej of rejected) {
    if (!selectedSkus.has(rej.sku)) {
      accurateRejected.push(rej);
    }
  }
  
  // Add items not in best bundle with accurate reasons
  for (const quote of validQuotes) {
    if (!selectedSkus.has(quote.sku)) {
      // Check if already rejected for stock/rating/over budget
      if (!accurateRejected.find(r => r.sku === quote.sku)) {
        // Find the selected item in the same category
        const selectedItemInCategory = best.items.find(i => i.category === quote.category);
        if (selectedItemInCategory) {
          if (quote.rating < selectedItemInCategory.rating) {
            accurateRejected.push({ sku: quote.sku, reason: 'Lower rating than the selected option' });
          } else {
            accurateRejected.push({ sku: quote.sku, reason: 'Not in the best bundle' });
          }
        } else {
          accurateRejected.push({ sku: quote.sku, reason: 'Not in the best bundle' });
        }
      }
    }
  }

  return {
    best,
    alternatives,
    rejected: accurateRejected
  };
}
