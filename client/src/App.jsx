import { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import './App.css';
import { getOrders, addOrder, clearOrders } from './orderHistory.js';

// Helper to format money with thousands separators
const formatMoney = (value) => {
  if (value === null || value === undefined) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

// Helper to format date
const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
};

// Vendor color mapping for consistent colors
const vendorColors = {
  'TechGear': '#2D8CFF',
  'OfficeSupply': '#22D3A5',
  'GadgetWorld': '#FFC439',
  'default': '#64748B'
};

const getVendorColor = (vendor) => vendorColors[vendor] || vendorColors.default;

// Get vendor initials for avatar
const getVendorInitials = (vendor) => {
  if (!vendor) return '??';
  const words = vendor.split(' ');
  if (words.length === 1) {
    return vendor.substring(0, 2).toUpperCase();
  }
  return words.map(w => w[0]).join('').toUpperCase().substring(0, 2);
};

// Header Component with gradient logo mark
function Header() {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-brand">
          <div className="header-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3B82F6" />
                  <stop offset="100%" stopColor="#34D399" />
                </linearGradient>
              </defs>
              <path d="M16 4L20 14L30 16L20 18L16 28L12 18L2 16L12 14L16 4Z" fill="url(#logoGradient)" />
            </svg>
          </div>
          <div>
            <h1 className="header-title">ProcureAI</h1>
            <span className="header-tagline">Your autonomous procurement buyer</span>
          </div>
        </div>
        <div className="header-badges">
          <span className="header-badge">Sandbox demo: test payments only</span>
          <span className="header-badge">Built with PayPal Sandbox APIs</span>
        </div>
      </div>
    </header>
  );
}

// Stepper Component driven by app state
function Stepper({ loading, hasData, isRedirecting }) {
  // Determine current stage based on app state
  // Stage 1: idle (no data)
  // Stage 2: processing (loading)
  // Stage 3: bundle ready (has data, not redirecting)
  // Stage 4: paying (isRedirecting)
  // Stage 5: success (handled by success page)
  
  let currentStage = 0; // Ask
  if (loading) currentStage = 1; // Compare quotes
  else if (hasData && !isRedirecting) currentStage = 2; // Approve
  else if (isRedirecting) currentStage = 3; // Pay

  const steps = ['Ask', 'Compare quotes', 'Approve', 'Pay'];

  return (
    <div className="stepper">
      {steps.map((label, idx) => (
        <div key={idx} className={`step ${idx < currentStage ? 'completed' : idx === currentStage ? 'active' : ''}`}>
          <div className="step-number">
            {idx < currentStage ? (
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : idx + 1}
          </div>
          <span className="step-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

// Agent Feed Component with collapse
function AgentFeed({ steps, loading, hasBundle }) {
  const [expanded, setExpanded] = useState(true);
  const lastStepIndex = loading ? steps.length - 1 : -1;

  // Auto-collapse when bundle is ready
  useEffect(() => {
    if (hasBundle && !loading) {
      setExpanded(false);
    }
  }, [hasBundle, loading]);

  if (hasBundle && !loading && !expanded) {
    return (
      <div className="agent-activity-card">
        <div className="agent-activity-summary">
          <span className="agent-activity-summary-text">
            Agent activity: {steps.length} steps completed
          </span>
          <button 
            onClick={() => setExpanded(true)}
            className="btn btn-small btn-outline"
          >
            Show details
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-activity-card">
      <div className="agent-activity-full">
        <div className="card-header">Agent Activity</div>
        <div className="timeline">
          {steps.map((step, idx) => (
            <div key={idx} className="timeline-item">
              <div className={`timeline-icon ${idx < lastStepIndex ? 'completed' : idx === lastStepIndex ? 'current' : 'pending'}`}>
                {idx < lastStepIndex ? '✓' : idx === lastStepIndex ? '⟳' : ''}
              </div>
              <span className="timeline-text">{step}</span>
            </div>
          ))}
          {loading && (
            <div className="timeline-item">
              <div className="timeline-icon current">⟳</div>
              <span className="timeline-text">Waiting for human approval...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stat Cards Component
function StatCards({ parsed, plan }) {
  if (!parsed || !plan?.best) return null;

  const budgetUsed = (plan.best.grandTotal / parsed.budget) * 100;
  const remaining = parsed.budget - plan.best.grandTotal;

  return (
    <div className="stat-cards">
      <div className="stat-card">
        <div className="stat-label">Budget</div>
        <div className="stat-value money-text">{formatMoney(parsed.budget)}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Items Total</div>
        <div className="stat-value money-text">{formatMoney(plan.best.itemsTotal)}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Shipping</div>
        <div className="stat-value money-text">{formatMoney(plan.best.shipping)}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Grand Total</div>
        <div className="stat-value money-text">{formatMoney(plan.best.grandTotal)}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Remaining</div>
        <div className={`stat-value money-text ${remaining >= 0 ? 'positive' : ''}`}>
          {formatMoney(remaining)}
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(budgetUsed, 100)}%` }} />
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Avg Rating</div>
        <div className="stat-value">{plan.best.avgRating.toFixed(2)}/5</div>
      </div>
    </div>
  );
}

// Bento Grid Components

// Decision Tile Component
function DecisionTile({ parsed, plan }) {
  if (!parsed || !plan?.best) return null;

  const budgetUsed = (plan.best.grandTotal / parsed.budget) * 100;
  const remaining = parsed.budget - plan.best.grandTotal;
  const avgRating = plan.best.avgRating || 0;

  const criteria = [];
  if (plan.best.grandTotal <= parsed.budget) {
    criteria.push('Within budget');
  }
  if (plan.best.avgRating >= 4.5) {
    criteria.push('Highest rating that fits');
  }
  const allInStock = plan.best.items.every(item => item.stock > 0);
  if (allInStock) {
    criteria.push('All items in stock');
  }

  return (
    <div className="bento-tile decision-tile">
      <div className="decision-tile-header">
        <span className="decision-badge">Recommended</span>
      </div>
      <div className="decision-products">
        {plan.best.items.slice(0, 2).map((item, idx) => (
          <div key={idx} className="decision-mini-product">
            <div 
              className="decision-mini-avatar"
              style={{ background: getVendorColor(item.vendor) }}
            >
              {getVendorInitials(item.vendor)}
            </div>
            <div className="decision-mini-details">
              <div className="decision-mini-name">{item.name}</div>
              <div className="decision-mini-meta">
                {item.quantity} x {formatMoney(item.unitPrice)}
              </div>
              <div className="decision-mini-total money-text">{formatMoney(item.lineTotal)}</div>
              <div className="decision-mini-rating">
                {item.rating.toFixed(2)}
                <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="decision-criteria">
        <span className="criteria-label">Criteria passed:</span>
        {criteria.map((c, idx) => (
          <span key={idx} className="criteria-chip">{c}</span>
        ))}
      </div>
    </div>
  );
}

// Budget Ring Tile Component
function BudgetRingTile({ parsed, plan }) {
  if (!parsed || !plan?.best) return null;

  const budgetUsed = (plan.best.grandTotal / parsed.budget) * 100;
  const circumference = 2 * Math.PI * 55; // r=55
  const strokeDashoffset = circumference - (budgetUsed / 100) * circumference;

  // Show one decimal when not a whole number, never show 100% unless total equals budget
  const displayPercent = budgetUsed % 1 === 0 ? budgetUsed.toFixed(0) : budgetUsed.toFixed(1);

  return (
    <div className="bento-tile budget-ring-tile navy-tile">
      <div className="budget-ring-header">Budget Used</div>
      <div className="budget-ring">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle
            cx="65"
            cy="65"
            r="55"
            fill="none"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="8"
          />
          <circle
            cx="65"
            cy="65"
            r="55"
            fill="none"
            stroke="url(#budgetGradient)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 65 65)"
            className="budget-ring-progress"
          />
          <defs>
            <linearGradient id="budgetGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#0d9488" />
            </linearGradient>
          </defs>
        </svg>
        <div className="budget-ring-center">
          <div className="budget-ring-percent">
            <span className="percent-number">{displayPercent}</span>
            <span className="percent-symbol">%</span>
          </div>
        </div>
      </div>
      <div className="budget-ring-amount">
        {formatMoney(plan.best.grandTotal)} of {formatMoney(parsed.budget)}
      </div>
    </div>
  );
}

// Metric Tiles Component
function MetricTiles({ parsed, plan }) {
  if (!parsed || !plan?.best) return null;

  const remaining = parsed.budget - plan.best.grandTotal;

  const metrics = [
    { label: 'Items Total', value: formatMoney(plan.best.itemsTotal), icon: 'box' },
    { label: 'Shipping', value: formatMoney(plan.best.shipping), icon: 'truck' },
    { label: 'Grand Total', value: formatMoney(plan.best.grandTotal), icon: 'sum' },
    { label: 'Remaining', value: formatMoney(remaining), icon: 'wallet', highlight: remaining >= 0 },
    { label: 'Avg Rating', value: `${plan.best.avgRating.toFixed(2)}/5`, icon: 'star' },
  ];

  const getIcon = (icon) => {
    const icons = {
      box: <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
      truck: <><path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></>,
      sum: <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
      wallet: <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
      star: <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />,
    };
    return icons[icon] || icons.box;
  };

  return (
    <div className="metric-tiles-row">
      {metrics.map((metric, idx) => (
        <div key={idx} className={`bento-tile metric-tile ${metric.label === 'Grand Total' ? 'navy-tile' : ''}`}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="metric-icon">
            {getIcon(metric.icon)}
          </svg>
          <div className="metric-label">{metric.label}</div>
          <div className={`metric-value money-text ${metric.highlight ? 'highlight' : ''}`}>{metric.value}</div>
        </div>
      ))}
    </div>
  );
}

// Trade-off Tile Component
function TradeOffTile({ quotes, parsed, plan }) {
  if (!quotes || !parsed || !plan?.best) return null;

  const cheapestValid = computeCheapestValidBundle(quotes, parsed);
  if (!cheapestValid || cheapestValid.grandTotal >= plan.best.grandTotal) return null;

  const priceDiff = plan.best.grandTotal - cheapestValid.grandTotal;
  const ratingDiff = plan.best.avgRating - cheapestValid.avgRating;
  const maxPrice = Math.max(plan.best.grandTotal, cheapestValid.grandTotal);

  return (
    <div className="bento-tile tradeoff-tile tradeoff-full-width">
      <div className="tradeoff-header">Trade-off Analysis</div>
      <div className="tradeoff-content-horizontal">
        <div className="tradeoff-text">
          +{formatMoney(priceDiff)} for +{ratingDiff.toFixed(2)} rating vs. cheapest
        </div>
        <div className="tradeoff-bars">
          <div className="tradeoff-bar-group">
            <span className="tradeoff-bar-label">Cheapest</span>
            <div className="tradeoff-bar-track">
              <div
                className="tradeoff-bar cheapest"
                style={{ width: `${(cheapestValid.grandTotal / maxPrice) * 100}%` }}
              />
            </div>
            <span className="tradeoff-bar-value">{formatMoney(cheapestValid.grandTotal)}</span>
          </div>
          <div className="tradeoff-bar-group">
            <span className="tradeoff-bar-label">Selected</span>
            <div className="tradeoff-bar-track">
              <div
                className="tradeoff-bar selected"
                style={{ width: `${(plan.best.grandTotal / maxPrice) * 100}%` }}
              />
            </div>
            <span className="tradeoff-bar-value">{formatMoney(plan.best.grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function computeCheapestValidBundle(quotes, parsed) {
  // Group quotes by category
  const byCategory = {};
  quotes.forEach(q => {
    if (q.stock === 0) return; // Skip out of stock
    if (!byCategory[q.category]) byCategory[q.category] = [];
    byCategory[q.category].push(q);
  });

  // For each category, pick the cheapest option
  const items = [];
  let total = 0;
  let totalRating = 0;

  parsed.items.forEach(req => {
    const options = byCategory[req.category] || [];
    const cheapest = options
      .filter(q => q.lineTotal + q.shipping <= parsed.budget)
      .sort((a, b) => (a.lineTotal + a.shipping) - (b.lineTotal + b.shipping))[0];
    
    if (cheapest) {
      items.push(cheapest);
      total += cheapest.lineTotal + cheapest.shipping;
      totalRating += cheapest.rating;
    }
  });

  if (items.length === 0) return null;

  return {
    grandTotal: total,
    avgRating: totalRating / items.length,
    items
  };
}

// Vendor Price Comparison Tile (Bento Grid)
function VendorComparisonTile({ quotes, plan, parsed }) {
  if (!quotes || !plan?.best) return null;

  const chosenSkus = new Set(plan.best.items?.map(i => i.sku) || []);
  const rejectedMap = {};
  plan?.rejected?.forEach(r => {
    rejectedMap[r.sku] = r.reason;
  });
  
  const byCategory = {};
  quotes.forEach(quote => {
    const category = quote.category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(quote);
  });

  const allTotals = quotes.map(q => q.lineTotal + q.shipping);
  const maxPrice = Math.max(...allTotals);

  Object.keys(byCategory).forEach(cat => {
    byCategory[cat].sort((a, b) => (a.lineTotal + a.shipping) - (b.lineTotal + b.shipping));
  });

  const getTagInfo = (item) => {
    if (chosenSkus.has(item.sku)) {
      return { text: 'Selected', class: 'selected' };
    }
    
    if (item.stock === 0) {
      return { text: 'Out of stock', class: 'out-of-stock' };
    }

    const selectedItems = plan.best.items || [];
    const otherSelectedTotal = selectedItems
      .filter(si => si.category !== item.category)
      .reduce((sum, si) => sum + si.lineTotal + si.shipping, 0);
    
    const newTotal = otherSelectedTotal + item.lineTotal + item.shipping;
    const budget = parsed?.budget || plan.best.grandTotal;
    
    if (newTotal > budget) {
      return { text: "Doesn't fit bundle budget", class: 'over-budget', tooltip: "Doesn't fit bundle budget when combined with the selected items" };
    }

    const selectedItemInCategory = selectedItems.find(si => si.category === item.category);
    if (selectedItemInCategory && item.rating < selectedItemInCategory.rating) {
      return { text: `Lower rating (${item.rating.toFixed(2)})`, class: 'reason' };
    }

    return null;
  };

  const getBarClass = (item) => {
    const tagInfo = getTagInfo(item);
    if (tagInfo?.class === 'out-of-stock') return 'out-of-stock';
    if (tagInfo?.class === 'over-budget') return 'over-budget';
    if (tagInfo?.class === 'selected') return 'selected';
    return 'normal';
  };

  return (
    <div className="bento-tile vendor-comparison-tile">
      <div className="vendor-comparison-header">
        <h3>Vendor Price Comparison</h3>
        <p className="vendor-comparison-caption">Prices include vendor shipping</p>
        <div className="vendor-legend">
          <div className="vendor-legend-item">
            <div className="vendor-legend-color selected" />
            <span>Selected</span>
          </div>
          <div className="vendor-legend-item">
            <div className="vendor-legend-color normal" />
            <span>Other options</span>
          </div>
          <div className="vendor-legend-item">
            <div className="vendor-legend-color out-of-stock" />
            <span>Out of stock</span>
          </div>
          <div className="vendor-legend-item">
            <div className="vendor-legend-color over-budget" />
            <span title="Doesn't fit bundle budget when combined with the selected items">Doesn't fit bundle budget</span>
          </div>
        </div>
      </div>
      {Object.entries(byCategory).map(([category, items]) => (
        <div key={category} className="vendor-category-group">
          <div className="vendor-category-label">{category}</div>
          {items.map((item, idx) => {
            const total = item.lineTotal + item.shipping;
            const width = maxPrice > 0 ? (total / maxPrice) * 100 : 0;
            const barClass = getBarClass(item);
            const tagInfo = getTagInfo(item);
            
            return (
              <div key={idx} className="vendor-bar-row" title={`Unit: ${formatMoney(item.unitPrice)}, Qty: ${item.quantity}, Shipping: ${formatMoney(item.shipping)}, Rating: ${item.rating.toFixed(2)}`}>
                <div className="vendor-bar-label-col">
                  <div 
                    className="vendor-bar-avatar"
                    style={{ background: getVendorColor(item.vendor) }}
                  >
                    {getVendorInitials(item.vendor)}
                  </div>
                  <span className="vendor-bar-name">{item.vendor} · {item.name}</span>
                </div>
                <div className="vendor-bar-track">
                  <div 
                    className={`vendor-bar-fill ${barClass}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="vendor-bar-amount">{formatMoney(total)}</span>
                <span className="vendor-bar-rating">
                  {item.rating.toFixed(2)}
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                </span>
                {tagInfo && (
                  <span 
                    className={`vendor-bar-tag ${tagInfo.class}`}
                    title={tagInfo.tooltip || tagInfo.text}
                  >
                    {tagInfo.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Insight Tile Component (Bento Grid)
function InsightTile({ explanation, explanationSource, plan, useSampleData }) {
  const isAI = explanationSource === 'llm' || explanationSource === 'fallback-model';
  const isCache = explanationSource === 'cache';
  const isTemplate = explanationSource === 'template';

  return (
    <div className="bento-tile insight-tile">
      <div className="insight-tile-header">
        <div className="insight-tile-title">
          <svg className="insight-sparkle" width={20} height={20} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>
          AI Agent Insight
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="insight-source-badge">{isTemplate ? 'Template' : 'AI'}</span>
          {isCache && (
            <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: '500' }}>cached</span>
          )}
        </div>
      </div>
      <div className="insight-tile-content">
        {typeof explanation === 'string' ? explanation : explanation?.text}
      </div>
      {useSampleData && (
        <div className="notice notice-info">Sample data mode: LLM parsing skipped</div>
      )}
      {!useSampleData && explanationSource === 'template' && (
        <div className="notice notice-warning">Using fallback mode due to LLM unavailability</div>
      )}
    </div>
  );
}

// Live Agent Console Component
function AgentConsole({ steps, loading, parseSource, explainSource }) {
  const consoleRef = useRef(null);
  const [processingStep, setProcessingStep] = useState(null);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [steps, loading]);

  // Show animated processing line only when loading
  useEffect(() => {
    if (loading) {
      setProcessingStep('Processing...');
    } else {
      setProcessingStep(null);
    }
  }, [loading]);

  const formatTime = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getStepMessage = (step) => {
    const nameMap = {
      'mechanical_keyboard': 'mechanical keyboards',
      'wireless_mouse': 'wireless mice',
      'keyboard': 'keyboards',
      'mouse': 'mice'
    };
    if (step.item) {
      const itemName = nameMap[step.item] || step.item;
      return `Found ${step.quantity}x ${itemName} from ${step.vendor} (${formatMoney(step.price)})`;
    }
    let message = step.text || step.message || step.status || 'Processing...';
    // Hide all error codes and technical errors
    if (message.includes('MCP error') || message.includes('-32603') || message.includes('error') || message.includes('Error')) {
      return 'Vendor service busy, retrying...';
    }
    // Format friendly stock messages
    if (message.includes('stock') && message.includes('only')) {
      return message.replace(/only (\d+) in stock \((\d+) needed\)/, 'only $1 in stock ($2 needed)');
    }
    // Replace SKU codes with product names if present
    if (message.includes('SKU') || message.includes('sku')) {
      // Try to extract and format
      return message.replace(/SKU[:\s]*([A-Z0-9_-]+)/gi, 'product');
    }
    return message;
  };

  // Deduplicate steps - only show each unique message once
  const uniqueSteps = steps.filter((step, index, self) =>
    index === self.findIndex(s => getStepMessage(s) === getStepMessage(step))
  );

  return (
    <div className="hero-right">
      <div className="agent-console">
        <div className="console-header">
          <div className="console-dots">
            <div className="console-dot red" />
            <div className="console-dot yellow" />
            <div className="console-dot green" />
          </div>
          <span className="console-title">agent.log</span>
          <div className="console-tags">
            {parseSource && <span className="console-tag parse">{parseSource}</span>}
            {explainSource && <span className="console-tag explain">{explainSource}</span>}
          </div>
        </div>
        <div className="console-body" ref={consoleRef}>
          {!loading && steps.length === 0 && (
            <div className="console-line">
              <span className="console-timestamp">{formatTime()}</span>
              <span className="console-message console-placeholder">Waiting for your command...</span>
            </div>
          )}
          {loading && steps.length === 0 && (
            <div className="console-line">
              <span className="console-timestamp">{formatTime()}</span>
              <span className="console-message current">
                Waiting for server...<span className="console-cursor" />
              </span>
            </div>
          )}
          {uniqueSteps.map((step, idx) => (
            <div key={idx} className="console-line">
              <span className="console-timestamp">{formatTime()}</span>
              {step.done ? (
                <svg className="console-status-icon check" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="console-status-icon spinner" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              <span className={`console-message ${step.done ? 'done' : 'current'}`}>
                {getStepMessage(step)}
              </span>
            </div>
          ))}
          {!loading && steps.length > 0 && steps.every(s => s.done) && (
            <div className="console-line">
              <span className="console-timestamp">{formatTime()}</span>
              <svg className="console-status-icon check" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="console-message done">
                Waiting for human approval
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main procurement page component
function ProcurementPage() {
  const [command, setCommand] = useState('We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice from our approved vendors.');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [useSampleData, setUseSampleData] = useState(false);
  const [showWhySection, setShowWhySection] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [consoleSteps, setConsoleSteps] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [groupByVendor, setGroupByVendor] = useState(false);
  const gridRef = useRef();
  const navigate = useNavigate();
  const [lastCommand, setLastCommand] = useState(command);
  const [isStale, setIsStale] = useState(false);

  const onGridReady = (params) => {
    params.api.sizeColumnsToFit();
  };

  useEffect(() => {
    const handleResize = () => {
      if (gridRef.current) {
        gridRef.current.api.sizeColumnsToFit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Detect stale results when command changes
  useEffect(() => {
    if (data && command !== lastCommand) {
      setIsStale(true);
    }
  }, [command, data, lastCommand]);

  const examplePrompts = [
    'We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice.',
    'Need 10 wireless mice with a $200 budget.',
    'Looking for 3 mechanical keyboards under $300 total.'
  ];

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    setConsoleSteps([]);
    setIsStreaming(true);
    setLastCommand(command);
    setIsStale(false);

    try {
      // Try streaming endpoint first
      const response = await fetch('http://localhost:3001/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, useSampleData })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Read streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;
      let lastStepTime = 0;
      const MIN_STEP_SPACING = 120;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            const now = Date.now();
            const timeSinceLastStep = now - lastStepTime;

            if (data.type === 'step') {
              // Apply minimum spacing for fast steps
              if (timeSinceLastStep < MIN_STEP_SPACING && lastStepTime > 0) {
                await new Promise(resolve => setTimeout(resolve, MIN_STEP_SPACING - timeSinceLastStep));
              }

              setConsoleSteps(prev => [...prev, { text: data.text, time: data.time, done: false }]);
              lastStepTime = Date.now();
            } else if (data.type === 'result') {
              result = data;
              // Mark all steps as done
              setConsoleSteps(prev => prev.map(s => ({ ...s, done: true })));
            } else if (data.type === 'error') {
              throw new Error(data.message);
            }
          } catch (e) {
            console.error('Failed to parse stream line:', line, e);
          }
        }
      }

      if (result) {
        setData(result);
      } else {
        throw new Error('No result received from stream');
      }
    } catch (streamError) {
      console.log('Streaming failed, falling back to non-streaming endpoint:', streamError.message);
      setIsStreaming(false);

      // Fallback to non-streaming endpoint
      try {
        const response = await fetch('http://localhost:3001/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, useSampleData })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Show steps one by one with minimum spacing
        if (result.steps && result.steps.length > 0) {
          for (const step of result.steps) {
            setConsoleSteps(prev => [...prev, { text: step, time: new Date().toISOString(), done: false }]);
            await new Promise(resolve => setTimeout(resolve, MIN_STEP_SPACING));
          }
          setConsoleSteps(prev => prev.map(s => ({ ...s, done: true })));
        }

        setData(result);
      } catch (fallbackError) {
        setError(fallbackError.message);
      }
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };

  const handleApprovePay = async () => {
    console.log('Approve & Pay clicked, isStale:', isStale, 'isRedirecting:', isRedirecting);
    if (!data?.plan?.best || isRedirecting) return;

    setIsRedirecting(true);
    setError(null);

    try {
      console.log('Sending checkout request to http://localhost:3001/api/checkout');
      const response = await fetch('http://localhost:3001/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: data.plan })
      });

      console.log('Checkout response status:', response.status);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Checkout result:', result);
      if (result.approveUrl) {
        window.location.href = result.approveUrl;
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err.message);
      setIsRedirecting(false);
    }
  };

  const exportToCsv = () => {
    gridRef.current.api.exportDataAsCsv();
  };

  // Prepare row data for AG Grid
  const getRowData = () => {
    if (!data?.quotes || !data?.plan?.best) return [];
    
    const chosenSkus = new Set(data.plan.best.items?.map(i => i.sku) || []);
    const budget = data.parsed?.budget || data.plan.best.grandTotal;
    const selectedItems = data.plan.best.items || [];
    
    let rowData = data.quotes.map(quote => {
      const isSelected = chosenSkus.has(quote.sku);
      let status = 'Not selected';
      
      if (isSelected) {
        status = 'Selected';
      } else if (quote.stock === 0) {
        status = 'Not selected';
      } else {
        // Check if swapping would exceed budget
        const otherSelectedTotal = selectedItems
          .filter(si => si.category !== quote.category)
          .reduce((sum, si) => sum + si.lineTotal + si.shipping, 0);
        const newTotal = otherSelectedTotal + quote.lineTotal + quote.shipping;
        
        if (newTotal > budget) {
          status = "Doesn't fit bundle budget";
        }
      }
      
      return {
        vendor: quote.vendor,
        product: quote.name,
        category: quote.category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        quantity: quote.quantity,
        unitPrice: quote.unitPrice,
        lineTotal: quote.lineTotal,
        shipping: quote.shipping,
        rating: quote.rating,
        status: status,
        sku: quote.sku
      };
    });
    
    // Sort by vendor if grouping is enabled
    if (groupByVendor) {
      rowData.sort((a, b) => a.vendor.localeCompare(b.vendor));
    }

    return rowData;
  };

  const getShortReason = (reason) => {
    if (reason.includes('stock')) return 'Low stock';
    if (reason.includes('rating')) return 'Low rating';
    if (reason.includes('budget') || reason.includes("Doesn't fit")) return "Doesn't fit bundle budget";
    return 'Skipped';
  };

  // AG Grid column definitions with real cell renderers and proper widths
  const columnDefs = [
    {
      field: 'vendor',
      sortable: true,
      filter: true,
      headerName: 'Vendor',
      minWidth: 160,
      flex: 1,
      pinned: null,
      suppressMenu: true,
      cellRenderer: (params) => {
        const vendor = params.value;
        const color = getVendorColor(vendor);
        // Don't show avatar for TOTAL row
        if (vendor === 'TOTAL') {
          return (
            <span style={{
              color: '#0B1B3A',
              fontSize: '14px',
              fontWeight: '700',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1
            }}>
              {vendor}
            </span>
          );
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '160px', width: '100%' }}>
            <div style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: color,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: '600',
              flexShrink: 0
            }}>
              {getVendorInitials(vendor)}
            </div>
            <span style={{
              color: '#0B1B3A',
              fontSize: '14px',
              fontWeight: '600',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1
            }}>
              {vendor}
            </span>
          </div>
        );
      }
    },
    {
      field: 'product',
      sortable: true,
      filter: true,
      headerName: 'Product',
      minWidth: 230,
      flex: 1,
      resizable: true,
      suppressMenu: true,
      tooltipField: 'product'
    },
    {
      field: 'category',
      sortable: true,
      filter: true,
      headerName: 'Category',
      minWidth: 110,
      flex: 1,
      resizable: true,
      suppressMenu: true,
      valueFormatter: params => {
        const cat = params.value;
        if (cat.includes('keyboard') || cat.includes('Keyboard')) return 'Keyboard';
        if (cat.includes('mouse') || cat.includes('Mouse')) return 'Mouse';
        return cat;
      }
    },
    {
      field: 'quantity',
      sortable: true,
      filter: true,
      headerName: 'Qty',
      minWidth: 55,
      flex: 1,
      suppressMenu: true
    },
    {
      field: 'unitPrice',
      sortable: true,
      filter: true,
      headerName: 'Unit Price',
      minWidth: 105,
      flex: 1,
      suppressMenu: true,
      valueFormatter: params => params.value ? formatMoney(params.value) : '',
      cellStyle: { textAlign: 'right' }
    },
    {
      field: 'lineTotal',
      sortable: true,
      filter: true,
      headerName: 'Line Total',
      minWidth: 110,
      flex: 1,
      suppressMenu: true,
      valueFormatter: params => params.value ? formatMoney(params.value) : '',
      cellStyle: { textAlign: 'right' }
    },
    {
      field: 'shipping',
      sortable: true,
      filter: true,
      headerName: 'Shipping',
      minWidth: 100,
      flex: 1,
      suppressMenu: true,
      valueFormatter: params => params.value ? formatMoney(params.value) : '',
      cellStyle: { textAlign: 'right' }
    },
    {
      field: 'rating',
      sortable: true,
      filter: true,
      headerName: 'Rating',
      minWidth: 90,
      flex: 1,
      suppressMenu: true,
      cellRenderer: (params) => {
        const rating = params.value;
        if (rating === null || rating === undefined) return '';
        const ratingNum = typeof rating === 'number' ? rating : parseFloat(rating);
        if (isNaN(ratingNum)) return '';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end', width: '100%', fontSize: '14px', fontWeight: '600' }}>
            {ratingNum.toFixed(2)}
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </span>
        );
      },
      cellStyle: { textAlign: 'right' }
    },
    {
      field: 'status',
      sortable: true,
      filter: true,
      headerName: 'Status',
      minWidth: 125,
      width: 125,
      flex: 0,
      suppressMenu: true,
      cellRenderer: (params) => {
        const status = params.value;
        if (!status) return '';
        let bgColor = '#E2E8F0';
        let textColor = '#334155';
        let tooltip = status;
        if (status === 'Selected') {
          bgColor = '#D1FAE5';
          textColor = '#065F46';
        } else if (status === "Doesn't fit bundle budget") {
          bgColor = '#FEF3C7';
          textColor = '#92400E';
          tooltip = "Doesn't fit bundle budget when combined with the selected items";
        } else if (status === 'Not selected') {
          bgColor = '#E2E8F0';
          textColor = '#334155';
        }
        return (
          <span 
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 12px',
              borderRadius: '9999px',
              background: bgColor,
              color: textColor,
              fontSize: '13px',
              fontWeight: '700',
              width: '100%',
              maxHeight: '28px',
              whiteSpace: 'nowrap'
            }}
            title={tooltip}
          >
            {status}
          </span>
        );
      }
    }
  ];

  // Row styling based on selection/rejection
  const getRowStyle = params => {
    if (params.data.isChosen) {
      return { backgroundColor: '#ECFDF5' };
    }
    if (params.data.isRejected) {
      return { backgroundColor: '#F8FAFC', color: '#94A3B8' };
    }
    return {};
  };

  // Pinned bottom row data
  const getPinnedBottomRowData = () => {
    if (!data?.plan?.best) return [];
    
    return [{
      vendor: 'TOTAL',
      product: '',
      category: '',
      quantity: data.plan.best.items.reduce((sum, i) => sum + i.quantity, 0),
      unitPrice: null,
      lineTotal: data.plan.best.itemsTotal,
      shipping: data.plan.best.shipping,
      rating: null,
      status: ''
    }];
  };

  return (
    <>
      <div className="dot-grid" />
      <Header />
      
      {/* Hero with split layout */}
      <div className="hero">
        <div className="hero-content">
          <div className="hero-left">
            <div className="hero-eyebrow">PayPal AI Hackathon 2026</div>
            <h1 className="hero-headline">
              Small businesses lose hours <span className="gradient-text">comparing vendors</span>.
            </h1>
            <p className="hero-subline">
              Let AI find the best deals across your approved vendors in seconds. Just describe what you need and your budget.
            </p>
            <div className="command-box">
              <textarea
                className="command-textarea"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Describe what you need and your budget..."
              />
              <div className="command-chips">
                <button className="command-chip" onClick={() => setCommand('We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice from our approved vendors.')} disabled={loading || useSampleData}>
                  Mechanical keyboards + mice
                </button>
                <button className="command-chip" onClick={() => setCommand('Need 10 wireless mice with a $200 budget from approved vendors.')} disabled={loading || useSampleData}>
                  Wireless mice
                </button>
                <button className="command-chip" onClick={() => setCommand('Looking for 3 mechanical keyboards under $300 total from approved vendors.')} disabled={loading || useSampleData}>
                  Mechanical keyboards
                </button>
              </div>
              <div className="command-actions">
                <div className="toggle-switch">
                  <input
                    type="checkbox"
                    className="toggle-input"
                    checked={useSampleData}
                    onChange={(e) => {
                      const newValue = e.target.checked;
                      setUseSampleData(newValue);
                      if (newValue) {
                        setCommand('We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice from our approved vendors.');
                        setLastCommand('We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice from our approved vendors.');
                        setIsStale(false);
                      }
                    }}
                    id="sampleData"
                    disabled={loading}
                  />
                  <label htmlFor="sampleData">Use sample data</label>
                  {useSampleData && (
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Sample mode uses the default command</div>
                  )}
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="btn btn-primary"
                >
                  {loading ? 'Processing...' : (
                    <>
                      Find Best Bundle
                      <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
          <AgentConsole
            steps={consoleSteps}
            loading={loading}
            parseSource={data?.explanationSource}
            explainSource={data?.usedFallback ? 'Fallback' : 'AI'}
          />
        </div>
      </div>

      <div className="app">

      <Stepper loading={loading} hasData={!!data} isRedirecting={isRedirecting} />

      {loading && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '60%' }} />
        </div>
      )}

      {error && (
        <div className="notice notice-error">
          {error}
        </div>
      )}

      {data && (
        <>
          {isStale && (
            <div className="notice notice-warning">
              These results are for a previous command. Click Find Best Bundle to update.
            </div>
          )}
          <div className={`bento-grid ${isStale ? 'stale-results' : ''}`}>
            <DecisionTile parsed={data.parsed} plan={data.plan} />
            <BudgetRingTile parsed={data.parsed} plan={data.plan} />
            <MetricTiles parsed={data.parsed} plan={data.plan} />
            <TradeOffTile quotes={data.quotes} parsed={data.parsed} plan={data.plan} />
            <InsightTile
              explanation={data.explanation}
              explanationSource={data.explanationSource}
              plan={data.plan}
              useSampleData={useSampleData}
            />
            <VendorComparisonTile quotes={data.quotes} plan={data.plan} parsed={data.parsed} />
          </div>

          {/* AG Grid */}
          {data.quotes && (
            <div className="results-section">
              <div className="section-eyebrow">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                05 All Quotes
                <span className="section-description">Complete quote data</span>
              </div>
              <div className="card grid-card accent">
                <div className="grid-header">
                  <h2>Candidate Quotes</h2>
                  <div className="grid-controls">
                    <button
                      onClick={() => setGroupByVendor(!groupByVendor)}
                      className="btn btn-small btn-outline"
                    >
                      {groupByVendor ? 'Ungroup' : 'Group by vendor'}
                    </button>
                    <button onClick={exportToCsv} className="btn btn-small btn-outline">
                      Export CSV
                    </button>
                  </div>
                </div>
                <div className="ag-theme-quartz aurora-dark grid-container">
                  <AgGridReact
                    ref={gridRef}
                    rowData={getRowData()}
                    columnDefs={columnDefs}
                    defaultColDef={{
                      sortable: true,
                      filter: true,
                      resizable: true,
                      flex: 1,
                      minWidth: 100,
                      suppressMenu: true,
                      wrapHeaderText: true,
                      autoHeaderHeight: true
                    }}
                    rowHeight={48}
                    getRowStyle={getRowStyle}
                    pinnedBottomRowData={getPinnedBottomRowData()}
                    domLayout='autoHeight'
                    onGridReady={onGridReady}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Payment Card - Centered with order summary */}
          {data.plan?.best && (
            <div className="results-section">
              <div className="section-eyebrow">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                06 Approve and Pay
                <span className="section-description">Secure checkout</span>
              </div>
              <div className="payment-card accent">
                <div className="payment-card-header">
                  <svg className="payment-lock-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="payment-title">Secure checkout via PayPal Sandbox</span>
                </div>
                <div className="payment-card-body">
                  <p className="payment-privacy">
                    <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Card details are entered on PayPal's checkout, never on this site.
                  </p>
                  <div className="payment-summary">
                    <div className="payment-summary-item">
                      <span>Items ({data.plan.best.items.length})</span>
                      <span>{formatMoney(data.plan.best.itemsTotal)}</span>
                    </div>
                    <div className="payment-summary-item">
                      <span>Shipping</span>
                      <span>{formatMoney(data.plan.best.shipping)}</span>
                    </div>
                    <div className="payment-summary-item">
                      <span>Grand Total</span>
                      <span>{formatMoney(data.plan.best.grandTotal)}</span>
                    </div>
                  </div>
                  <div className="approval-badge">
                    <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {' '} Human approval required
                  </div>
                  <div className="payment-actions">
                    <button
                      onClick={handleApprovePay}
                      className="btn btn-cta"
                      disabled={isRedirecting || isStale}
                    >
                      {isRedirecting ? (
                        <>
                          <svg className="spinner" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Redirecting to PayPal...
                        </>
                      ) : (
                        <>
                          <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          Approve & Pay with PayPal
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowWhySection(!showWhySection)}
                      className="btn btn-ghost"
                    >
                      {showWhySection ? 'Hide' : 'Show'} Why This Bundle?
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {data.plan?.error && (
            <div className="results-section">
              <div className="card">
                <div className="card-body">
                  <h3 style={{ color: 'var(--red)' }}>No Valid Bundle Found</h3>
                  <p style={{ color: 'var(--text-secondary)' }}>{data.plan.error}</p>
                </div>
              </div>
            </div>
          )}

          {data.plan?.best && showWhySection && (
            <div className="results-section">
              <div className="card">
                <div className="card-header">Why This Bundle?</div>
                <div className="card-body">
                  <h4 style={{ marginBottom: '16px', color: '#0f172a' }}>Top 3 Alternatives</h4>
                  {data.plan.alternatives?.length > 0 ? (
                    data.plan.alternatives.map((alt, idx) => {
                      const tiesSelected = alt.grandTotal.toFixed(2) === data.plan.best.grandTotal.toFixed(2) && alt.avgRating.toFixed(2) === data.plan.best.avgRating.toFixed(2);
                      return (
                        <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '8px', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#0f172a' }}>
                            <strong>Option #{idx + 2}</strong>
                            <span>Total: {formatMoney(alt.grandTotal)} | Rating: {alt.avgRating.toFixed(2)}/5</span>
                          </div>
                          {tiesSelected && (
                            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Tie broken by higher keyboard rating</div>
                          )}
                          <div style={{ marginLeft: '20px' }}>
                            {alt.items.map((item, i) => (
                              <div key={i} style={{ padding: '4px 0', fontSize: '13px', color: '#334155' }}>
                                {item.quantity}x {item.name} from {item.vendor} ({formatMoney(item.lineTotal)})
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p style={{ color: '#334155' }}>No alternatives available</p>
                  )}

                  <h4 style={{ marginTop: '24px', marginBottom: '16px', color: '#0f172a' }}>Rejected Options</h4>
                  {data.plan.rejected?.length > 0 ? (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {data.plan.rejected.map((rej, idx) => {
                        // Try to get product name from quotes if available
                        const productName = data.quotes?.find(q => q.sku === rej.sku)?.name || rej.sku;
                        const displayReason = rej.reason === 'Over budget with selected items' ? "Doesn't fit bundle budget" : rej.reason;
                        return (
                          <li key={idx} style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '8px', fontSize: '14px', color: '#334155' }}>
                            <strong>{productName}</strong>: {displayReason}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p style={{ color: '#334155' }}>No items were rejected</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <footer className="footer">
        Built for the PayPal AI Hackathon 2026
      </footer>
      </div>
    </>
  );
}

// Error Boundary for Success Page
class SuccessPageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Success page error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app success-page">
          <div className="dot-grid" />
          <h2 style={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Payment Successful</h2>
          <div className="card" style={{ maxWidth: '500px', margin: '24px auto' }}>
            <div className="card-body">
              <p style={{ color: '#BBD0F5', fontSize: '16px' }}>Your payment was completed successfully.</p>
              <p style={{ color: '#94A3B8', fontSize: '14px', marginTop: '12px' }}>Order details could not be displayed due to an error.</p>
            </div>
          </div>
          <button onClick={() => window.location.href = '/'} className="btn btn-primary">Back to Home</button>
          <footer className="footer">
            Built for the PayPal AI Hackathon 2026
          </footer>
        </div>
      );
    }
    return this.props.children;
  }
}

// Success page component with confetti
function SuccessPage() {
  const [searchParams] = useSearchParams();
  const [orderData, setOrderData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [confettiShown, setConfettiShown] = useState(false);
  const gridRef = useRef();
  const navigate = useNavigate();
  const hasCaptured = useRef(false);

  // Load orders from client-side storage on mount
  useEffect(() => {
    setOrders(getOrders());
  }, []);

  // Create confetti effect
  useEffect(() => {
    if (!loading && !error && !confettiShown) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReducedMotion) {
        const colors = ['#2D8CFF', '#22D3A5', '#FFC439'];
        for (let i = 0; i < 20; i++) {
          const confetti = document.createElement('div');
          confetti.className = 'confetti';
          confetti.style.left = Math.random() * 100 + 'vw';
          confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
          confetti.style.animationDelay = Math.random() * 0.5 + 's';
          document.body.appendChild(confetti);
          setTimeout(() => confetti.remove(), 1500);
        }
      }
      setConfettiShown(true);
    }
  }, [loading, error, confettiShown]);

  useEffect(() => {
    const captureOrder = async () => {
      const token = searchParams.get('token');
      if (!token) {
        setError('No order token found');
        setLoading(false);
        return;
      }

      // Guard against duplicate captures using both useRef and sessionStorage
      const sessionKey = `captured:${token}`;
      if (hasCaptured.current || sessionStorage.getItem(sessionKey)) {
        return;
      }
      hasCaptured.current = true;
      sessionStorage.setItem(sessionKey, 'true');

      try {
        const captureResponse = await fetch(`http://localhost:3001/api/capture/${token}`, {
          method: 'POST',
          headers: {}
        });

        if (!captureResponse.ok) {
          const errorData = await captureResponse.json();
          throw new Error(errorData.error || `Failed to capture order: ${captureResponse.status}`);
        }

        const captureResult = await captureResponse.json();
        setOrderData(captureResult);

        // Add completed order to client-side history (normalized, deduplicated by orderId)
        if (captureResult.status === 'COMPLETED') {
          const itemCount = captureResult.items ? captureResult.items.length : 0;
          const unitCount = captureResult.items ? captureResult.items.reduce((sum, item) => sum + (item.quantity || 1), 0) : 0;
          
          const normalizedOrder = {
            orderId: captureResult.orderId || '—',
            captureId: captureResult.captureId || '—',
            status: captureResult.status || 'UNKNOWN',
            totalAmount: captureResult.grandTotal || captureResult.amountPaid || 0,
            currency: 'USD',
            createdAt: captureResult.capturedAt || new Date().toISOString(),
            payerName: captureResult.payerName || '—',
            payerEmail: captureResult.payerEmail || '—',
            itemCount,
            unitCount,
            items: captureResult.items || []
          };
          const updatedOrders = addOrder(normalizedOrder);
          setOrders(updatedOrders);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    captureOrder();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="app success-page">
        <svg className="spinner-icon" width={48} height={48} fill="none" viewBox="0 0 24 24" stroke="#22a06b" strokeWidth={2} style={{ margin: '0 auto 24px', display: 'block' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <h2 style={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Processing Payment...</h2>
        <p style={{ color: '#BBD0F5', fontSize: '16px' }}>Please wait while we confirm your order.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app success-page">
        <h2 style={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Payment Error</h2>
        <div className="notice notice-error" style={{ maxWidth: '500px', margin: '24px auto' }}>{error}</div>
        <button onClick={() => navigate('/')} className="btn btn-primary">Back to Home</button>
      </div>
    );
  }

  const [copiedId, setCopiedId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const orderHistoryColumnDefs = [
    { 
      field: 'orderId', 
      headerName: 'Order ID', 
      sortable: true, 
      filter: true,
      suppressHeaderMenuButton: true,
      cellStyle: { textAlign: 'left' },
      headerClass: 'ag-left-aligned-header',
      valueFormatter: params => params.value || '—'
    },
    { 
      field: 'captureId', 
      headerName: 'Capture ID', 
      sortable: true, 
      filter: true,
      suppressHeaderMenuButton: true,
      cellStyle: { textAlign: 'left' },
      headerClass: 'ag-left-aligned-header',
      width: 200,
      cellRenderer: params => {
        if (!params.value) return '—';
        const isCopied = copiedId === params.value;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span 
              title={params.value}
              style={{ 
                overflow: 'hidden', 
                textOverflow: 'ellipsis', 
                whiteSpace: 'nowrap',
                cursor: 'help'
              }}
            >
              {params.value}
            </span>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(params.value);
                setCopiedId(params.value);
                setToastMessage('Copied!');
                setTimeout(() => {
                  setCopiedId(null);
                  setToastMessage(null);
                }, 2000);
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#64748b',
                padding: '2px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Copy ID"
            >
              {isCopied ? (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
        );
      }
    },
    { 
      field: 'createdAt', 
      headerName: 'Date', 
      sortable: true, 
      filter: true,
      suppressHeaderMenuButton: true,
      cellStyle: { textAlign: 'left' },
      headerClass: 'ag-left-aligned-header',
      width: 220,
      valueFormatter: params => params.value ? formatDate(params.value) : '—'
    },
    { 
      field: 'totalAmount', 
      headerName: 'Total', 
      sortable: true, 
      filter: true,
      suppressHeaderMenuButton: true,
      cellStyle: { textAlign: 'left' },
      headerClass: 'ag-left-aligned-header',
      valueFormatter: params => params.value ? formatMoney(params.value) : '—'
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      sortable: true, 
      filter: true,
      suppressHeaderMenuButton: true,
      cellStyle: { textAlign: 'left' },
      headerClass: 'ag-left-aligned-header',
      valueFormatter: params => params.value === 'CREATED' ? 'Not paid' : (params.value || '—')
    },
    { 
      field: 'items', 
      headerName: 'Items', 
      sortable: true, 
      filter: true,
      suppressHeaderMenuButton: true,
      cellStyle: { textAlign: 'left' },
      headerClass: 'ag-left-aligned-header',
      valueFormatter: params => {
        const itemCount = params.data?.itemCount || (params.value ? params.value.length : 0);
        const unitCount = params.data?.unitCount || 0;
        if (itemCount === 0 && unitCount === 0) return '—';
        if (unitCount === 0 || unitCount === undefined) return `${itemCount} product${itemCount !== 1 ? 's' : ''}`;
        return `${itemCount} product${itemCount !== 1 ? 's' : ''} (${unitCount} unit${unitCount !== 1 ? 's' : ''})`;
      }
    }
  ];

  return (
    <div className="app success-page">
      <div className="dot-grid" />
      <div className="success-icon">
        <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="success-title">Payment Successful!</h1>
      
      <div className="receipt-card">
        <div className="receipt-header">
          <h3 className="receipt-title">Order Confirmation</h3>
          <span className="receipt-badge">{orderData.status || 'UNKNOWN'}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Order ID:</span>
          <span className="receipt-value">{orderData.orderId || '—'}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Date:</span>
          <span className="receipt-value">{orderData.capturedAt ? formatDate(orderData.capturedAt) : '—'}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-label">Capture ID:</span>
          <span className="receipt-value">{orderData.captureId || '—'}</span>
        </div>
        <div className="receipt-row receipt-total">
          <span className="receipt-label">Amount Paid:</span>
          <span className="receipt-value money-text">{orderData.amountPaid ? formatMoney(parseFloat(orderData.amountPaid.replace(/[$,]/g, ''))) : formatMoney(orderData.grandTotal || 0)}</span>
        </div>
        {orderData.payerName && (
          <div className="receipt-row">
            <span className="receipt-label">Payer Name:</span>
            <span className="receipt-value">{orderData.payerName}</span>
          </div>
        )}
        {orderData.payerEmail && (
          <div className="receipt-row">
            <span className="receipt-label">Payer Email:</span>
            <span className="receipt-value">{orderData.payerEmail}</span>
          </div>
        )}

        {orderData.items && orderData.items.length > 0 && (
          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
            <h4 style={{ marginBottom: '12px', color: 'var(--text-primary)' }}>Purchased Items</h4>
            {orderData.items.map((item, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px', textAlign: 'left' }}>{item.name}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'left' }}>
                    Vendor: {item.vendor || 'N/A'} | Qty: {item.quantity}
                  </div>
                </div>
                <div style={{ textAlign: 'right', marginLeft: '16px', flexShrink: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {formatMoney((item.unit_amount_cents * item.quantity) / 100)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {formatMoney(item.unit_amount_cents / 100)} each
                  </div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)', fontWeight: 700 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Items:</span>
                <span className="money-text">{formatMoney(orderData.itemsTotal || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Shipping:</span>
                <span className="money-text">{formatMoney(orderData.shipping || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--electric-blue)', fontSize: '18px' }}>
                <span>Total:</span>
                <span className="money-text">{formatMoney(orderData.grandTotal || 0)}</span>
              </div>
            </div>
          </div>
        )}
        <div className="receipt-verified">Verified via PayPal Orders API</div>
      </div>

      <div className="card grid-card">
        <div className="grid-header">
          <h2>Order History</h2>
        </div>
        {toastMessage && (
          <div style={{
            position: 'fixed',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#10B981',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            zIndex: 1000,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
          }}>
            {toastMessage}
          </div>
        )}
        {orders.length === 0 ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>No completed orders yet</p>
          </div>
        ) : (
          <div className="ag-theme-quartz aurora-dark grid-container">
            <AgGridReact
              ref={gridRef}
              rowData={orders}
              columnDefs={orderHistoryColumnDefs}
              defaultColDef={{
                sortable: true,
                filter: true,
                resizable: true,
                flex: 1,
                minWidth: 100
              }}
              domLayout='autoHeight'
            />
          </div>
        )}
        {orders.length > 0 && (
          <div style={{ padding: '12px 24px', textAlign: 'center' }}>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to clear all order history?')) {
                  clearOrders();
                  setOrders([]);
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '13px',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '4px 8px'
              }}
            >
              Clear history
            </button>
          </div>
        )}
      </div>

      <button onClick={() => navigate('/')} className="btn btn-primary" style={{ marginTop: '24px' }}>
        Back to Home
      </button>

      <footer className="footer">
        Built for the PayPal AI Hackathon 2026
      </footer>
    </div>
  );
}

// Cancel page component
function CancelPage() {
  const navigate = useNavigate();

  return (
    <div className="app success-page">
      <div className="dot-grid" />
      <h2 style={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 700, marginBottom: '8px' }}>Payment Cancelled</h2>
      <div className="card" style={{ maxWidth: '500px', margin: '24px auto' }}>
        <div className="card-body">
          <p style={{ color: '#BBD0F5', fontSize: '16px' }}>Your payment was cancelled. No charges were made.</p>
        </div>
      </div>
      <button onClick={() => navigate('/')} className="btn btn-primary">Back to Home</button>
      <footer className="footer">
        Built for the PayPal AI Hackathon 2026
      </footer>
    </div>
  );
}

// Main App with Router
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<ProcurementPage />} />
        <Route path="/success" element={<SuccessPageErrorBoundary><SuccessPage /></SuccessPageErrorBoundary>} />
        <Route path="/cancel" element={<CancelPage />} />
      </Routes>
    </Router>
  );
}

export default App;
