require('dotenv').config();
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const port = process.env.PORT || 8080;

// Configuración de Express
const app = express();
app.use(bodyParser.json());

// Cargar el token de verificación desde el archivo .env
const webhookToken = process.env.WEBHOOK_TOKEN;

// Configurar el endpoint del webhook para la verificación GET
app.get('/webhook', (req, res) => {
  const challenge = req.query['hub.challenge'];
  const verify_token = req.query['hub.verify_token'];

  if (verify_token === webhookToken) {
    return res.status(200).send(challenge);
  } else {
    return res.status(403).send('Token no válido');
  }
});

// Configurar el webhook para recibir mensajes
app.post('/webhook', async (req, res) => {
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const message = changes?.value?.messages?.[0];

  if (message) {
    const user = message.from;
    const text = message.text?.body || '';
    const buttonId = message.interactive?.button_reply?.id;

    handleIncomingMessage({ from: user, body: text, button: { payload: buttonId } });
  }

  res.sendStatus(200);
});

// Obtén el token de acceso y el ID del número desde las variables de entorno
const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

// URL base de la API de WhatsApp Business
const url = `https://graph.facebook.com/v15.0/${phoneNumberId}/messages`;

// Configuración de Google Sheets
const SHEET_ID = '1D5ZLTPJSP_U6DaQYa8bVhqULXvluKpIoCvjk0yeNhzw'; // Reemplaza con tu ID de Google Sheets
const CREDS = require('./bot-whatsapp-453022-de97ef12ab0a.json'); // Asegúrate de que este archivo JSON existe

// Crear cliente JWT para autenticación
const serviceAccountAuth = new JWT({
  email: CREDS.client_email,
  key: CREDS.private_key.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Inicializar el documento de Google Sheets con autenticación
const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);

// Función para conectar a Google Sheets
async function accessSpreadsheet() {
  try {
    await doc.loadInfo(); // Cargar la información del documento
  } catch (error) {
    console.error('Error al cargar la información del documento:', error);
  }
}

// Objeto para almacenar datos temporales del usuario
const userData = {};

// Función para enviar un mensaje
const sendMessage = async (to, message) => {
  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: to,
        text: {
          body: message,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error al enviar el mensaje:', error);
  }
};

// Función para enviar botones
const sendButtons = async (to, bodyText, buttons) => {
  try {
    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: bodyText, // Texto del cuerpo (obligatorio)
          },
          action: {
            buttons: buttons.map(button => ({
              type: 'reply',
              reply: {
                id: button.reply.id,
                title: button.reply.title,
              },
            })),
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error al enviar los botones:', error);
  }
};

async function validateUser(vendorCode, identification) {
  try {
    const sheet = doc.sheetsByTitle['Clientes']; // Asegúrate de que el nombre de la hoja sea "Clientes"
    const rows = await sheet.getRows(); // Obtener todas las filas

    // Buscar el código de vendedor en la columna B (index 1)
    const row = rows.find((row) => row._rawData[1] === vendorCode); // Columna B es el índice 1

    if (row) {
      // Si encuentra el código de vendedor, verificar la identificación en la columna C (index 2)
      if (row._rawData[2] === identification) {
        // Si la identificación coincide, devolver el nombre de la columna A (index 0) y verificar si es administrador
        const name = row._rawData[0]; // Columna A es el índice 0
        const isAdmin = name === "Administrador"; // Verificar si el nombre es "Administrador"
        return { isValid: true, name, isAdmin }; // Devolver el nombre y si es administrador
      }
    }

    // Si no encuentra coincidencia, devolver false
    return { isValid: false };
  } catch (error) {
    throw error; // Lanzar el error para manejarlo en el flujo principal
  }
}

async function handleIncomingMessage(message) {
  const user = message.from;
  const text = message.body?.trim().toLowerCase() || '';
  const buttonId = message.button?.payload || message.button?.id || text;

  // Si es la primera vez que el usuario escribe al bot, preguntamos si tiene usuario
  if (!userData[user]) {
    userData[user] = { step: "awaiting_initial_option" };
    await sendMessage(user, "👋 Hola, Bienvenido al Bot Administrativo. ¿Tienes cuenta?");
    await sendButtons(
      user,
      "Selecciona una opción",
      [
        { type: "reply", reply: { id: "ya_tengo_usuario", title: "Ya tengo Usuario" } },
        { type: "reply", reply: { id: "no_tengo_usuario", title: "No tengo Usuario" } },
      ]
    );
    return;
  }

  // Flujo para ingreso
  switch (userData[user].step) {
    case "awaiting_initial_option":
      if (buttonId === "no_tengo_usuario") {
        await sendMessage(user, "❌ Por favor, contacta con un administrador para solicitar la creación de un Usuario.");
        delete userData[user];
      } else if (buttonId === "ya_tengo_usuario") {
        userData[user].step = "awaiting_vendor_code"; // Continuamos con la validación
        await sendMessage(user, "🔑 Ingresa tu Usuario:");
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona una opción válida.");
      }
      break;

    case "awaiting_vendor_code":
      userData[user].vendorCode = text;
      userData[user].step = "awaiting_identification";
      await sendMessage(user, "🔐 Ahora ingresa tu Contraseña:");
      break;

    case "awaiting_identification":
      userData[user].identification = text;
      const validationResult = await validateUser(userData[user].vendorCode, userData[user].identification);

      if (validationResult.isValid) {
        await sendMessage(user, `✅ Bienvenido ${validationResult.name}.`);

        // Si el usuario es administrador, mostrar el menú de administrador
        if (validationResult.isAdmin) {
          userData[user].step = "awaiting_admin_decision";
          await sendButtons(
            user,
            "¿Qué deseas realizar?",
            [
              { type: "reply", reply: { id: "notificar_pago", title: "Notificar Pago" } },
              { type: "reply", reply: { id: "egresar_pago", title: "Egresar Pago" } },
            ]
          );
        } else {
          // Si no es administrador, mostrar solo la opción de notificar pago
          userData[user].step = "awaiting_notificar_pago";
          await sendButtons(
            user,
            "¿Deseas notificar un pago?",
            [
              { type: "reply", reply: { id: "notificar_pago", title: "Notificar Pago" } },
            ]
          );
        }
      } else {
        await sendMessage(user, "❌ Datos incorrectos. Intenta de nuevo.");
        delete userData[user];
        await sendMessage(user, "🔑 Ingresa tu Usuario:");
      }
      break;

    case "awaiting_admin_decision":
      if (buttonId === "notificar_pago") {
        await sendMessage(user, "Por favor, ingresa a este enlace para notificar tu pago: https://lotsystemform.onrender.com/FormularioIngresos.html");
        userData[user].step = "awaiting_another_operation";
        await sendButtons(
          user,
          "¿Quieres realizar otra operación?",
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      } else if (buttonId === "egresar_pago") {
        await sendMessage(user, "Por favor, ingresa a este enlace para egresar tu pago: https://lotsystemform.onrender.com/FormularioEgresos.html");
        userData[user].step = "awaiting_another_operation";
        await sendButtons(
          user,
          "¿Quieres realizar otra operación?",
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona una opción válida.");
      }
      break;

    case "awaiting_notificar_pago":
      if (buttonId === "notificar_pago") {
        await sendMessage(user, "Por favor, ingresa a este enlace para notificar tu pago: https://lotsystemform.onrender.com/FormularioIngresos.html");
        userData[user].step = "awaiting_another_operation";
        await sendButtons(
          user,
          "¿Quieres realizar otra operación?",
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona una opción válida.");
      }
      break;

    case "awaiting_another_operation":
      if (buttonId === "si") {
        userData[user].step = "awaiting_vendor_code";
        await sendMessage(user, "🔑 Ingresa tu código de vendedor:");
      } else if (buttonId === "no") {
        await sendMessage(user, "Gracias por usar el Bot Administrativo. ¡Hasta luego!");
        delete userData[user];
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona 'Sí' o 'No'.");
      }
      break;

    default:
      await sendMessage(user, "❓ No entendí tu respuesta. Intenta de nuevo.");
      delete userData[user];
      await sendMessage(user, "👋 Hola, Bienvenido a Bot Administrativo. ¿Tienes cuenta?");
  }
}

// Iniciar el servidor y conectar a Google Sheets
async function startServer() {
  await accessSpreadsheet(); // Conectar a Google Sheets antes de iniciar el servidor
  app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
  });
}

// Iniciar el servidor
startServer().catch((error) => {
  console.error('Error al iniciar el servidor:', error);
});