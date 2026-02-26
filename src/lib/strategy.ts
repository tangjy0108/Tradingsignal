import { calculateEMA, calculateATR, calculateADX, calculateRSI } from './indicators';

export type StrategyResult = {
  symbol: string;
  time: string;
  regime: string;
  price: number;
  direction: 'LONG' | 'SHORT';
  entry_low: number;
  entry_high: number;
  stop: number;
  target: number;
  rr: number;
  logs?: string[];
} | null;

const BINANCE_URLS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com'
];

async function fetchKlinesWithFallback(symbol: string, interval: string, limit: number) {
  let lastError;
  
  // Try Binance endpoints first
  for (const baseUrl of BINANCE_URLS) {
    try {
      const res = await fetch(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (res.ok) {
        const json = await res.json();
        return json.map((d: any) => ({
          time: d[0],
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
        }));
      }
    } catch (e) {
      lastError = e;
      console.warn(`Binance failed for ${symbol} ${interval} on ${baseUrl}, trying next...`);
    }
  }

  // If all Binance endpoints fail, fallback to KuCoin via CORS proxy
  try {
    console.warn(`All Binance endpoints failed for ${symbol} ${interval}, trying KuCoin...`);
    const kucoinSymbol = symbol.replace('USDT', '-USDT');
    const kucoinInterval = interval === '1h' ? '1hour' : interval === '4h' ? '4hour' : interval === '1d' ? '1day' : interval.replace('m', 'min');
    
    const now = Math.floor(Date.now() / 1000);
    let seconds = 60;
    if (interval.endsWith('m')) seconds = parseInt(interval.replace('m', '')) * 60;
    if (interval.endsWith('h')) seconds = parseInt(interval.replace('h', '')) * 3600;
    if (interval.endsWith('d')) seconds = parseInt(interval.replace('d', '')) * 86400;
    const startAt = now - (limit * seconds * 1.5); // 1.5x buffer

    const kucoinUrl = `https://api.kucoin.com/api/v1/market/candles?type=${kucoinInterval}&symbol=${kucoinSymbol}&startAt=${startAt}&endAt=${now}`;
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(kucoinUrl)}`);
    
    if (!res.ok) throw new Error('KuCoin error');
    const json = await res.json();
    if (json.code !== '200000') throw new Error(json.msg);
    
    return json.data.map((d: any) => ({
      time: parseInt(d[0]) * 1000,
      open: parseFloat(d[1]),
      close: parseFloat(d[2]),
      high: parseFloat(d[3]),
      low: parseFloat(d[4]),
    })).reverse();
  } catch (e) {
    throw lastError || new Error('All endpoints failed');
  }
}

// --- Helper functions for Structural Reversal ---

function getSwingPoints(klines: any[], n: number = 3) {
  const highs = new Array(klines.length).fill(false);
  const lows = new Array(klines.length).fill(false);

  for (let i = n; i < klines.length - n; i++) {
    const window = klines.slice(i - n, i + n + 1);
    const windowHighs = window.map(k => k.high);
    const windowLows = window.map(k => k.low);

    if (klines[i].high === Math.max(...windowHighs)) {
      highs[i] = true;
    }
    if (klines[i].low === Math.min(...windowLows)) {
      lows[i] = true;
    }
  }
  return { highs, lows };
}

function detectTrend(klines: any[], swingHighs: boolean[], swingLows: boolean[]) {
  const highs = klines.filter((_, i) => swingHighs[i]).map(k => k.high);
  const lows = klines.filter((_, i) => swingLows[i]).map(k => k.low);

  if (highs.length < 2 || lows.length < 2) {
    return { trend: "RANGE", direction: null, highs, lows };
  }

  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);

  if (lastHighs[1] > lastHighs[0] && lastLows[1] > lastLows[0]) {
    return { trend: "BULLISH", direction: "UP", highs, lows };
  } else if (lastHighs[1] < lastHighs[0] && lastLows[1] < lastLows[0]) {
    return { trend: "BEARISH", direction: "DOWN", highs, lows };
  } else {
    return { trend: "RANGE", direction: null, highs, lows };
  }
}

function findImpulse(klines: any[], swingHighs: boolean[], swingLows: boolean[], direction: string) {
  const highs = klines.filter((_, i) => swingHighs[i]).map(k => k.high);
  const lows = klines.filter((_, i) => swingLows[i]).map(k => k.low);

  if (highs.length === 0 || lows.length === 0) return null;

  if (direction === "UP") {
    return { low: lows[lows.length - 1], high: highs[highs.length - 1] };
  } else if (direction === "DOWN") {
    return { high: highs[highs.length - 1], low: lows[lows.length - 1] };
  }
  return null;
}

function calculatePRZ(low: number, high: number, direction: string) {
  const diff = high - low;
  if (direction === "UP") {
    return { prz_low: high - diff * 0.786, prz_high: high - diff * 0.618 };
  } else {
    return { prz_low: low + diff * 0.618, prz_high: low + diff * 0.786 };
  }
}

function detectDivergence(klines: any[]) {
  const closes = klines.map(k => k.close);
  const rsi = calculateRSI(closes, 14);
  const { highs: swingHighs, lows: swingLows } = getSwingPoints(klines, 3);

  const lows = klines.map((k, i) => ({ ...k, rsi: rsi[i], isSwing: swingLows[i] })).filter(k => k.isSwing);
  const highs = klines.map((k, i) => ({ ...k, rsi: rsi[i], isSwing: swingHighs[i] })).filter(k => k.isSwing);

  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    if (l2.low < l1.low && l2.rsi > l1.rsi) return "BULLISH_DIV";
  }

  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    if (h2.high > h1.high && h2.rsi < h1.rsi) return "BEARISH_DIV";
  }

  return null;
}

function detectEngulfing(klines: any[]) {
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];

  const bullish = (
    prev.close < prev.open &&
    last.close > last.open &&
    last.close > prev.open &&
    last.open < prev.close
  );

  const bearish = (
    prev.close > prev.open &&
    last.close < last.open &&
    last.open > prev.close &&
    last.close < prev.open
  );

  return { bullish, bearish };
}

async function runTrendRegimeStrategy(symbol: string): Promise<StrategyResult> {
  // Existing logic moved here
  const klines4h = await fetchKlinesWithFallback(symbol, '4h', 1000);
  const klines15m = await fetchKlinesWithFallback(symbol, '15m', 1000);

  if (klines4h.length < 200 || klines15m.length < 50) return null;

  const closes4h = klines4h.map((k: any) => k.close);
  const highs4h = klines4h.map((k: any) => k.high);
  const lows4h = klines4h.map((k: any) => k.low);

  const ema200_4h = calculateEMA(closes4h, 200);
  const adx_4h = calculateADX(highs4h, lows4h, closes4h, 14);

  const latest4hIdx = klines4h.length - 1;
  const currentAdx = adx_4h[latest4hIdx] || 0;
  const currentEma200 = ema200_4h[latest4hIdx] || 0;
  const prevEma200 = ema200_4h[latest4hIdx - 1] || 0;
  const slope = prevEma200 ? ((currentEma200 - prevEma200) / prevEma200) * 100 : 0;

  let regime = "WEAK_RANGE";
  if (currentAdx > 25 && Math.abs(slope) > 0.05) regime = "STRONG_TREND";
  else if (currentAdx > 20) regime = "WEAK_TREND";
  else if (currentAdx < 18) regime = "STRONG_RANGE";

  const closes15m = klines15m.map((k: any) => k.close);
  const highs15m = klines15m.map((k: any) => k.high);
  const lows15m = klines15m.map((k: any) => k.low);

  const ema20_15m = calculateEMA(closes15m, 20);
  const atr_15m = calculateATR(highs15m, lows15m, closes15m, 14);

  const latest15mIdx = klines15m.length - 1;
  const price = closes15m[latest15mIdx];
  const atr = atr_15m[latest15mIdx] || 0;

  let direction = 0;
  let rr = 0;
  let entry_low = 0;
  let entry_high = 0;
  let stop = 0;
  let target = 0;

  if (regime.includes("TREND")) {
    direction = price > ema20_15m[latest15mIdx] ? 1 : -1;
    rr = regime === "STRONG_TREND" ? 2.0 : 1.3;
    entry_low = price - direction * atr * 0.8;
    entry_high = price - direction * atr * 0.3;
    stop = entry_low - direction * atr * 0.5;
    const risk = Math.abs(entry_high - stop);
    target = entry_high + direction * risk * rr;
  } else if (regime.includes("RANGE")) {
    const last20Highs = highs15m.slice(-20);
    const last20Lows = lows15m.slice(-20);
    const high20 = Math.max(...last20Highs);
    const low20 = Math.min(...last20Lows);
    const entry_buffer = atr * 0.5;
    let sell_low, sell_high, buy_low, buy_high;

    if (symbol === "BTCUSDT") {
      sell_low = high20 - entry_buffer;
      sell_high = high20 + entry_buffer;
      buy_low = low20 - entry_buffer;
      buy_high = low20 + entry_buffer;
    } else {
      sell_low = high20 - atr;
      sell_high = high20 + atr * 0.8;
      buy_low = low20 - atr;
      buy_high = low20 + atr * 0.8;
    }

    if (Math.abs(price - sell_low) < Math.abs(price - buy_high)) {
      direction = -1;
      entry_low = sell_low;
      entry_high = sell_high;
      stop = sell_high + atr;
      rr = 1.5;
      const risk = Math.abs(entry_high - stop);
      target = entry_high - risk * rr;
    } else {
      direction = 1;
      entry_low = buy_low;
      entry_high = buy_high;
      stop = buy_low - atr;
      rr = 1.5;
      const risk = Math.abs(entry_high - stop);
      target = entry_high + risk * rr;
    }
  } else {
    return null;
  }

  const zoneMin = Math.min(entry_low, entry_high);
  const zoneMax = Math.max(entry_low, entry_high);

  const logs = [
    `Analyzing: ${symbol}`,
    `4H Regime: ${regime}`,
    `4H ADX: ${currentAdx.toFixed(2)}`,
    `4H EMA200 Slope: ${slope.toFixed(4)}%`,
    `15m Price: ${price.toFixed(2)}`,
    `15m ATR: ${atr.toFixed(2)}`,
    `15m EMA20: ${ema20_15m[latest15mIdx].toFixed(2)}`,
    `Decision: ${direction === 1 ? 'LONG' : 'SHORT'} Signal Active`
  ];

  return {
    symbol,
    time: new Date().toISOString(),
    regime,
    price,
    direction: direction === 1 ? 'LONG' : 'SHORT',
    entry_low: zoneMin,
    entry_high: zoneMax,
    stop,
    target,
    rr,
    logs
  };
}

async function runStructuralReversalStrategy(symbol: string): Promise<StrategyResult> {
  const logs: string[] = [`Analyzing: ${symbol}`];
  
  const klines4h = await fetchKlinesWithFallback(symbol, '4h', 500);
  const { highs: swingHighs4h, lows: swingLows4h } = getSwingPoints(klines4h, 3);
  const rsi4h = calculateRSI(klines4h.map(k => k.close), 14).pop() || 0;
  
  let { trend, direction, highs, lows } = detectTrend(klines4h, swingHighs4h, swingLows4h);
  let activeKlines = klines4h;
  let activeSwingHighs = swingHighs4h;
  let activeSwingLows = swingLows4h;

  logs.push(`4H Trend: ${trend}`);
  logs.push(`Last 3 Swing Highs (4H): ${highs.slice(-3).map(v => v.toFixed(2)).join(', ')}`);
  logs.push(`Last 3 Swing Lows (4H): ${lows.slice(-3).map(v => v.toFixed(2)).join(', ')}`);
  logs.push(`Current 4H RSI: ${rsi4h.toFixed(2)}`);

  if (trend === "RANGE") {
    logs.push(`⚠ 4H Structure Not Clean (Transitional Market)`);
    logs.push(`>>> 啟動 1H 局部趨勢掃描...`);
    
    const klines1h = await fetchKlinesWithFallback(symbol, '1h', 500);
    const { highs: swingHighs1h, lows: swingLows1h } = getSwingPoints(klines1h, 3);
    const trend1hResult = detectTrend(klines1h, swingHighs1h, swingLows1h);
    
    if (trend1hResult.trend === "RANGE") {
      logs.push(`⚠ 1H 依然為 RANGE，啟動 [區間流動性監控模式]`);
      const rangeHigh = highs.length > 0 ? highs[highs.length - 1] : Math.max(...klines4h.map(k => k.high));
      const rangeLow = lows.length > 0 ? lows[lows.length - 1] : Math.min(...klines4h.map(k => k.low));
      
      logs.push(`Liquidity High (潛在做空區): ${rangeHigh.toFixed(2)}`);
      logs.push(`Liquidity Low (潛在做多區): ${rangeLow.toFixed(2)}`);
      logs.push(`⏳ 結論：等待價格觸及邊界，尋找假突破 (Sweep) 訊號。`);
      
      const price = klines4h[klines4h.length - 1].close;
      const atr = calculateATR(klines4h.map(k => k.high), klines4h.map(k => k.low), klines4h.map(k => k.close), 14).pop() || 0;

      const isNearHigh = Math.abs(price - rangeHigh) < atr;
      const isNearLow = Math.abs(price - rangeLow) < atr;

      if (isNearHigh) {
        return {
          symbol, time: new Date().toISOString(), regime: "LIQUIDITY_SWEEP_HIGH", price,
          direction: 'SHORT', entry_low: rangeHigh - atr * 0.5, entry_high: rangeHigh + atr * 0.5,
          stop: rangeHigh + atr, target: rangeLow, rr: (rangeHigh - rangeLow) / atr, logs
        };
      } else if (isNearLow) {
        return {
          symbol, time: new Date().toISOString(), regime: "LIQUIDITY_SWEEP_LOW", price,
          direction: 'LONG', entry_low: rangeLow - atr * 0.5, entry_high: rangeLow + atr * 0.5,
          stop: rangeLow - atr, target: rangeHigh, rr: (rangeHigh - rangeLow) / atr, logs
        };
      }
      return {
        symbol, time: new Date().toISOString(), regime: "RANGE_WAITING", price,
        direction: 'LONG', entry_low: 0, entry_high: 0, stop: 0, target: 0, rr: 0, logs
      };
    } else {
      logs.push(`✅ 找到 1H 局部趨勢: ${trend1hResult.trend}`);
      trend = trend1hResult.trend;
      direction = trend1hResult.direction;
      activeKlines = klines1h;
      activeSwingHighs = swingHighs1h;
      activeSwingLows = swingLows1h;
    }
  }

  const impulse = findImpulse(activeKlines, activeSwingHighs, activeSwingLows, direction!);
  if (!impulse) {
    logs.push(`❌ Could not find impulse leg`);
    return {
      symbol, time: new Date().toISOString(), regime: "NO_IMPULSE", price: activeKlines[activeKlines.length-1].close,
      direction: 'LONG', entry_low: 0, entry_high: 0, stop: 0, target: 0, rr: 0, logs
    };
  }

  const { prz_low, prz_high } = calculatePRZ(impulse.low, impulse.high, direction!);
  logs.push(`Impulse Leg Low: ${impulse.low.toFixed(2)}`);
  logs.push(`Impulse Leg High: ${impulse.high.toFixed(2)}`);
  logs.push(`PRZ Zone: ${prz_low.toFixed(2)} - ${prz_high.toFixed(2)}`);

  const klines15m = await fetchKlinesWithFallback(symbol, '15m', 200);
  const price = klines15m[klines15m.length - 1].close;
  const rsi15m = calculateRSI(klines15m.map(k => k.close), 14).pop() || 0;
  const atr = calculateATR(klines15m.map(k => k.high), klines15m.map(k => k.low), klines15m.map(k => k.close), 14).pop() || 0;

  logs.push(`15m Current Price: ${price.toFixed(2)}`);
  logs.push(`15m RSI: ${rsi15m.toFixed(2)}`);

  const div = detectDivergence(klines15m);
  const { bullish: isBullishEngulf, bearish: isBearishEngulf } = detectEngulfing(klines15m);
  
  logs.push(`15m Divergence: ${div || 'None'}`);
  logs.push(`Bullish Engulfing: ${isBullishEngulf}`);
  logs.push(`Bearish Engulfing: ${isBearishEngulf}`);

  const recentHigh = Math.max(...klines15m.slice(-20).map(k => k.high));
  const recentLow = Math.min(...klines15m.slice(-20).map(k => k.low));
  
  logs.push(`15m Recent High: ${recentHigh.toFixed(2)}`);
  logs.push(`15m Recent Low: ${recentLow.toFixed(2)}`);

  const bos_up = price > recentHigh;
  const bos_down = price < recentLow;
  
  logs.push(`BOS Up: ${bos_up}`);
  logs.push(`BOS Down: ${bos_down}`);

  const isInPRZ = price >= Math.min(prz_low, prz_high) && price <= Math.max(prz_low, prz_high);

  if (direction === "UP" && isInPRZ) {
    logs.push(`🔥 LONG PRZ ACTIVE`);
    const isLongSignal = div === "BULLISH_DIV" || isBullishEngulf;
    if (isLongSignal) {
      return {
        symbol, time: new Date().toISOString(), regime: `PRZ_REVERSAL_${trend}`, price,
        direction: 'LONG', entry_low: prz_low, entry_high: prz_high,
        stop: impulse.low, target: impulse.high, rr: (impulse.high - price) / (price - impulse.low), logs
      };
    }
  } else if (direction === "DOWN" && isInPRZ) {
    logs.push(`🔥 SHORT PRZ ACTIVE`);
    const isShortSignal = div === "BEARISH_DIV" || isBearishEngulf;
    if (isShortSignal) {
      return {
        symbol, time: new Date().toISOString(), regime: `PRZ_REVERSAL_${trend}`, price,
        direction: 'SHORT', entry_low: prz_low, entry_high: prz_high,
        stop: impulse.high, target: impulse.low, rr: (price - impulse.low) / (impulse.high - price), logs
      };
    }
  } else {
    logs.push(`⏳ Waiting for PRZ touch`);
  }

  return {
    symbol, time: new Date().toISOString(), regime: isInPRZ ? "PRZ_WAITING_SIGNAL" : "WAITING_FOR_PRZ", price,
    direction: direction === "UP" ? 'LONG' : 'SHORT', entry_low: prz_low, entry_high: prz_high,
    stop: direction === "UP" ? impulse.low : impulse.high, 
    target: direction === "UP" ? impulse.high : impulse.low, 
    rr: 0, logs
  };
}

export async function runStrategy(symbol: string, strategyId: string = 'trend_regime'): Promise<StrategyResult> {
  try {
    if (strategyId === 'structural_reversal') {
      return await runStructuralReversalStrategy(symbol);
    } else {
      return await runTrendRegimeStrategy(symbol);
    }
  } catch (error) {
    console.error("Strategy execution failed:", error);
    return null;
  }
}
