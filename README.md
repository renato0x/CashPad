# CashPad

Dividir gastos entre amigos e grupos de forma simples, rapida e offline-first.

**Live:** [cashpadapp.vercel.app](https://cashpadapp.vercel.app)

---

## O que e

PWA mobile-first para anotar despesas, dividir contas e calcular saldos entre pessoas. Funciona offline, sincroniza entre dispositivos via Firebase Firestore e exporta resumo para WhatsApp.

## Funcionalidades

- **Gastos simples** — valor unico dividido entre participantes
- **Gastos com itens** — cada item com valor e participantes proprios
- **Saldo em tempo real** — bruto (te devem / voce deve) e liquido por pessoa
- **Pagamentos** — confirmacao em 1 toque para quitar dividas
- **Compartilhar** — exporta resumo formatado para WhatsApp
- **Offline-first** — funciona sem internet, sincroniza ao reconectar
- **Dark mode** — sincroniza entre dispositivos via Firestore
- **QR Code** — compartilhe o codigo do bloco via QR
- **PWA** — instavel no celular como app nativo

### Funcionamento offline

- Depois do primeiro acesso, o app, Firebase e recursos de QR ficam armazenados no dispositivo.
- Blocos ja abertos podem ser consultados e alterados sem internet; as mudancas entram em uma fila local e sincronizam ao reconectar.
- Criar um bloco ou baixar um bloco pela primeira vez exige conexao para validar o codigo no servidor.
- O banner informa quando os dados estao locais, pendentes de sincronizacao ou quando o navegador nao oferece persistencia duravel.

## Como usar

1. Acesse [cashpadapp.vercel.app](https://cashpadapp.vercel.app)
2. Crie um bloco novo (gera um codigo de 6 caracteres)
3. Adicione pessoas, registre gastos e acompanhe os saldos

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML, CSS, JavaScript (vanilla) |
| Backend/DB | Firebase Firestore |
| Hospedagem | Vercel |
| PWA | Service Worker + Web App Manifest |

## Estrutura do projeto

```
CashPad/
├── package.json          # Scripts de deploy
├── predeploy.js          # Bump da versao do SW antes de cada deploy
├── firebase.json         # Configuracao do Firebase
├── firestore.rules       # Regras de seguranca do Firestore
└── src/
    ├── index.html        # HTML principal
    ├── sw.js             # Service Worker (cache offline)
    ├── manifest.json     # PWA manifest
    ├── vercel.json       # Headers de seguranca (CSP, HSTS, etc.)
    ├── robots.txt        # Diretivas para crawlers
    ├── sitemap.xml       # Sitemap para SEO
    ├── firebase-config.js # Configuracao do Firebase (chave publica)
    ├── vendor/            # Dependencias fixadas para inicializacao offline
    ├── css/
    │   └── styles.css    # Estilos (design receipt/papel)
    ├── js/
    │   └── app.js        # Logica principal da aplicacao
    └── icons/
        ├── icon-192.png  # Icone PWA 192x192
        ├── icon-512.png  # Icone PWA 512x512
        └── icon.svg      # Icone vetorial
```

## Deploy

```bash
# Instalar dependencias (nao ha — e vanilla JS)
# Bump da versao do SW + deploy no Vercel
npm run deploy
```

## Licenca

Projeto pessoal. Todos os direitos reservados.
