const { getSupabase } = require("./lib/supabase");

const NOWHUB_BASE = "https://api.nowhubpay.com";
const NOWHUB_CLIENT_ID = process.env.NOWHUB_CLIENT_ID;
const NOWHUB_CLIENT_SECRET = process.env.NOWHUB_CLIENT_SECRET;
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";

// Cache para token JWT
const tokenCache = {};

async function getNowHubToken() {
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  if (!NOWHUB_CLIENT_ID || !NOWHUB_CLIENT_SECRET) {
    throw new Error("NOWHUB_CLIENT_ID ou NOWHUB_CLIENT_SECRET não configurados");
  }

  try {
    const response = await fetch(`${NOWHUB_BASE}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: NOWHUB_CLIENT_ID,
        client_secret: NOWHUB_CLIENT_SECRET
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Auth failed: ${data.detail || data.title}`);
    }

    tokenCache.token = data.access_token;
    tokenCache.expiresAt = Date.now() + (data.expires_in * 1000) - 60000;
    
    return data.access_token;
  } catch (err) {
    throw new Error(`Falha ao autenticar com NowHub: ${err.message}`);
  }
}

async function sendUtmifyPaid(txData, transactionId) {
  try {
    const amountCents = Math.round((txData.amount || 65.70) * 100);
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const payload = {
      orderId: transactionId,
      platform: "NowHubPay",
      paymentMethod: "pix",
      status: "paid",
      createdAt: txData.createdAt || new Date().toISOString().replace("T"," ").slice(0,19),
      approvedDate: new Date().toISOString().replace("T"," ").slice(0,19),
      customer: {
        name: txData.customer_name || null,
        email: txData.customer_email || null,
        phone: txData.customer_phone || null,
        document: txData.customer_cpf || null,
        country: "BR",
        ip: "177.0.0.1"
      },
      products: [{
        id: "loja-shopify-br-001",
        name: "SHOPIFY LOJA 03",
        quantity: 1,
        priceInCents: amountCents,
      }],
      trackingParameters: {
        utm_source: txData.utm_source || null,
        utm_campaign: txData.utm_campaign || null,
        utm_medium: txData.utm_medium || null,
      },
      commission: {
        totalPriceInCents: amountCents,
        gatewayFeeInCents: gatewayFeeCents,
        userCommissionInCents: amountCents - gatewayFeeCents,
        currency: "BRL"
      },
    };
    
    await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN },
      body: JSON.stringify(payload)
    });
  } catch(err) {
    console.error("[UTMify]", err);
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: ""
    };
  }

  let transactionId = event.queryStringParameters?.id || event.queryStringParameters?.transactionId;
  if (event.httpMethod === "POST") {
    try {
      const b = event.body ? JSON.parse(event.body) : {};
      transactionId = b?.transactionId || b?.id || transactionId;
    } catch {}
  }
  if (!transactionId) {
    return jsonResponse(400, { success: false, error: "Informe o transactionId" });
  }

  let token;
  try {
    token = await getNowHubToken();
  } catch (err) {
    console.error("[CheckPaymentNowHub] Credenciais inválidas:", err.message);
    return jsonResponse(500, {
      success: false,
      error: "Credenciais não configuradas",
      debug: err.message
    });
  }

  let statusResp, text = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    statusResp = await fetch(
      `${NOWHUB_BASE}/v1/transactions/${encodeURIComponent(transactionId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        signal: controller.signal
      }
    );
    text = await statusResp.text();
    clearTimeout(timeout);
  } catch(err) {
    return jsonResponse(502, {
      success: false,
      error: "Falha ao consultar status: " + String(err)
    });
  }

  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }

  const data = parsed || {};
  const rawStatus = (data.status || "PENDING").toUpperCase();

  // NowHubPay statuses: WAITING_PAYMENT | PENDING | PROCESSING | COMPLETED | FAILED | CANCELED | REJECTED | RETIDO
  const paid = rawStatus === "COMPLETED";
  let status;
  if (paid) status = "paid";
  else if (rawStatus === "REJECTED" || rawStatus === "FAILED" || rawStatus === "CANCELED") status = "rejected";
  else if (rawStatus === "RETIDO") status = "blocked";
  else status = "pending";

  try {
    const supabase = getSupabase();
    if (paid) {
      const { data: txData } = await supabase
        .from("transactions")
        .select("status,customer_name,customer_email,customer_phone,customer_cpf,amount,created_at,utm_source,utm_campaign,utm_medium")
        .eq("transaction_id", transactionId)
        .single();
      const alreadyPaid = txData?.status === "paid";
      await supabase.from("transactions").update({
        status: "paid",
        paid_at: new Date().toISOString()
      }).eq("transaction_id", transactionId);
      if (!alreadyPaid && txData) await sendUtmifyPaid(txData, transactionId);
    } else {
      await supabase.from("transactions").update({ status }).eq("transaction_id", transactionId);
    }
  } catch(err) {
    console.error("[Supabase] Erro ao atualizar status (continuando):", err.message);
  }

  return jsonResponse(200, {
    success: true,
    transactionId,
    status,
    paid
  });
};
