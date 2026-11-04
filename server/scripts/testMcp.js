// Test script for MCP vendor server
// Tests all three tools: list_vendors, search_products, get_quote

import { listVendors, searchProducts, getQuote } from '../src/mcpClient.js';

async function testMcp() {
  console.log('=== Testing MCP Vendor Server ===\n');

  try {
    // Test 1: List vendors
    console.log('Test 1: List Vendors');
    const vendors = await listVendors();
    console.log('Vendors:', JSON.stringify(vendors, null, 2));
    console.log();

    // Test 2: Search products - all keyboards
    console.log('Test 2: Search All Keyboards');
    const keyboards = await searchProducts({ category: 'mechanical_keyboard' });
    console.log(`Found ${keyboards.length} keyboards:`);
    keyboards.forEach(k => console.log(`  - ${k.name} ($${k.price}) - ${k.vendor}`));
    console.log();

    // Test 3: Search products - all mice
    console.log('Test 3: Search All Mice');
    const mice = await searchProducts({ category: 'wireless_mouse' });
    console.log(`Found ${mice.length} mice:`);
    mice.forEach(m => console.log(`  - ${m.name} ($${m.price}) - ${m.vendor}`));
    console.log();

    // Test 4: Search with filters - keyboards under $60, rating >= 4.0
    console.log('Test 4: Search Keyboards (maxPrice=$60, minRating=4.0)');
    const filteredKeyboards = await searchProducts({ 
      category: 'mechanical_keyboard',
      maxUnitPrice: 60,
      minRating: 4.0
    });
    console.log(`Found ${filteredKeyboards.length} keyboards matching filters:`);
    filteredKeyboards.forEach(k => console.log(`  - ${k.name} ($${k.price}, rating: ${k.rating}) - ${k.vendor}`));
    console.log();

    // Test 5: Search with stock filter
    console.log('Test 5: Search Mice (minStock=10)');
    const stockedMice = await searchProducts({ 
      category: 'wireless_mouse',
      minStock: 10
    });
    console.log(`Found ${stockedMice.length} mice with stock >= 10:`);
    stockedMice.forEach(m => console.log(`  - ${m.name} (stock: ${m.stock}) - ${m.vendor}`));
    console.log();

    // Test 6: Get quote for a single item
    console.log('Test 6: Get Quote for TN-KB-001 (quantity 1)');
    const quote1 = await getQuote({ sku: 'TN-KB-001', quantity: 1 });
    console.log('Quote:', JSON.stringify(quote1, null, 2));
    console.log();

    // Test 7: Get quote for multiple items
    console.log('Test 7: Get Quote for KC-MS-001 (quantity 5)');
    const quote2 = await getQuote({ sku: 'KC-MS-001', quantity: 5 });
    console.log('Quote:', JSON.stringify(quote2, null, 2));
    console.log();

    // Test 8: Test insufficient stock (should fail)
    console.log('Test 8: Get Quote for OH-MS-001 (quantity 10) - Expected to fail (low stock)');
    try {
      const quote3 = await getQuote({ sku: 'OH-MS-001', quantity: 10 });
      console.log('Quote:', quote3);
    } catch (error) {
      console.log('Error (expected):', error.message);
    }
    console.log();

    // Test 9: Test invalid SKU (should fail)
    console.log('Test 9: Get Quote for INVALID-SKU - Expected to fail');
    try {
      const quote4 = await getQuote({ sku: 'INVALID-SKU', quantity: 1 });
      console.log('Quote:', quote4);
    } catch (error) {
      console.log('Error (expected):', error.message);
    }
    console.log();

    console.log('=== All Tests Complete ===');
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testMcp();
