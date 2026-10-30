import { createApp } from "./app.js";
import { iniciarCronRecordatorios } from "./recordatorios.js";

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => console.log(`API escuchando en :${port}`));
iniciarCronRecordatorios();
