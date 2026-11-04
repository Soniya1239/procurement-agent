import { useState, useRef, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useSearchParams } from 'react-router-dom';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import './App.css';

// Main procurement page component
function ProcurementPage() {
  const [command, setCommand] = useState('We have a $500 budget. Find 5 mechanical keyboards and 5 wireless mice from our approved vendors.');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [useSampleData, setUseSampleData] = useState(false);
  const [showWhySection, setShowWhySection] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [groupByVendor, setGroupByVendor] = useState(false);
  const gridRef = useRef();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setData(null);

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
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprovePay = async () => {
    if (!data?.plan?.best || isRedirecting) return;

    setIsRedirecting(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:3001/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: data.plan })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.approveUrl) {
        window.location.href = result.approveUrl;
      }
    } catch (err) {
      setError(err.message);
      setIsRedirecting(false);
    }
  };

  const exportToCsv = () => {
    gridRef.current.api.exportDataAsCsv();
  };

  // Prepare row data for AG Grid
  const getRowData = () => {
    if (!data?.quotes) return [];

    const chosenSkus = new Set(data.plan?.best?.items?.map(i => i.sku) || []);
    const rejectedMap = {};
    data.plan?.rejected?.forEach(r => {
      rejectedMap[r.sku] = r.reason;
    });

    const rowData = data.quotes.map(quote => ({
      vendor: quote.vendor,
      product: quote.name,
      category: quote.category,
      quantity: quote.quantity,
      unitPrice: quote.unitPrice,
      lineTotal: quote.lineTotal,
      shipping: quote.shipping,
      rating: quote.rating,
      status: chosenSkus.has(quote.sku) ? 'Selected' : (rejectedMap[quote.sku] ? getShortReason(rejectedMap[quote.sku]) : 'Not selected'),
      isChosen: chosenSkus.has(quote.sku),
      isRejected: !!rejectedMap[quote.sku],
      rejectReason: rejectedMap[quote.sku] || ''
    }));

    // Sort by vendor if grouping is enabled
    if (groupByVendor) {
      rowData.sort((a, b) => a.vendor.localeCompare(b.vendor));
    }

    return rowData;
  };

  const getShortReason = (reason) => {
    if (reason.includes('stock')) return 'Low stock';
    if (reason.includes('rating')) return 'Low rating';
    if (reason.includes('budget')) return 'Over budget';
    return 'Skipped';
  };

  // AG Grid column definitions
  const columnDefs = [
    {
      field: 'vendor',
      sortable: true,
      filter: true,
      headerName: 'Vendor',
      width: 150
    },
    {
      field: 'product',
      sortable: true,
      filter: true,
      headerName: 'Product',
      width: 200,
      resizable: true
    },
    {
      field: 'category',
      sortable: true,
      filter: true,
      headerName: 'Category',
      width: 180,
      resizable: true
    },
    {
      field: 'quantity',
      sortable: true,
      filter: true,
      headerName: 'Qty',
      width: 80
    },
    {
      field: 'unitPrice',
      sortable: true,
      filter: true,
      headerName: 'Unit Price',
      width: 100,
      valueFormatter: params => params.value ? `$${params.value.toFixed(2)}` : ''
    },
    {
      field: 'lineTotal',
      sortable: true,
      filter: true,
      headerName: 'Line Total',
      width: 120,
      valueFormatter: params => params.value ? `$${params.value.toFixed(2)}` : ''
    },
    {
      field: 'shipping',
      sortable: true,
      filter: true,
      headerName: 'Shipping',
      width: 100,
      valueFormatter: params => params.value ? `$${params.value.toFixed(2)}` : ''
    },
    {
      field: 'rating',
      sortable: true,
      filter: true,
      headerName: 'Rating',
      width: 80,
      valueFormatter: params => params.value ? params.value.toFixed(1) : ''
    },
    {
      field: 'status',
      sortable: true,
      filter: true,
      headerName: 'Status',
      width: 120
    }
  ];

  // Row styling based on selection/rejection
  const getRowStyle = params => {
    if (params.data.isChosen) {
      return { backgroundColor: '#d4edda' };
    }
    if (params.data.isRejected) {
      return { backgroundColor: '#f8f9fa', color: '#6c757d' };
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
    <div className="app">
      <h1>Agentic Procurement Buyer</h1>
      
      {/* Command Input */}
      <div className="input-section">
        <label htmlFor="command">Procurement Command:</label>
        <textarea
          id="command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          rows={3}
        />
        <div className="input-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={useSampleData}
              onChange={(e) => setUseSampleData(e.target.checked)}
            />
            Use sample data (skip LLM parsing)
          </label>
        </div>
        <button 
          onClick={handleSubmit} 
          disabled={loading}
          className="primary-button"
        >
          {loading ? 'Processing...' : 'Find Best Bundle'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          Error: {error}
        </div>
      )}

      {data && (
        <>
          {/* Agent Activity Panel */}
          <div className="activity-panel">
            <h2>Agent Activity</h2>
            <ul className="steps-list">
              {data.steps.map((step, index) => (
                <li key={index} className="step-item">
                  <span className="step-bullet">✓</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>

          {/* Summary Card */}
          {data.plan?.best && (
            <div className="summary-card">
              <h2>Selected Bundle</h2>
              <div className="summary-details">
                <div className="summary-item">
                  <span className="label">Items Total:</span>
                  <span className="value">${data.plan.best.itemsTotal.toFixed(2)}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Shipping:</span>
                  <span className="value">${data.plan.best.shipping.toFixed(2)}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Grand Total:</span>
                  <span className="value grand-total">${data.plan.best.grandTotal.toFixed(2)}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Budget:</span>
                  <span className="value">${data.parsed.budget.toFixed(2)}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Remaining:</span>
                  <span className={`value ${(data.parsed.budget - data.plan.best.grandTotal) >= 0 ? 'positive' : 'negative'}`}>
                    ${(data.parsed.budget - data.plan.best.grandTotal).toFixed(2)}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="label">Avg Rating:</span>
                  <span className="value">{data.plan.best.avgRating.toFixed(1)}/5</span>
                </div>
              </div>
              <div className="explanation">
                <strong>AI Explanation:</strong> {typeof data.explanation === 'string' ? data.explanation : data.explanation?.text}
                {data.usedFallback && (
                  <div className="fallback-notice">⚠️ Using fallback mode due to LLM unavailability</div>
                )}
              </div>
              <div className="pay-button-container">
                <span className="human-approval-badge">⚠️ Human approval required</span>
                <button 
                  onClick={handleApprovePay}
                  className="paypal-button"
                  disabled={isRedirecting}
                >
                  {isRedirecting ? 'Redirecting to PayPal...' : 'Approve & Pay with PayPal'}
                </button>
              </div>
              <button 
                onClick={() => setShowWhySection(!showWhySection)}
                className="secondary-button"
              >
                {showWhySection ? 'Hide' : 'Show'} Why This Bundle?
              </button>
            </div>
          )}

          {data.plan?.best && showWhySection && (
            <div className="why-section">
              <h3>Why This Bundle?</h3>
              
              <div className="alternatives-section">
                <h4>Top 3 Alternatives</h4>
                {data.plan.alternatives.length > 0 ? (
                  data.plan.alternatives.map((alt, idx) => (
                    <div key={idx} className="alternative-item">
                      <div className="alt-header">
                        <strong>Option #{idx + 2}</strong>
                        <span>Total: ${alt.grandTotal.toFixed(2)} | Rating: {alt.avgRating.toFixed(1)}/5</span>
                      </div>
                      <div className="alt-items">
                        {alt.items.map((item, i) => (
                          <div key={i} className="alt-item">
                            {item.quantity}x {item.name} from {item.vendor} (${item.lineTotal.toFixed(2)})
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p>No alternatives available</p>
                )}
              </div>

              <div className="rejected-section">
                <h4>Rejected Options</h4>
                {data.plan.rejected.length > 0 ? (
                  <ul className="rejected-list">
                    {data.plan.rejected.map((rej, idx) => (
                      <li key={idx}>
                        <strong>{rej.sku}</strong>: {rej.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No items were rejected</p>
                )}
              </div>
            </div>
          )}

          {data.plan?.error && (
            <div className="error-card">
              <h2>No Valid Bundle Found</h2>
              <p>{data.plan.error}</p>
            </div>
          )}

          {/* AG Grid Table */}
          <div className="grid-section">
            <div className="grid-header">
              <h2>Candidate Quotes</h2>
              <div className="grid-controls">
                <button 
                  onClick={() => setGroupByVendor(!groupByVendor)}
                  className={`secondary-button ${groupByVendor ? 'active' : ''}`}
                >
                  {groupByVendor ? 'Ungroup' : 'Group by vendor'}
                </button>
                <button onClick={exportToCsv} className="export-button">
                  Export CSV
                </button>
              </div>
            </div>
            <div className="ag-theme-alpine grid-container">
              <AgGridReact
                ref={gridRef}
                rowData={getRowData()}
                columnDefs={columnDefs}
                defaultColDef={{
                  sortable: true,
                  filter: true,
                  resizable: true,
                  flex: 1
                }}
                rowGroupPanelShow='always'
                groupDefaultExpanded={1}
                getRowStyle={getRowStyle}
                pinnedBottomRowData={getPinnedBottomRowData()}
                domLayout='autoHeight'
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Success page component
function SuccessPage() {
  const [searchParams] = useSearchParams();
  const [orderData, setOrderData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const gridRef = useRef();
  const navigate = useNavigate();
  const hasCaptured = useRef(false);

  useEffect(() => {
    const captureOrder = async () => {
      const token = searchParams.get('token');
      if (!token) {
        setError('No order token found');
        setLoading(false);
        return;
      }

      // Prevent duplicate calls
      if (hasCaptured.current) {
        return;
      }
      hasCaptured.current = true;

      try {
        // Capture the PayPal order
        const captureResponse = await fetch(`http://localhost:3001/api/capture/${token}`, {
          method: 'POST'
        });

        if (!captureResponse.ok) {
          const errorData = await captureResponse.json();
          throw new Error(errorData.error || `Failed to capture order: ${captureResponse.status}`);
        }

        const captureResult = await captureResponse.json();
        setOrderData(captureResult);

        // Fetch order history
        const ordersResponse = await fetch('http://localhost:3001/api/orders');
        if (ordersResponse.ok) {
          const ordersData = await ordersResponse.json();
          setOrders(ordersData);
        }
      } catch (err) {
        // Don't replace successful data with error from duplicate call
        if (!orderData) {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    };

    captureOrder();
  }, [searchParams, orderData]);

  if (loading) {
    return (
      <div className="app">
        <h1>Processing Payment...</h1>
        <p>Please wait while we confirm your order.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <h1>Payment Error</h1>
        <div className="error-message">{error}</div>
        <button onClick={() => navigate('/')} className="primary-button">Back to Home</button>
      </div>
    );
  }

  const orderHistoryColumnDefs = [
    { field: 'orderId', headerName: 'Order ID', sortable: true, filter: true },
    { 
      field: 'status', 
      headerName: 'Status', 
      sortable: true, 
      filter: true,
      valueFormatter: params => params.value === 'CREATED' ? 'Not paid' : params.value
    },
    { 
      field: 'grandTotal', 
      headerName: 'Total', 
      sortable: true, 
      filter: true,
      valueFormatter: params => params.value ? `$${params.value.toFixed(2)}` : 'N/A'
    },
    { 
      field: 'items', 
      headerName: 'Items', 
      sortable: true, 
      filter: true,
      valueFormatter: params => params.value ? params.value.length : 0
    },
    { 
      field: 'createdAt', 
      headerName: 'Date', 
      sortable: true, 
      filter: true,
      valueFormatter: params => new Date(params.value).toLocaleString()
    }
  ];

  return (
    <div className="app">
      <h1>Payment Successful!</h1>
      
      <div className="summary-card">
        <h2>Order Confirmation</h2>
        <div className="summary-details">
          <div className="summary-item">
            <span className="label">Order ID:</span>
            <span className="value">{orderData.orderId}</span>
          </div>
          <div className="summary-item">
            <span className="label">Status:</span>
            <span className="value positive">{orderData.status}</span>
          </div>
          {orderData.captureId && (
            <div className="summary-item">
              <span className="label">Capture ID:</span>
              <span className="value">{orderData.captureId}</span>
            </div>
          )}
          {orderData.amountPaid && (
            <div className="summary-item">
              <span className="label">Amount Paid:</span>
              <span className="value grand-total">${orderData.amountPaid}</span>
            </div>
          )}
          {orderData.payerName && (
            <div className="summary-item">
              <span className="label">Payer Name:</span>
              <span className="value">{orderData.payerName}</span>
            </div>
          )}
          {orderData.payerEmail && (
            <div className="summary-item">
              <span className="label">Payer Email:</span>
              <span className="value">{orderData.payerEmail}</span>
            </div>
          )}
        </div>
      </div>

      {orderData.items && orderData.items.length > 0 && (
        <div className="summary-card">
          <h2>Purchased Items</h2>
          <div className="items-list">
            {orderData.items.map((item, index) => (
              <div key={index} className="item-row">
                <div className="item-name">{item.name}</div>
                <div className="item-details">
                  <span>Vendor: {item.vendor || 'N/A'}</span>
                  <span>Qty: {item.quantity}</span>
                  <span>Price: ${(item.unit_amount_cents / 100).toFixed(2)}</span>
                  <span>Line Total: ${((item.unit_amount_cents * item.quantity) / 100).toFixed(2)}</span>
                </div>
              </div>
            ))}
            <div className="item-row totals">
              <div className="item-name">Totals</div>
              <div className="item-details">
                <span>Items: ${(orderData.itemsTotal || 0).toFixed(2)}</span>
                <span>Shipping: ${(orderData.shipping || 0).toFixed(2)}</span>
                <span className="grand-total">Total: ${(orderData.grandTotal || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid-section">
        <h2>Order History</h2>
        <div className="ag-theme-alpine grid-container">
          <AgGridReact
            ref={gridRef}
            rowData={orders}
            columnDefs={orderHistoryColumnDefs}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
              flex: 1
            }}
            domLayout='autoHeight'
          />
        </div>
      </div>

      <button onClick={() => navigate('/')} className="primary-button" style={{ marginTop: '20px' }}>
        Back to Home
      </button>
    </div>
  );
}

// Cancel page component
function CancelPage() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <h1>Payment Cancelled</h1>
      <div className="error-card">
        <p>Your payment was cancelled. No charges were made.</p>
      </div>
      <button onClick={() => navigate('/')} className="primary-button" style={{ marginTop: '20px' }}>
        Back to Home
      </button>
    </div>
  );
}

// Main App with Router
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<ProcurementPage />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/cancel" element={<CancelPage />} />
      </Routes>
    </Router>
  );
}

export default App;
