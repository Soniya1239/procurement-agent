// Client-side order history management
// Uses localStorage with fallback to in-memory array

const STORAGE_KEY = 'procureai_order_history';

// In-memory fallback if localStorage fails
let inMemoryOrders = [];

/**
 * Get all orders from localStorage (or in-memory fallback)
 * @returns {Array} Array of orders, newest first
 */
export function getOrders() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (err) {
    console.error('Failed to read orders from localStorage, using in-memory fallback:', err);
    return inMemoryOrders;
  }
}

/**
 * Save orders to localStorage (or in-memory fallback)
 * @param {Array} orders - Array of orders to save
 */
function saveOrders(orders) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch (err) {
    console.error('Failed to save orders to localStorage, using in-memory fallback:', err);
    inMemoryOrders = orders;
  }
}

/**
 * Add a new order to history
 * Ignores duplicate orderIds, keeps newest first
 * @param {Object} order - Order object with orderId, captureId, status, amount, items, payer info, date
 */
export function addOrder(order) {
  const orders = getOrders();
  
  // Ignore duplicate orderIds
  if (orders.some(o => o.orderId === order.orderId)) {
    return orders;
  }
  
  // Add new order at the beginning (newest first)
  orders.unshift(order);
  saveOrders(orders);
  return orders;
}

/**
 * Clear all orders from history
 */
export function clearOrders() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear orders from localStorage:', err);
  }
  inMemoryOrders = [];
}
