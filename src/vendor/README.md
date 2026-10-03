# Vendored browser dependencies

These exact, pinned browser builds are stored locally so an installed CashPad
PWA can start and use QR features without reaching a CDN.

| File | Upstream version | SHA-256 |
| --- | --- | --- |
| `firebase-app-compat.js` | Firebase 11.6.0 | `902B2C80B0FAA840A65B5DC6563FF126E464C22C6ABE1242C50E53BC545DA1BF` |
| `firebase-firestore-compat.js` | Firebase 11.6.0 | `41CD9763C07883170B463FE4BBCD0B75477A36252FB840AD350F81927212C584` |
| `firebase-app-check-compat.js` | Firebase 11.6.0 | `9ED6AD4FDFDB033D48B5D878995E13E589FB9CD135469C30BE0C91D0A567495A` |
| `qrcode.min.js` | qrcode-generator 1.4.4 | `BB2365E4902F4F84852CF4025E6F6A60325A682AEAFA43FB63B7FC8F098D1EF2` |
| `html5-qrcode.min.js` | html5-qrcode 2.3.8 | `660B12437B1D747E3E68B8BE0685C08CB728140110AD213F167B14B66F8B1D8E` |

Sources:

- `https://www.gstatic.com/firebasejs/11.6.0/`
- `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/`
- `https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/`
