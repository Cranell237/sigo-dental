// Genera docs/mfa-demo-qr.png: código QR del secreto TOTP de demostración para escanearlo con
// Microsoft Authenticator, Google Authenticator o Authy. Uso: npm run qr-mfa -w api
import QRCode from "qrcode";

const url = "otpauth://totp/SIGO-Dental:demo%40sigo.test?secret=JBSWY3DPEHPK3PXP&issuer=SIGO-Dental&algorithm=SHA1&digits=6&period=30";
await QRCode.toFile("../docs/mfa-demo-qr.png", url, { width: 320, margin: 2 });
console.log("docs/mfa-demo-qr.png generado");
