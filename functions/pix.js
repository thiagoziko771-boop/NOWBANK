const { getSupabase } = require("./lib/supabase");

const NOWHUB_BASE = "https://api.nowhubpay.com";
const NOWHUB_CLIENT_ID = process.env.NOWHUB_CLIENT_ID;
const NOWHUB_CLIENT_SECRET = process.env.NOWHUB_CLIENT_SECRET;
const UTMIFY_TOKEN = "lzASZob4ldSJJc3jT1LILy9alPxWJgpnPhCh";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cache para token JWT e UTMify
const tokenCache = {};
const utmifyCache = new Map();
const CACHE_TTL = 60000;

// Obter token JWT da NowHubPay
async function getNowHubToken() {
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  if (!NOWHUB_CLIENT_ID || !NOWHUB_CLIENT_SECRET) {
    throw new Error("❌ NOWHUB_CLIENT_ID ou NOWHUB_CLIENT_SECRET não configurados!");
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
    
    console.log("[NowHub] ✓ Token obtido com sucesso");
    return data.access_token;
  } catch (err) {
    throw new Error(`Falha ao autenticar com NowHub: ${err.message}`);
  }
}

async function sendUtmify(transactionId, status, customer, amountCents, createdAt, utms) {
  if (utmifyCache.has(transactionId)) {
    console.log("[UTMify] Skipping duplicate for:", transactionId);
    return;
  }

  utmifyCache.set(transactionId, true);
  setTimeout(() => utmifyCache.delete(transactionId), CACHE_TTL);

  try {
    const gatewayFeeCents = Math.round(amountCents * 0.02);
    const netCents = amountCents - gatewayFeeCents;
    const payload = {
      orderId: transactionId,
      platform: "NowHubPay",
      paymentMethod: "pix",
      status,
      createdAt: createdAt || new Date().toISOString().replace("T"," ").slice(0,19),
      approvedDate: status === "paid" ? new Date().toISOString().replace("T"," ").slice(0,19) : null,
      customer: {
        name: customer.name || null,
        email: customer.email || null,
        phone: customer.phone || null,
        document: customer.cpf || null,
        country: "BR",
        ip: "177.0.0.1",
      },
      products: [{
        id: "loja-shopify-br-001",
        name: "SHOPIFY LOJA 03",
        quantity: 1,
        priceInCents: amountCents,
      }],
      trackingParameters: {
        utm_source: utms?.utm_source || null,
        utm_campaign: utms?.utm_campaign || null,
        utm_medium: utms?.utm_medium || null,
        utm_content: utms?.utm_content || null,
        utm_term: utms?.utm_term || null,
      },
      commission: {
        totalPriceInCents: amountCents,
        gatewayFeeInCents: gatewayFeeCents,
        userCommissionInCents: netCents,
        currency: "BRL",
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    await fetch("https://api.utmify.com.br/api-credentials/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": UTMIFY_TOKEN },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    console.log("[UTMify] ✓ Enviado para:", transactionId);
  } catch (err) {
    console.error("[UTMify] Erro (não bloqueia):", err.message);
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
    body: JSON.stringify(body),
  };
}

function gerarCpfValido() {
  const d = new Array(9);
  for (let i = 0; i < 9; i++) {
    d[i] = Math.floor(Math.random() * 10);
  }
  
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += d[i] * (10 - i);
  }
  let resto = soma % 11;
  d[9] = resto < 2 ? 0 : 11 - resto;
  
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += d[i] * (11 - i);
  }
  resto = soma % 11;
  d[10] = resto < 2 ? 0 : 11 - resto;
  
  return d.join('');
}

function fmtPhone(phone) {
  if (!phone) return "11999999999";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return digits;
  if (digits.length === 10) return digits;
  return digits;
}

exports.handler = async (event) => {
  console.log("[PIX-NOWHUB] ===== FUNÇÃO INICIADA =====");
  console.log("[PIX-NOWHUB] NOWHUB_CLIENT_ID exists:", !!NOWHUB_CLIENT_ID);
  console.log("[PIX-NOWHUB] NOWHUB_CLIENT_SECRET exists:", !!NOWHUB_CLIENT_SECRET);
  
  if (!NOWHUB_CLIENT_ID || !NOWHUB_CLIENT_SECRET) {
    console.error("❌ ERRO: Credenciais NowHubPay não configuradas na Netlify!");
    return jsonResponse(500, {
      success: false,
      error: "Credenciais da gateway não configuradas",
      debug: "NOWHUB_CLIENT_ID ou NOWHUB_CLIENT_SECRET não encontrados"
    });
  }

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { body = {}; }

  const randId = Math.random().toString(36).slice(2,10);
  
  // Aceita o amount enviado pelo frontend, ou usa 65.70 por padrão
  const rawAmount = body.amount ?? body.valor ?? body.total ?? 65.70;
  const amountReais = Number(rawAmount) || 65.70;
  const amountCents = Math.round(amountReais * 100);

  const customerName = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString().trim();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@gmail.com`).toString().trim();
  const customerPhone = fmtPhone(body.phone || body.customer_phone || "11999999999");
  const cpfRaw = (body.cpf || body.document || body.customer_cpf || "").toString().replace(/\D/g, "");
  const customerCpf = cpfRaw.length === 11 ? cpfRaw : gerarCpfValido();
  const utms = body.utm || {};
  const externalRef = `order_${randId}`;

  console.log("[PIX-NOWHUB] Amount:", amountReais, "Cents:", amountCents);
  console.log("[PIX-NOWHUB] Customer:", { name: customerName, email: customerEmail, cpf: customerCpf });

  // Obter token
  let token;
  try {
    token = await getNowHubToken();
  } catch (err) {
    console.error("❌ [PIX-NOWHUB] Token error:", err.message);
    return jsonResponse(500, {
      success: false,
      error: "Falha ao autenticar com gateway",
      debug: err.message
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const payload = {
      amount: amountReais,
      external_id: externalRef,
      payer: {
        name: customerName,
        document: customerCpf
      },
      clientCallbackUrl: "https://cnh-brasil-gov-br.netlify.app/webhook/payment"
    };

    console.log("[PIX-NOWHUB] Payload:", JSON.stringify(payload, null, 2));

    const resp = await fetch(`${NOWHUB_BASE}/v1/payments/deposit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await resp.text();
    if (!resp.ok) {
      let errMsg = text;
      try { errMsg = JSON.parse(text)?.detail || JSON.parse(text)?.title || errMsg; } catch {}
      console.error("[NowHub] Erro HTTP:", resp.status, errMsg);
      return jsonResponse(resp.status, {
        success: false,
        error: errMsg,
        debug: { status: resp.status, body: text.substring(0, 200) }
      });
    }

    let parsed = {};
    try { parsed = JSON.parse(text); } catch {
      console.error("[NowHub] Parse error:", text.substring(0, 200));
      return jsonResponse(500, {
        success: false,
        error: "Resposta inválida da gateway",
        debug: text.substring(0, 200)
      });
    }

    const transactionId = parsed.transaction_id || null;
    const pixCode = parsed.pix_copy_paste || null;

    if (!transactionId || !pixCode) {
      console.error("[NowHub] Resposta incompleta:", { transactionId, pixCode });
      return jsonResponse(500, {
        success: false,
        error: "Gateway retornou resposta incompleta",
        debug: { transaction: transactionId, pix: !!pixCode }
      });
    }

    console.log("[PIX-NOWHUB] ===== PIX GERADO COM SUCESSO =====");
    console.log("[PIX-NOWHUB] Transaction ID:", transactionId);
    console.log("[PIX-NOWHUB] PIX Code: ✓ Existe");

    // Salvar no Supabase (não bloqueia)
    if (SUPABASE_URL && SUPABASE_KEY) {
      try {
        const supabase = getSupabase();
        await supabase.from("transactions").insert({
          transaction_id: transactionId,
          amount: amountReais,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_cpf: customerCpf,
          customer_phone: customerPhone,
          status: "pending",
          brcode: pixCode,
          utm_source: utms.utm_source || null,
          utm_campaign: utms.utm_campaign || null,
          utm_medium: utms.utm_medium || null,
        });
        console.log("[Supabase] ✓ Salvo:", transactionId);
      } catch (err) {
        console.error("[Supabase] Erro (continuando):", err.message);
      }
    }

    // Notificar UTMify (não bloqueia)
    await sendUtmify(
      transactionId, "waiting_payment",
      { name: customerName, email: customerEmail, phone: customerPhone, cpf: customerCpf },
      amountCents,
      new Date().toISOString().replace("T"," ").slice(0,19),
      utms
    ).catch(err => console.error("[SendUtmify] Erro:", err.message));

    return jsonResponse(200, {
      success: true,
      pixCode,
      pix_code: pixCode,
      brcode: pixCode,
      payload: pixCode,
      qr_code_image: parsed.pix_qr_code || null,
      transaction_id: transactionId,
      transactionId,
      deposit_id: transactionId,
      status: "pending",
    });

  } catch (err) {
    console.error("[PIX-NOWHUB] Erro ao chamar gateway:", err.message);
    return jsonResponse(502, {
      success: false,
      error: "Falha ao conectar com gateway: " + String(err)
    });
  }
};
