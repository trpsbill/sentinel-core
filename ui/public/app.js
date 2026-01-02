// API Configuration
const API_BASE_URL = 'http://localhost:3001';
const CANDLES_LIMIT = 300;
const DECISIONS_LIMIT = 300;

// EMA Calculation
function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  const emaData = [];

  if (data.length === 0) return emaData;

  // First EMA value is the first close price
  let ema = data[0].close;
  emaData.push({ time: data[0].time, value: ema });

  // Calculate subsequent EMA values
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

async function fetchDecisions() {
  const response = await fetch(`${API_BASE_URL}/api/decisions?limit=${DECISIONS_LIMIT}`);
  if (!response.ok) throw new Error('Failed to fetch decisions');
  const data = await response.json();
  return data.decisions || [];
}

// Convert ISO timestamp to Unix seconds
function toUnixTime(isoString) {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

// Transform and prepare chart data
function prepareChartData(candles, decisions) {
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

  // Filter and transform decision markers (BUY and SELL only)
  const markers = decisions
    .filter(d => d.action === 'BUY' || d.action === 'SELL')
    .map(d => ({
      time: toUnixTime(d.candleBucket),
      position: d.action === 'BUY' ? 'belowBar' : 'aboveBar',
      color: d.action === 'BUY' ? '#26a69a' : '#ef5350',
      shape: d.action === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: `${d.action} (${d.confidence.toFixed(2)})`
    }));

  return { candleData, ema9Data, ema21Data, markers };
}

// Initialize chart
async function initChart() {
  try {
    // Fetch data
    const [candles, decisions] = await Promise.all([
      fetchCandles(),
      fetchDecisions()
    ]);

    const { candleData, ema9Data, ema21Data, markers } = prepareChartData(candles, decisions);

    // Create chart
    const chartContainer = document.getElementById('chart');
    const chart = window.LightweightCharts.createChart(chartContainer, {
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
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    candleSeries.setData(candleData);

    // Add markers to candlestick series
    candleSeries.setMarkers(markers);

    // Add EMA(9) line
    const ema9Series = chart.addLineSeries({
      color: '#2962FF',
      lineWidth: 2,
      title: 'EMA(9)',
    });
    ema9Series.setData(ema9Data);

    // Add EMA(21) line
    const ema21Series = chart.addLineSeries({
      color: '#FF6D00',
      lineWidth: 2,
      title: 'EMA(21)',
    });
    ema21Series.setData(ema21Data);

    // Auto-resize chart on window resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainer) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({
        width: newRect.width,
        height: newRect.height,
      });
      // Ensure markers persist after resize
      candleSeries.setMarkers(markers);
    });

    resizeObserver.observe(chartContainer);

    // Fit content
    chart.timeScale().fitContent();

    // Auto-refresh every 60 seconds
    setInterval(async () => {
      try {
        const [candles, decisions] = await Promise.all([
          fetchCandles(),
          fetchDecisions()
        ]);

        const { candleData, ema9Data, ema21Data, markers } = prepareChartData(candles, decisions);

        // Update all series with new data
        candleSeries.setData(candleData);
        ema9Series.setData(ema9Data);
        ema21Series.setData(ema21Data);
        candleSeries.setMarkers(markers);

        // Scroll to show latest data
        chart.timeScale().scrollToRealTime();

        console.log('Chart refreshed at', new Date().toISOString());
        console.log('Loaded candles:', candleData.length, '| Latest:', candleData[candleData.length - 1]?.time);
        console.log('Loaded decisions:', markers.length, '| Latest:', markers[markers.length - 1]?.time);
      } catch (error) {
        console.error('Error refreshing chart:', error);
      }
    }, 60000); // 60 seconds

  } catch (error) {
    console.error('Error initializing chart:', error);
    document.getElementById('chart').innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ef5350;">
        Error loading chart data. Please check the API connection.
      </div>
    `;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initChart);
