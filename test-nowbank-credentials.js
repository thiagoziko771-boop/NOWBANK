/**
 * Teste com as credenciais do NowBank (NOWBANK.git)
 */

const NOWHUB_BASE = "https://api.nowhubpay.com";
const NOWHUB_CLIENT_ID = "cli_15abcbafb56a6521";
const NOWHUB_CLIENT_SECRET = "sec_4e9f4d28a87db26ef504b5d5bf563ce53a4ea44dfd27be42";

async function testAuth() {
  console.log("\n🔐 TESTE 1: Autenticação NowBank");
  console.log("=" .repeat(70));

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

    if (response.ok && data.access_token) {
      console.log("✅ Autenticação com sucesso!");
      console.log(`   Token: ${data.access_token.substring(0, 30)}...`);
      console.log(`   Expires in: ${data.expires_in}s`);
      return data.access_token;
    } else {
      console.log("❌ Erro na autenticação!");
      console.log(`   Status: ${response.status}`);
      console.log(`   Erro: ${data.detail || data.title || JSON.stringify(data)}`);
      return null;
    }
  } catch (err) {
    console.log(`❌ Erro: ${err.message}`);
    return null;
  }
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

async function testPixGeneration(token, amount) {
  console.log(`\n💳 TESTE 2: Gerar PIX (R$ ${amount})`);
  console.log("=" .repeat(70));

  if (!token) {
    console.log("❌ Token não disponível!");
    return null;
  }

  const randId = Math.random().toString(36).slice(2, 10);
  const cpf = gerarCpfValido();

  const payload = {
    amount: amount,
    external_id: `order_${randId}`,
    payer: {
      name: "Teste NowBank",
      document: cpf
    },
    clientCallbackUrl: "https://cnh-brasil-gov-br.netlify.app/webhook/payment"
  };

  try {
    const response = await fetch(`${NOWHUB_BASE}/v1/payments/deposit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data = {};
    
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("❌ Erro ao fazer parse!");
      return null;
    }

    if (response.ok && data.transaction_id && data.pix_copy_paste) {
      console.log("✅ PIX GERADO COM SUCESSO!");
      console.log(`   Transaction ID: ${data.transaction_id}`);
      console.log(`   Amount: R$ ${data.amount}`);
      console.log(`   Status: ${data.status}`);
      console.log(`   ✓ PIX Code: Sim`);
      
      return data.transaction_id;
    } else {
      console.log("❌ Erro ao gerar PIX!");
      console.log(`   Status: ${response.status}`);
      console.log(`   Erro: ${data.detail || data.title || JSON.stringify(data)}`);
      return null;
    }
  } catch (err) {
    console.log(`❌ Erro: ${err.message}`);
    return null;
  }
}

async function runTests() {
  console.log("\n🚀 TESTE NOWBANK - Credenciais Completas");
  console.log("=" .repeat(70));

  const token = await testAuth();
  if (!token) {
    console.log("\n❌ Falha na autenticação. Interrompendo.");
    return;
  }

  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const txId1 = await testPixGeneration(token, 65.70);
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const txId2 = await testPixGeneration(token, 79.40);

  console.log("\n" + "=" .repeat(70));
  console.log("📊 RESUMO");
  console.log("=" .repeat(70));
  
  if (token && txId1 && txId2) {
    console.log("✅ TUDO FUNCIONANDO!");
    console.log("   Autenticação: ✓");
    console.log("   PIX 65.70: ✓");
    console.log("   PIX 79.40: ✓");
    console.log("\n✅ Credenciais estão corretas!");
    console.log("Configure no Netlify e faça redeploy.");
  } else {
    console.log("❌ Algo não funcionou. Verifique acima.");
  }
}

runTests();
