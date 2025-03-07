require('dotenv').config();
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const https = require('https');
const cloudinary = require('cloudinary').v2;


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
    const imageId = message.image?.id; // Capturar el ID de la imagen
    // Si el mensaje contiene una imagen
    if (imageId) {
      handleIncomingMessage({ from: user, image: { id: imageId } }); // Pasar el ID de la imagen
    } else {
      // Manejar mensajes de texto y botones normalmente
      handleIncomingMessage({ from: user, body: text, button: { payload: buttonId } });
    }
  }

  res.sendStatus(200);
});

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY,  
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, 

});
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

const uploadImageToCloudinary = async (fileBuffer, folder) => {
  try {
    // Primero, verificar si el buffer es válido
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('Buffer de imagen vacío o no válido');
    }

    // Detectar el tipo de imagen basado en la cabecera (first few bytes)
    const imageType = fileBuffer.toString('base64').slice(0, 10);

    // Detectar si la imagen es PNG o JPG
    let imageFormat = 'jpeg'; // Por defecto, tratamos la imagen como JPEG
    if (imageType === 'iVBORw0K') {
      imageFormat = 'png'; // Si es PNG, cambiamos el formato
    }

    // Convertir el buffer a base64 correctamente
    const base64Image = fileBuffer.toString('base64');
    const imageData = `data:image/${imageFormat};base64,${base64Image}`;

    // Subir la imagen a Cloudinary
    const result = await cloudinary.uploader.upload(imageData, {
      folder: folder,
      upload_preset: UPLOAD_PRESET,
      resource_type: 'image', // Aseguramos que es una imagen
    });
    return result.secure_url; // Devuelve la URL de la imagen subida
  } catch (error) {
    throw error;
  }
};



async function getImageUrl(imageId) {
  try {
    const response = await axios.get(`https://graph.facebook.com/v15.0/${imageId}`, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    });
    if (response.data && response.data.url) {   
      return response.data.url; // Devolver la URL de la imagen
    } else {
      throw new Error('No se pudo obtener la URL de la imagen.');
    }
  } catch (error) {
    throw error;
  }
}


async function downloadImageFromWhatsApp(imageId) {
  try {
    const imageUrl = await getImageUrl(imageId); // Obtén la URL de la imagen
    const response = await axios.get(imageUrl, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
      responseType: 'arraybuffer', // Descargar la imagen como un ArrayBuffer
    });

    const contentType = response.headers['content-type'];
    if (contentType && contentType.startsWith('image/')) {
 
      return response.data; // Devuelve el ArrayBuffer con la imagen
    } else {
      throw new Error('El archivo descargado no es una imagen.');
    }
  } catch (error) {
   
    throw error;
  }
}


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


async function sendDateSelection(user) {
  await sendButtons(
    user,
    "📆 Selecciona la fecha:",
    [
      { type: "reply", reply: { id: "hoy", title: "Hoy" } },
      { type: "reply", reply: { id: "ayer", title: "Ayer" } },
      { type: "reply", reply: { id: "personalizada", title: "Personalizada" } },
    ]
  );
}

// Función para formatear la fecha en DD/MM/AAAA
const formatDate = (date) => {
  const day = String(date.getDate()).padStart(2, '0'); // Asegura 2 dígitos
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Los meses empiezan en 0
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};


// Función para enviar botones con opción de cancelar
const sendButtonsWithCancel = async (user, message, buttons) => {
  const buttonsWithCancel = [
    ...buttons,
    { type: "reply", reply: { id: "cancelar", title: "Cancelar" } },
  ];
  await sendButtons(user, message, buttonsWithCancel);
};

async function handleIncomingMessage(message) {
  const user = message.from;
  const text = message.body?.trim().toLowerCase() || '';
  const buttonId = message.button?.payload || message.button?.id || text;
  const imageId = message.image?.id;

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
      } else if (buttonId === "Cancelar") {
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

    case "awaiting_vendor_code":
      if (buttonId === "Cancelar") {
        userData[user].step = "awaiting_another_operation";
        await sendButtons(
          user,
          "¿Deseas realizar otra operación?", 
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      } else {
        userData[user].vendorCode = text;
        userData[user].step = "awaiting_identification";
        await sendMessage(user, "🔐 Ahora ingresa tu Contraseña:");
      }
      break;

    case "awaiting_identification":
  if (buttonId === "❌ Cancelar") {
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
    userData[user].identification = text;
    const validationResult = await validateUser(userData[user].vendorCode, userData[user].identification);

    if (validationResult.isValid) {
      await sendMessage(user, `✅ Bienvenido ${validationResult.name}.`);

      // Si el usuario es administrador, mostrar el menú de administrador
      if (validationResult.isAdmin) {
        userData[user].step = "awaiting_admin_decision";
        await sendButtonsWithCancel(
          user,
          "¿Qué deseas realizar?",
          [
            { type: "reply", reply: { id: "agregar_ingreso", title: "Agregar Ingreso" } },
            { type: "reply", reply: { id: "agregar_egreso", title: "Agregar Egreso" } },
          ]
        );
      } else {
        // Si no es administrador, continuar con el flujo de ingresos
        userData[user].step = "awaiting_ingreso_decision";
        await sendButtonsWithCancel(
          user,
          "¿Deseas realizar un ingreso?", 
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      }
    } else {
      await sendMessage(user, "❌ Datos incorrectos. Intenta de nuevo.");
      delete userData[user];
      await sendMessage(user, "🔑 Ingresa tu Usuario:");
    }
  }
  break;

case "awaiting_ingreso_decision":
  if (buttonId === "si") {
    userData[user].step = "awaiting_description"; // Avanzar al paso de descripción
    await sendMessage(user, "📝 Ingresa una descripción para el ingreso:");
  } else if (buttonId === "no") {
    userData[user].step = "awaiting_another_operation"; // Preguntar si desea realizar otra operación
    await sendButtons(
      user,
      "¿Quieres realizar otra operación?", 
      [
        { type: "reply", reply: { id: "si", title: "Sí" } },
        { type: "reply", reply: { id: "no", title: "No" } },
      ]
    );
  } else if (buttonId === "cancelar") {
    userData[user].step = "awaiting_another_operation"; // Preguntar si desea realizar otra operación
    await sendButtons(
      user,
      "¿Quieres realizar otra operación?", 
      [
        { type: "reply", reply: { id: "si", title: "Sí" } },
        { type: "reply", reply: { id: "no", title: "No" } },
      ]
    );
  } else {
    await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona 'Sí' o 'No'.");
  }
  break;

    case "awaiting_admin_decision":
      if (buttonId === "agregar_ingreso") {
        userData[user].step = "awaiting_description";
        await sendMessage(user, "📝 Ingresa una descripción para el ingreso:");
      } else if (buttonId === "agregar_egreso") {
        userData[user].step = "awaiting_categoria_egreso";
        await sendCategoriaEgreso(user); // Mostrar categorías de egresos
      } else if (buttonId === "Cancelar") {
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

    case "awaiting_categoria_egreso":
      if (buttonId === "❌ cancelar") {
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
        const categoriaSeleccionada = buttonId || text;
        if (!categoriaSeleccionada || categoriaSeleccionada.trim() === "") {
          await sendMessage(user, "❌ No se seleccionó una categoría válida. Intenta de nuevo.");
          return;
        }

        userData[user].categoria = categoriaSeleccionada;
        userData[user].step = "awaiting_subcategoria_egreso";
        await sendSubCategoriaEgreso(user, userData[user].categoria);
      }
      break;

    case "awaiting_subcategoria_egreso":
      if (buttonId === "Cancelar") {
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
        userData[user].subcategoria = text;
        userData[user].step = "awaiting_descripcion_egreso";
        await sendMessage(user, "📝 Ingresa una descripción para el egreso:");
      }
      break;

    case "awaiting_descripcion_egreso":
      if (buttonId === "❌ Cancelar") {
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
        userData[user].descripcion = text;
        userData[user].step = "awaiting_monto_egreso";
        await sendMessage(user, "💰 Ingresa el monto:");
      }
      break;

    case "awaiting_monto_egreso":
      if (buttonId === "❌ Cancelar") {
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
        userData[user].monto = text;
        userData[user].step = "awaiting_image_decision_egreso";
        await sendButtonsWithCancel(
          user,
          "¿Quieres adjuntar una imagen?",
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      }
      break;

    case "awaiting_image_decision_egreso":
      if (buttonId === "❌ Cancelar") {
        userData[user].step = "awaiting_another_operation";
        await sendButtons(
          user,
          "¿Quieres realizar otra operación?", 
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      } else if (buttonId === "no") {
        await sendMessage(user, "Perfecto, seguimos con el proceso.");
        userData[user].step = "awaiting_date_egreso";
        await sendDateSelection(user);
      } else if (buttonId === "si") {
        await sendMessage(user, "📸 Adjunta una imagen desde tu galería (Opcional).");
        userData[user].step = "awaiting_image_egreso";
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona 'Sí' o 'No'.");
      }
      break;

    case "awaiting_image_egreso":
      if (imageId) {
        try {
          const imageBuffer = await downloadImageFromWhatsApp(imageId);
          const cloudinaryUrl = await uploadImageToCloudinary(imageBuffer, 'egresos');
          userData[user].imageUrl = cloudinaryUrl;
          await sendMessage(user, `¡Imagen recibida y guardada! Ahora selecciona la fecha.`);
          userData[user].step = "awaiting_date_egreso";
          await sendDateSelection(user);
        } catch (error) {
          await sendMessage(user, "❌ Hubo un error al procesar la imagen. Intenta de nuevo.");
        }
      } else {
        await sendMessage(user, "No se recibió una imagen válida. Intenta de nuevo.");
      }
      break;

    case "awaiting_date_egreso":
      if (buttonId === "Cancelar") {
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
        let egresoDate;
        if (buttonId === "hoy") {
          const today = new Date();
          egresoDate = formatDate(today); // Formatear la fecha
        } else if (buttonId === "ayer") {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          egresoDate = formatDate(yesterday); // Formatear la fecha
        } else if (buttonId === "personalizada") {
          await sendMessage(user, "Por favor, ingresa la fecha en formato DD/MM/AAAA:");
          userData[user].step = "awaiting_custom_date_egreso";
          return;
        } else {
          await sendMessage(user, "❓ No entendí tu respuesta. Intenta de nuevo.");
          await sendDateSelection(user);
          return;
        }

        userData[user].date = egresoDate;

        // Guardar en la hoja de Egresos
        const sheetEgresos = doc.sheetsByTitle['Egresos'];
        await sheetEgresos.addRow({
          Fecha: userData[user].date,
          Descripcion: userData[user].descripcion,
          Vendedor: userData[user].vendorCode,
          Categoria: userData[user].categoria,
          SubCategoria: userData[user].subcategoria,
          Monto: userData[user].monto,
          URL: userData[user].imageUrl || '',
        });

        await sendMessage(
          user,
          `📊 *Reporte de Egreso:*\n\nFecha: ${userData[user].date}\nCódigo de Vendedor: ${userData[user].vendorCode}\nCategoría: ${userData[user].categoria}\nSubcategoría: ${userData[user].subcategoria}\nMonto: ${userData[user].monto}\nDescripción: ${userData[user].descripcion}\n\nEgreso registrado exitosamente.`
        );

        userData[user].step = "awaiting_another_operation";
        await sendButtons(
          user,
          "¿Quieres realizar otra operación?", 
          [
            { type: "reply", reply: { id: "si", title: "Sí" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ]
        );
      }
      break;

    case "awaiting_description":
      userData[user].description = text;
      userData[user].step = "awaiting_amount";
      await sendMessage(user, "💰 Ingresa el monto:");
      break;

    case "awaiting_amount":
      userData[user].amount = text;
      userData[user].step = "awaiting_image_decision";
      await sendButtons(
        user,
        "¿Quieres adjuntar una imagen?",
        [
          { type: "reply", reply: { id: "si", title: "Sí" } },
          { type: "reply", reply: { id: "no", title: "No" } },
        ]
      );
      break;

    case "awaiting_image_decision":
      if (buttonId === "no") {
        await sendMessage(user, "Perfecto, seguimos con el proceso.");
        userData[user].step = "awaiting_date";
        await sendDateSelection(user);
      } else if (buttonId === "si") {
        await sendMessage(user, "📸 Adjunta una imagen desde tu galería.");
        userData[user].step = "awaiting_image";
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Por favor, selecciona 'Sí' o 'No'.");
      }
      break;

    case "awaiting_image":
      if (imageId) {
        try {
          const imageBuffer = await downloadImageFromWhatsApp(imageId);
          const cloudinaryUrl = await uploadImageToCloudinary(imageBuffer, 'ingresos');
          userData[user].imageUrl = cloudinaryUrl;
          await sendMessage(user, `¡Imagen recibida y guardada! Ahora selecciona la fecha 📆.`);
          userData[user].step = "awaiting_date";
          await sendDateSelection(user);
        } catch (error) {
          await sendMessage(user, "❌ Hubo un error al procesar la imagen. Intenta de nuevo.");
        }
      } else {
        await sendMessage(user, "No se recibió una imagen válida. Intenta de nuevo.");
      }
      break;

    case "awaiting_date":
      let date;
      if (buttonId === "hoy") {
        const today = new Date();
        date = formatDate(today); // Formatear la fecha
      } else if (buttonId === "ayer") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        date = formatDate(yesterday); // Formatear la fecha
      } else if (buttonId === "personalizada") {
        await sendMessage(user, "Por favor, ingresa la fecha en formato DD/MM/AAAA:");
        userData[user].step = "awaiting_custom_date";
        return;
      } else {
        await sendMessage(user, "❓ No entendí tu respuesta. Intenta de nuevo.");
        await sendDateSelection(user);
        return;
      }

      userData[user].date = date;

      // Guardar en Google Sheets
      const sheet = doc.sheetsByTitle['Ingresos'];
      await sheet.addRow({
        Fecha: userData[user].date,
        Descripcion: userData[user].description,
        CodigoVendedor: userData[user].vendorCode,
        Monto: userData[user].amount,
        URL: userData[user].imageUrl || '',
      });

      await sendMessage(
        user,
        `📊 *Reporte:*\n\nFecha: ${userData[user].date}\nCódigo de Vendedor: ${userData[user].vendorCode}\nMonto: ${userData[user].amount}\nDescripción: ${userData[user].description}\n\nIngresado exitosamente.`
      );

      userData[user].step = "awaiting_another_operation";
      await sendButtons(
        user,
        "¿Quieres realizar otra operación?", 
        [
          { type: "reply", reply: { id: "si", title: "Sí" } },
          { type: "reply", reply: { id: "no", title: "No" } },
        ]
      );
      break;

    case "awaiting_custom_date":
      const customDate = text;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(customDate)) {
        userData[user].date = customDate;

        const sheet = doc.sheetsByTitle['Ingresos'];
        await sheet.addRow({
          Fecha: userData[user].date,
          Descripcion: userData[user].description,
          CodigoVendedor: userData[user].vendorCode,
          Monto: userData[user].amount,
          URL: userData[user].imageUrl || '',
        });

        await sendMessage(
          user,
          `📊 *Reporte:*\n\nFecha: ${userData[user].date}\nCódigo de Vendedor: ${userData[user].vendorCode}\nMonto: ${userData[user].amount}\nDescripción: ${userData[user].description}\n\nIngresado exitosamente.`
        );

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
        await sendMessage(user, "❌ Formato de fecha incorrecto. Por favor, ingresa la fecha en formato DD/MM/AAAA.");
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

// Función para mostrar categorías de egresos
async function sendCategoriaEgreso(user) {
  try {
    // Acceder a la hoja de Google Sheets llamada "CategoriasEgreso"
    const sheet = doc.sheetsByTitle['CategoriasEgreso'];
    const rows = await sheet.getRows(); // Obtener todas las filas de la hoja

    // Extraer las categorías de la columna "Nombre" (primera columna)
    const categorias = rows.map(row => row._rawData[0]);

    // Verificar si hay categorías disponibles
    if (categorias.length === 0) {
      await sendMessage(user, "No hay categorías disponibles. Por favor, contacta con un administrador.");
      return;
    }

    // Crear botones para cada categoría
    const buttons = categorias.map(categoria => ({
      type: "reply",
      reply: { id: categoria, title: categoria },
    }));

    // Enviar los botones al usuario
    await sendButtons(
      user,
      "Selecciona una categoría:",
      buttons
    );
  } catch (error) {
    console.error("Error al obtener las categorías de egresos:", error);
    await sendMessage(user, "❌ Hubo un error al obtener las categorías. Intenta de nuevo.");
  }
}

async function sendSubCategoriaEgreso(user, categoria) {
  try {
    // Verificar si la categoría está vacía
    if (!categoria || categoria.trim() === "") {
   
      await sendMessage(user, "❌ No se seleccionó una categoría válida. Intenta de nuevo.");
      return;
    }

    // Acceder a la hoja de Google Sheets llamada "SubCategoriaEgreso"
    const sheet = doc.sheetsByTitle['SubCategoriaEgreso'];
    const rows = await sheet.getRows(); // Obtener todas las filas de la hoja

    // Filtrar las subcategorías que pertenecen a la categoría seleccionada
    const subCategorias = rows
      .filter(row => {
        const nombreCategoria = row._rawData[0]?.trim(); // Columna "Nombre"
        return nombreCategoria === categoria.trim(); // Comparación exacta
      })
      .map(row => row._rawData[1]?.trim()); // Columna "Vendedor"

    // Si hay subcategorías, mostrarlas como botones
    if (subCategorias.length > 0) {
      // Crear botones para cada subcategoría
      const buttons = subCategorias.map(subCategoria => ({
        type: "reply",
        reply: { id: subCategoria, title: subCategoria },
      }));

      // Enviar los botones al usuario
      await sendButtons(
        user,
        "Selecciona una subcategoría:",
        buttons
      );
    } else {
      // Si no hay subcateggorías, continuar con el siguiente paso
      userData[user].subcategoria = ""; // No hay subcategoría
      userData[user].step = "awaiting_descripcion_egreso"; // Saltar al siguiente paso
      await sendMessage(user, "📝 Ingresa una descripción para el egreso:");
    }
  } catch (error) {
    console.error("Error al obtener las subcategorías de egresos:", error);
    await sendMessage(user, "❌ Hubo un error al obtener las subcategorías. Intenta de nuevo.");
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