// API Configuration
const API_BASE_URL = 'http://localhost:3001';
const CANDLES_LIMIT = 300;
const POSITION_REFRESH_INTERVAL = 15000; // 15 seconds
const CHART_REFRESH_INTERVAL = 60000; // 60 seconds

// Global state
let chartInstance = null;
let candleSeriesInstance = null;
let entryPriceLineInstance = null;
let currentPosition = null;
let currentPortfolio = null;
let lastPrice = null;
let currentMarkers = [];

// EMA Calculation
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const emaData = [];

  if (data.length === 0) return emaData;

  let ema = data[0].close;
  emaData.push({ time: data[0].time, value: ema });

  for (let i = 1; i < data.length; i++) {
    ema = (data[i].close * k) + (ema * (1 - k));
    emaData.push({ time: data[i].time, value: ema });
  }

  return emaData;
}

// Fetch data from API
async function fetchCandles() {
  const response = await fetch(`${API_BASE_URL}/api/candles?limit=${CANDLES_LIMIT}`);
  if (!response.ok) throw new Error('Failed to fetch candles');
  return await response.json();
}

// fetchDecisions removed - we now use fetchTrades for chart markers

async function fetchPosition() {
  const response = await fetch(`${API_BASE_URL}/api/position`);
  if (!response.ok) throw new Error('Failed to fetch position');
  const data = await response.json();
  return data.position;
}

async function fetchPortfolio() {
  const response = await fetch(`${API_BASE_URL}/api/portfolio`);
  if (!response.ok) throw new Error('Failed to fetch portfolio');
  return await response.json();
}

async function fetchTrades() {
  const response = await fetch(`${API_BASE_URL}/api/trades?limit=50`);
  if (!response.ok) throw new Error('Failed to fetch trades');
  const data = await response.json();
  return data.trades || [];
}

// Convert ISO timestamp to Unix seconds
function toUnixTime(isoString) {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

// Format currency
function formatUSD(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatBTC(value) {
  return value.toFixed(8) + ' BTC';
}

function formatDateTime(isoString) {
  const date = new Date(isoString);
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

// Calculate Unrealized PnL
function calculateUnrealizedPnL(entryPrice, currentPrice, sizeBTC) {
  if (!entryPrice || !currentPrice || !sizeBTC) return null;
  return (currentPrice - entryPrice) * sizeBTC;
}

// Update Portfolio Summary Bar
function updatePortfolioSummary(portfolio, position) {
  try {
    // Update USD Balance
    const usdBalanceEl = document.getElementById('usd-balance');
    if (portfolio && portfolio.summary) {
      usdBalanceEl.textContent = formatUSD(portfolio.summary.cash);
      usdBalanceEl.classList.remove('data-unavailable');
    } else {
      usdBalanceEl.textContent = 'Unavailable';
      usdBalanceEl.classList.add('data-unavailable');
    }

    // Update BTC Balance
    const btcBalanceEl = document.getElementById('btc-balance');
    if (portfolio && portfolio.summary) {
      const btcBalance = portfolio.positions.find(p => p.symbol === 'BTC')?.quantity || 0;
      btcBalanceEl.textContent = formatBTC(btcBalance);
      btcBalanceEl.classList.remove('data-unavailable');
    } else {
      btcBalanceEl.textContent = 'Unavailable';
      btcBalanceEl.classList.add('data-unavailable');
    }

    // Update Position State Badge
    const positionBadgeEl = document.getElementById('position-state-badge');
    if (position) {
      positionBadgeEl.textContent = position.state;
      positionBadgeEl.className = 'position-state ' + position.state.toLowerCase();
    } else {
      positionBadgeEl.textContent = 'Unknown';
      positionBadgeEl.className = 'position-state flat';
    }
  } catch (error) {
    console.error('Error updating portfolio summary:', error);
  }
}

// Update Position Card
function updatePositionCard(position, currentPrice) {
  const positionContentEl = document.getElementById('position-content');

  if (!position) {
    positionContentEl.innerHTML = '<div class="position-empty">Data unavailable</div>';
    return;
  }

  if (position.state === 'FLAT') {
    positionContentEl.innerHTML = '<div class="position-empty">No open position</div>';
    return;
  }

  // Position is LONG
  const unrealizedPnL = calculateUnrealizedPnL(position.entry_price, currentPrice, position.size_btc);
  const pnlClass = unrealizedPnL > 0 ? 'pnl-positive' : 'pnl-negative';
  const pnlText = unrealizedPnL !== null ? formatUSD(unrealizedPnL) : 'N/A';

  positionContentEl.innerHTML = `
    <div class="position-field">
      <span class="position-field-label">State</span>
      <span class="position-field-value">LONG</span>
    </div>
    <div class="position-field">
      <span class="position-field-label">Entry Price</span>
      <span class="position-field-value">${formatUSD(position.entry_price)}</span>
    </div>
    <div class="position-field">
      <span class="position-field-label">Size</span>
      <span class="position-field-value">${formatBTC(position.size_btc)}</span>
    </div>
    <div class="position-field">
      <span class="position-field-label">Entry Time</span>
      <span class="position-field-value">${formatDateTime(position.entry_bucket)}</span>
    </div>
    <div class="position-field">
      <span class="position-field-label">Unrealized PnL</span>
      <span class="position-field-value ${pnlClass}">${pnlText}</span>
    </div>
  `;
}

// Update Trades List
function updateTradesList(trades) {
  const tradesListEl = document.getElementById('trades-list');

  if (!trades || trades.length === 0) {
    tradesListEl.innerHTML = '<div class="trades-empty">No trades yet</div>';
    return;
  }

  // Generate HTML for each trade
  const tradesHTML = trades.map(trade => {
    const executedDate = new Date(trade.executedAt);
    const timeStr = executedDate.toISOString().replace('T', ' ').substring(0, 19);
    const sideClass = trade.side.toLowerCase();

    return `
      <div class="trade-item">
        <div class="trade-header">
          <span class="trade-side ${sideClass}">${trade.side}</span>
          <span class="trade-time">${timeStr}</span>
        </div>
        <div class="trade-details">
          <div class="trade-detail-row">
            <span class="trade-detail-label">Price:</span>
            <span>${formatUSD(trade.price)}</span>
          </div>
          <div class="trade-detail-row">
            <span class="trade-detail-label">Amount:</span>
            <span>${formatBTC(trade.quantity)}</span>
          </div>
          <div class="trade-detail-row">
            <span class="trade-detail-label">Total:</span>
            <span>${formatUSD(trade.notional)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  tradesListEl.innerHTML = tradesHTML;
}

// Transform and prepare chart data
function prepareChartData(candles) {
  // Transform candle data for chart
  const candleData = candles.map(c => ({
    time: toUnixTime(c.bucket),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }));

  // Calculate EMAs
  const ema9Data = calculateEMA(candleData, 9);
  const ema21Data = calculateEMA(candleData, 21);

  return { candleData, ema9Data, ema21Data };
}

// Add or update entry price line on chart
function updateEntryPriceLine(position) {
  if (!candleSeriesInstance) return;

  // Remove existing entry price line
  if (entryPriceLineInstance) {
    candleSeriesInstance.removePriceLine(entryPriceLineInstance);
    entryPriceLineInstance = null;
  }

  // Add entry price line if position is LONG
  if (position && position.state === 'LONG' && position.entry_price) {
    entryPriceLineInstance = candleSeriesInstance.createPriceLine({
      price: position.entry_price,
      color: '#2962FF',
      lineWidth: 2,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `Entry @ ${formatUSD(position.entry_price)}`
    });
  }
}

// Update chart markers
function updateChartMarkers(trades, position) {
  if (!candleSeriesInstance) return;

  // Transform execution markers (actual trades only)
  const executionMarkers = trades.map(trade => ({
    time: toUnixTime(trade.executedAt),
    position: trade.side === 'BUY' ? 'belowBar' : 'aboveBar',
    color: trade.side === 'BUY' ? '#26a69a' : '#ef5350',
    shape: trade.side === 'BUY' ? 'arrowUp' : 'arrowDown',
    text: `${trade.side} @ ${formatUSD(trade.price)}`
  }));

  // Add entry marker if position is LONG
  const markers = [...executionMarkers];
  if (position && position.state === 'LONG' && position.entry_bucket) {
    markers.push({
      time: toUnixTime(position.entry_bucket),
      position: 'inBar',
      color: '#2962FF',
      shape: 'circle',
      text: `Entry @ ${formatUSD(position.entry_price)}\nSize: ${formatBTC(position.size_btc)}`
    });
  }

  currentMarkers = markers;
  candleSeriesInstance.setMarkers(markers);
}

// Refresh position and portfolio data
async function refreshPositionAndPortfolio(trades) {
  try {
    const [position, portfolio, latestTrades] = await Promise.all([
      fetchPosition().catch(err => {
        console.error('Error fetching position:', err);
        return null;
      }),
      fetchPortfolio().catch(err => {
        console.error('Error fetching portfolio:', err);
        return null;
      }),
      fetchTrades().catch(err => {
        console.error('Error fetching trades:', err);
        return [];
      })
    ]);

    currentPosition = position;
    currentPortfolio = portfolio;

    // Update UI
    updatePortfolioSummary(portfolio, position);
    updatePositionCard(position, lastPrice);
    updateTradesList(latestTrades);
    updateEntryPriceLine(position);

    // Update markers with latest trades
    if (latestTrades) {
      updateChartMarkers(latestTrades, position);
    }

    console.log('Position & Portfolio refreshed at', new Date().toISOString());
  } catch (error) {
    console.error('Error refreshing position and portfolio:', error);
  }
}

// Initialize chart
async function initChart() {
  try {
    // Fetch all data
    const [candles, position, portfolio, trades] = await Promise.all([
      fetchCandles(),
      fetchPosition().catch(err => {
        console.error('Error fetching position:', err);
        return null;
      }),
      fetchPortfolio().catch(err => {
        console.error('Error fetching portfolio:', err);
        return null;
      }),
      fetchTrades().catch(err => {
        console.error('Error fetching trades:', err);
        return [];
      })
    ]);

    currentPosition = position;
    currentPortfolio = portfolio;

    // Get last price
    if (candles.length > 0) {
      lastPrice = candles[candles.length - 1].close;
    }

    // Update UI components
    updatePortfolioSummary(portfolio, position);
    updatePositionCard(position, lastPrice);
    updateTradesList(trades);

    const { candleData, ema9Data, ema21Data } = prepareChartData(candles);

    // Create chart
    const chartContainer = document.getElementById('chart');
    chartInstance = window.LightweightCharts.createChart(chartContainer, {
      layout: {
        background: { color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2e39' },
        horzLines: { color: '#2a2e39' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
    });

    // Add candlestick series
    candleSeriesInstance = chartInstance.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeriesInstance.setData(candleData);

    // Add entry price line if position is LONG
    updateEntryPriceLine(position);

    // Add execution markers to candlestick series
    updateChartMarkers(trades, position);

    // Add EMA(9) line
    const ema9Series = chartInstance.addLineSeries({
      color: '#2962FF',
      lineWidth: 2,
      title: 'EMA(9)',
    });
    ema9Series.setData(ema9Data);

    // Add EMA(21) line
    const ema21Series = chartInstance.addLineSeries({
      color: '#FF6D00',
      lineWidth: 2,
      title: 'EMA(21)',
    });
    ema21Series.setData(ema21Data);

    // Auto-resize chart on window resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainer) return;
      const newRect = entries[0].contentRect;
      chartInstance.applyOptions({
        width: newRect.width,
        height: newRect.height,
      });
      // Re-apply markers after resize
      if (currentMarkers.length > 0) {
        candleSeriesInstance.setMarkers(currentMarkers);
      }
    });

    resizeObserver.observe(chartContainer);

    // Fit content
    chartInstance.timeScale().fitContent();

    // Store latest trades for refresh cycle
    let latestTrades = trades;

    // Auto-refresh chart every 60 seconds
    setInterval(async () => {
      try {
        const [candles, trades] = await Promise.all([
          fetchCandles(),
          fetchTrades()
        ]);

        latestTrades = trades;

        // Update last price
        if (candles.length > 0) {
          lastPrice = candles[candles.length - 1].close;
        }

        const { candleData, ema9Data, ema21Data } = prepareChartData(candles);

        // Update all series with new data
        candleSeriesInstance.setData(candleData);
        ema9Series.setData(ema9Data);
        ema21Series.setData(ema21Data);

        // Update execution markers
        updateChartMarkers(trades, currentPosition);

        // Update position card with new price
        updatePositionCard(currentPosition, lastPrice);

        // Update entry price line
        updateEntryPriceLine(currentPosition);

        // Scroll to show latest data
        chartInstance.timeScale().scrollToRealTime();

        console.log('Chart refreshed at', new Date().toISOString());
      } catch (error) {
        console.error('Error refreshing chart:', error);
      }
    }, CHART_REFRESH_INTERVAL);

    // Auto-refresh position and portfolio every 15 seconds
    setInterval(() => refreshPositionAndPortfolio(latestTrades), POSITION_REFRESH_INTERVAL);

  } catch (error) {
    console.error('Error initializing chart:', error);
    document.getElementById('chart').innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ef5350;">
        Error loading chart data. Please check the API connection.
      </div>
    `;
  }
}

// Reset simulation functionality
function initResetModal() {
  const resetBtn = document.getElementById('reset-btn');
  const modal = document.getElementById('reset-modal');
  const cancelBtn = document.getElementById('reset-cancel-btn');
  const confirmBtn = document.getElementById('reset-confirm-btn');
  const confirmInput = document.getElementById('reset-confirm-input');
  const statusDiv = document.getElementById('reset-status');

  // Open modal
  resetBtn.addEventListener('click', () => {
    modal.classList.add('active');
    confirmInput.value = '';
    confirmInput.focus();
    statusDiv.className = 'modal-status';
    statusDiv.textContent = '';
  });

  // Close modal
  const closeModal = () => {
    modal.classList.remove('active');
    confirmInput.value = '';
    confirmBtn.disabled = true;
  };

  cancelBtn.addEventListener('click', closeModal);

  // Close modal on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Enable/disable confirm button based on input
  confirmInput.addEventListener('input', (e) => {
    confirmBtn.disabled = e.target.value !== 'RESET_SIMULATION';
  });

  // Handle Enter key in input
  confirmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && confirmInput.value === 'RESET_SIMULATION') {
      confirmBtn.click();
    }
  });

  // Confirm reset
  confirmBtn.addEventListener('click', async () => {
    if (confirmInput.value !== 'RESET_SIMULATION') {
      return;
    }

    // Disable buttons during reset
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    resetBtn.disabled = true;
    statusDiv.className = 'modal-status';
    statusDiv.textContent = 'Resetting simulation...';

    try {
      const response = await fetch(`${API_BASE_URL}/api/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          confirm: 'RESET_SIMULATION'
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Success
        statusDiv.className = 'modal-status success';
        statusDiv.textContent = `Success! Cleared ${data.reset.decisions_cleared} decisions and ${data.reset.trades_cleared} trades. Refreshing...`;

        // Wait 2 seconds then reload page
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        // Error from API
        statusDiv.className = 'modal-status error';
        statusDiv.textContent = `Error: ${data.message || 'Failed to reset simulation'}`;
        cancelBtn.disabled = false;
      }
    } catch (error) {
      // Network error
      statusDiv.className = 'modal-status error';
      statusDiv.textContent = `Error: ${error.message}`;
      cancelBtn.disabled = false;
      confirmBtn.disabled = false;
      resetBtn.disabled = false;
    }
  });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  initResetModal();
});
