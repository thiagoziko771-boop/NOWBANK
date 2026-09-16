/**
 * CONFIGURAÇÃO CENTRAL - Valores padronizados
 * Mudar aqui afeta TODO o sistema: frontend, backend, pixels
 * 
 * GATEWAY: NowHubPay
 */

const CONFIG = {
  // Valor padrão do PIX em REAIS
  DEFAULT_AMOUNT: 65.70,
  
  // Detalhamento da taxa
  AMOUNTS: {
    TED: 17.00,      // Taxa banco
    TSA: 21.50,      // Taxa intermediária
    TPE: 27.20,      // Taxa plataforma
    TOTAL: 65.70     // Valor final (será cobrado 65.70)
  },
  
  // Loja
  STORE_NAME: "SHOPIFY LOJA 03",
  
  // Gateway
  GATEWAY: "NowHubPay",
  GATEWAY_URL: "https://api.nowhubpay.com",
  
  // Facebook Pixel IDs
  FACEBOOK_PIXELS: [
    "4327697327497010",
    "1078834241324397",
    "1527029111971432"
  ],
  
  // UTMify
  UTMIFY_PIXEL_ID: "6a2200f2ae65ba8b4e8c85c7",
  
  // Supabase
  SUPABASE_TABLE: "transactions"
};

// Export para Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
