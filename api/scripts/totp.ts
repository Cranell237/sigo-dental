// Muestra el código TOTP actual de los usuarios de demostración (alternativa a una app autenticadora).
// Uso: npm run totp -w api
import { authenticator } from "otplib";

const SECRETO = "JBSWY3DPEHPK3PXP";
const restante = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Código MFA: ${authenticator.generate(SECRETO)}  (válido ${restante} s más)`);
