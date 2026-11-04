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
    const itemsTotal = combination.reduce((sum, q) => sum + q.lineTotal, 0);
    
    // Calculate shipping (once per distinct vendor)
    const distinctVendors = new Set(combination.map(q => q.vendor));
    const shipping = Array.from(distinctVendors).reduce((sum, vendor) => {
      const vendorQuote = combination.find(q => q.vendor === vendor);
      return sum + (vendorQuote?.shipping || 0);
    }, 0);
    
    const grandTotal = itemsTotal + shipping;
    const avgRating = combination.reduce((sum, q) => sum + q.rating, 0) / combination.length;

    return {
      items: combination,
      itemsTotal,
      shipping,
      grandTotal,
      avgRating,
      vendors: Array.from(distinctVendors)
    };
  });

  // Filter by budget
  const withinBudget = evaluated.filter(e => e.grandTotal <= parsed.budget);
  const overBudget = evaluated.filter(e => e.grandTotal > parsed.budget);
  
  // Add over budget items to rejected
  for (const combo of overBudget) {
    for (const item of combo.items) {
      if (!rejected.find(r => r.sku === item.sku)) {
        rejected.push({ sku: item.sku, reason: 'over budget' });
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

  // Sort by: highest average rating first, then lowest grandTotal
  withinBudget.sort((a, b) => {
    if (b.avgRating !== a.avgRating) {
      return b.avgRating - a.avgRating;
    }
    return a.grandTotal - b.grandTotal;
  });

  const best = withinBudget[0];
  const alternatives = withinBudget.slice(1, 4); // Top 3 alternatives

  return {
    best,
    alternatives,
    rejected
  };
}
