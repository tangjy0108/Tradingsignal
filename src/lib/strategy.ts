import { calculateEMA, calculateATR, calculateADX } from './indicators';

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

export async function runStrategy(symbol: string): Promise<StrategyResult> {
  try {
    // Fetch 4H data (need at least 200 candles for EMA200, but fetch 1000 for better EMA warmup accuracy)
    const klines4h = await fetchKlinesWithFallback(symbol, '4h', 1000);

    // Fetch 15m data (need at least 50 candles for EMA20 and ATR14, but fetch 1000 for better EMA warmup accuracy)
    const klines15m = await fetchKlinesWithFallback(symbol, '15m', 1000);

    if (klines4h.length < 200 || klines15m.length < 50) {
      console.error("Not enough data to run strategy");
      return null;
    }

    // --- Regime Engine (4H) ---
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

    // --- Strategy Logic (15m) ---
    const closes15m = klines15m.map((k: any) => k.close);
    const highs15m = klines15m.map((k: any) => k.high);
    const lows15m = klines15m.map((k: any) => k.low);

    const ema20_15m = calculateEMA(closes15m, 20);
    const atr_15m = calculateATR(highs15m, lows15m, closes15m, 14);

    const latest15mIdx = klines15m.length - 1;
    const price = closes15m[latest15mIdx];
    const atr = atr_15m[latest15mIdx] || 0;
    const ema20 = ema20_15m[latest15mIdx] || 0;

    let direction = 0;
    let rr = 0;
    let entry_low = 0;
    let entry_high = 0;
    let stop = 0;
    let target = 0;

    if (regime.includes("TREND")) {
      direction = price > ema20 ? 1 : -1;
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
      } else { // ETH-USDT or others
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
      return null; // No signal
    }

    const zoneMin = Math.min(entry_low, entry_high);
    const zoneMax = Math.max(entry_low, entry_high);

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
      rr
    };
  } catch (error) {
    console.error("Strategy execution failed:", error);
    return null;
  }
}
