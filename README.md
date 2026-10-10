<div align="center">

  <img src="./src/icons/icon.svg" width="96" alt="CashPad logo" />

  <h1>CashPad</h1>

  <p>Shared expenses without the group-chat math.</p>

  <p>
    <a href="https://cashpadapp.vercel.app"><strong>Open CashPad ↗</strong></a>
  </p>

</div>

---

## De onde veio

O CashPad nasceu de uma necessidade bem simples dentro da república onde moro: registrar os gastos da casa rapidamente e dividir cada compra com as pessoas certas, sem depender de planilhas ou ficar fazendo conta no grupo.

Hoje, honestamente, não vivo mais sem isso aqui. A galera de casa também começou a usar e o sistema continua evoluindo conforme o caos do dia a dia exige novas features. Basicamente, o nosso teto virou o ambiente de testes diários.

## What it does

- **Flexible splits** — split a total equally or assign individual items.
- **Live balances** — see how much each person paid, owes or should receive.
- **Payment tracking** — register settlements without losing the expense history.
- **Simple sharing** — invite people through a short code or QR code and export summaries to WhatsApp.
- **Cross-device sync** — keep the same block updated across different devices.

## How it works

1. Create a shared expense block.
2. Add people and record expenses.
3. Follow the balances and settle payments.

No accounts, spreadsheets or manual calculations between roommates.

## Built with

`Vanilla JavaScript` · `Firebase Firestore` · `Vercel`

<details>
<summary><strong>Technical notes</strong></summary>

- Framework-free frontend built with HTML, CSS and JavaScript.
- Firebase Firestore for shared data and real-time synchronization.
- Firebase security rules for data access.
- Installable as a Progressive Web App.
- Previously opened blocks remain available during temporary connection loss.
- Production deployment handled through Vercel.

</details>

## Development

```bash
npm run deploy
```

The deployment script updates the service worker version before publishing the application.

## License

Personal project. All rights reserved.
