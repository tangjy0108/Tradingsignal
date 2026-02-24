async function test() {
  const res = await fetch('https://api.kucoin.com/api/v1/market/candles?type=15min&symbol=BTC-USDT');
  const json = await res.json();
  console.log(json.data.slice(0, 2));
}
test();
