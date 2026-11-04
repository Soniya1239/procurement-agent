// Unit tests for optimizer
// Tests: normal case, impossible budget, shipping-once-per-vendor rule

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { choosePlan } from './optimizer.js';

describe('Optimizer', () => {
  it('should select best bundle for normal case', () => {
    const parsed = {
      budget: 500,
      items: [
        { category: 'mechanical_keyboard', quantity: 5 },
        { category: 'wireless_mouse', quantity: 5 }
      ],
      minRating: 3.5
    };

    const quotes = [
      // Keyboard options
      {
        vendor: 'TechNova',
        sku: 'TN-KB-001',
        name: 'TechNova Pro',
        category: 'mechanical_keyboard',
        unitPrice: 49.99,
        quantity: 5,
        lineTotal: 249.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.5,
        quoteId: 'Q1'
      },
      {
        vendor: 'OfficeHub',
        sku: 'OH-KB-001',
        name: 'OfficeHub Standard',
        category: 'mechanical_keyboard',
        unitPrice: 39.99,
        quantity: 5,
        lineTotal: 199.95,
        shipping: 7.99,
        stockOk: true,
        rating: 3.8,
        quoteId: 'Q2'
      },
      // Mouse options
      {
        vendor: 'TechNova',
        sku: 'TN-MS-001',
        name: 'TechNova Mouse',
        category: 'wireless_mouse',
        unitPrice: 24.99,
        quantity: 5,
        lineTotal: 124.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.2,
        quoteId: 'Q3'
      },
      {
        vendor: 'OfficeHub',
        sku: 'OH-MS-002',
        name: 'OfficeHub Comfort',
        category: 'wireless_mouse',
        unitPrice: 27.99,
        quantity: 5,
        lineTotal: 139.95,
        shipping: 7.99,
        stockOk: true,
        rating: 4.1,
        quoteId: 'Q4'
      }
    ];

    const result = choosePlan(parsed, quotes);

    assert(result.best !== null, 'Should find a valid bundle');
    assert(result.best.grandTotal <= parsed.budget, 'Best bundle should be within budget');
    assert.strictEqual(result.best.items.length, 2, 'Should have 2 items (1 keyboard + 1 mouse)');
    assert.strictEqual(result.alternatives.length, 3, 'Should have 3 alternatives');
    assert.strictEqual(result.rejected.length, 0, 'Should have no rejections in normal case');
  });

  it('should return clear error for impossible budget', () => {
    const parsed = {
      budget: 100, // Very low budget
      items: [
        { category: 'mechanical_keyboard', quantity: 5 },
        { category: 'wireless_mouse', quantity: 5 }
      ],
      minRating: 3.5
    };

    const quotes = [
      {
        vendor: 'TechNova',
        sku: 'TN-KB-001',
        name: 'TechNova Pro',
        category: 'mechanical_keyboard',
        unitPrice: 49.99,
        quantity: 5,
        lineTotal: 249.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.5,
        quoteId: 'Q1'
      },
      {
        vendor: 'TechNova',
        sku: 'TN-MS-001',
        name: 'TechNova Mouse',
        category: 'wireless_mouse',
        unitPrice: 24.99,
        quantity: 5,
        lineTotal: 124.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.2,
        quoteId: 'Q2'
      }
    ];

    const result = choosePlan(parsed, quotes);

    assert.strictEqual(result.best, null, 'Should have no best bundle');
    assert.strictEqual(result.alternatives.length, 0, 'Should have no alternatives');
    assert.strictEqual(result.error, 'No valid bundle found within budget', 'Should have clear error message');
    assert(result.rejected.length > 0, 'Should have rejected items');
  });

  it('should apply shipping-once-per-vendor rule', () => {
    const parsed = {
      budget: 500,
      items: [
        { category: 'mechanical_keyboard', quantity: 5 },
        { category: 'wireless_mouse', quantity: 5 }
      ],
      minRating: 3.5
    };

    const quotes = [
      // Both items from same vendor (TechNova)
      {
        vendor: 'TechNova',
        sku: 'TN-KB-001',
        name: 'TechNova Pro',
        category: 'mechanical_keyboard',
        unitPrice: 49.99,
        quantity: 5,
        lineTotal: 249.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.5,
        quoteId: 'Q1'
      },
      {
        vendor: 'TechNova',
        sku: 'TN-MS-001',
        name: 'TechNova Mouse',
        category: 'wireless_mouse',
        unitPrice: 24.99,
        quantity: 5,
        lineTotal: 124.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.2,
        quoteId: 'Q2'
      },
      // Items from different vendors
      {
        vendor: 'OfficeHub',
        sku: 'OH-KB-001',
        name: 'OfficeHub Standard',
        category: 'mechanical_keyboard',
        unitPrice: 39.99,
        quantity: 5,
        lineTotal: 199.95,
        shipping: 7.99,
        stockOk: true,
        rating: 3.8,
        quoteId: 'Q3'
      },
      {
        vendor: 'OfficeHub',
        sku: 'OH-MS-002',
        name: 'OfficeHub Comfort',
        category: 'wireless_mouse',
        unitPrice: 27.99,
        quantity: 5,
        lineTotal: 139.95,
        shipping: 7.99,
        stockOk: true,
        rating: 4.1,
        quoteId: 'Q4'
      }
    ];

    const result = choosePlan(parsed, quotes);

    // Find the combination with same vendor
    const sameVendorCombo = result.best?.vendors?.length === 1;
    
    // Calculate expected shipping for same vendor (should be 12.99, not 25.98)
    if (sameVendorCombo) {
      assert.strictEqual(result.best.shipping, 12.99, 'Shipping should be charged once per vendor');
    }

    // Verify all combinations calculate shipping correctly
    for (const combo of [result.best, ...result.alternatives]) {
      if (combo) {
        const distinctVendors = new Set(combo.items.map(q => q.vendor));
        const expectedShipping = Array.from(distinctVendors).reduce((sum, vendor) => {
          const vendorQuote = combo.items.find(q => q.vendor === vendor);
          return sum + (vendorQuote?.shipping || 0);
        }, 0);
        assert.strictEqual(combo.shipping, expectedShipping, `Shipping calculation incorrect for combo with vendors: ${Array.from(distinctVendors).join(', ')}`);
      }
    }
  });

  it('should filter out low stock items', () => {
    const parsed = {
      budget: 500,
      items: [
        { category: 'mechanical_keyboard', quantity: 5 }
      ],
      minRating: 3.5
    };

    const quotes = [
      {
        vendor: 'TechNova',
        sku: 'TN-KB-001',
        name: 'TechNova Pro',
        category: 'mechanical_keyboard',
        unitPrice: 49.99,
        quantity: 5,
        lineTotal: 249.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.5,
        quoteId: 'Q1'
      },
      {
        vendor: 'OfficeHub',
        sku: 'OH-KB-002',
        name: 'OfficeHub Low Stock',
        category: 'mechanical_keyboard',
        unitPrice: 39.99,
        quantity: 5,
        lineTotal: 199.95,
        shipping: 7.99,
        stockOk: false, // Low stock
        rating: 4.0,
        quoteId: 'Q2'
      }
    ];

    const result = choosePlan(parsed, quotes);

    assert(result.best !== null, 'Should find valid bundle');
    assert.strictEqual(result.best.items[0].sku, 'TN-KB-001', 'Should select the in-stock item');
    assert.strictEqual(result.rejected.length, 1, 'Should have one rejected item');
    assert.strictEqual(result.rejected[0].sku, 'OH-KB-002', 'Should reject low stock item');
    assert.strictEqual(result.rejected[0].reason, 'low stock', 'Reason should be low stock');
  });

  it('should filter out low rating items', () => {
    const parsed = {
      budget: 500,
      items: [
        { category: 'mechanical_keyboard', quantity: 5 }
      ],
      minRating: 4.0
    };

    const quotes = [
      {
        vendor: 'TechNova',
        sku: 'TN-KB-001',
        name: 'TechNova Pro',
        category: 'mechanical_keyboard',
        unitPrice: 49.99,
        quantity: 5,
        lineTotal: 249.95,
        shipping: 12.99,
        stockOk: true,
        rating: 4.5,
        quoteId: 'Q1'
      },
      {
        vendor: 'OfficeHub',
        sku: 'OH-KB-001',
        name: 'OfficeHub Low Rating',
        category: 'mechanical_keyboard',
        unitPrice: 39.99,
        quantity: 5,
        lineTotal: 199.95,
        shipping: 7.99,
        stockOk: true,
        rating: 3.5, // Below minRating
        quoteId: 'Q2'
      }
    ];

    const result = choosePlan(parsed, quotes);

    assert(result.best !== null, 'Should find valid bundle');
    assert.strictEqual(result.best.items[0].sku, 'TN-KB-001', 'Should select high-rated item');
    assert.strictEqual(result.rejected.length, 1, 'Should have one rejected item');
    assert.strictEqual(result.rejected[0].sku, 'OH-KB-001', 'Should reject low rating item');
    assert.strictEqual(result.rejected[0].reason, 'low rating', 'Reason should be low rating');
  });
});
