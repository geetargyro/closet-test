export async function handler(event) {
  const upc = (event.queryStringParameters?.upc || "").trim();
  if (!upc) return { statusCode: 400, body: JSON.stringify({ error: "Missing upc" }) };

  // Test response (server-side). Later we replace this section with real UPC lookup + real offers.
  const response = {
    product: { upc, title: `Server Product for UPC ${upc.slice(-6)}`, brand: "Server Demo" },
    localTop3: [
      { seller:"Target (Pickup)", channel:"LOCAL", price:19.99, shipping:0, taxRate:0.0825, discounts:0, inStock:true },
      { seller:"Walmart (Pickup)", channel:"LOCAL", price:20.49, shipping:0, taxRate:0.0825, discounts:0, inStock:true },
      { seller:"Best Buy (Pickup)", channel:"LOCAL", price:22.99, shipping:0, taxRate:0.0825, discounts:2.00, inStock:true }
    ],
    nationalTop3: [
      { seller:"Amazon", channel:"NATIONAL", price:18.49, shipping:4.99, taxRate:0.0825, discounts:0, inStock:true },
      { seller:"eBay", channel:"NATIONAL", price:17.99, shipping:6.50, taxRate:0.0, discounts:0, inStock:true },
      { seller:"Brand Site", channel:"NATIONAL", price:21.99, shipping:0.00, taxRate:0.0825, discounts:5.00, inStock:true }
    ],
    trueCheapest: {
      total: 18.80,
      why: "Server response: discount/free shipping reduced the final total.",
      breakdown: [{ seller:"Brand Site", subtotal:21.99, shipping:0, tax:1.81, discounts:5.00, total:18.80 }]
    },
    runnerUp: {
      total: 24.49,
      why: "Runner-up: shipping made the final total higher.",
      breakdown: [{ seller:"eBay", subtotal:17.99, shipping:6.50, tax:0, discounts:0, total:24.49 }]
    },
    triggers: {
      nonObviousWinner: true,
      closeCall: false,
      highStakes: false,
      uncertainInputs: true,
      priceMismatch: false,
      bundlingSavings: true,
      dataFreshnessRisk: false
    },
    fetchedAt: Date.now()
  };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(response)
  };
}
