import fetch from "node-fetch";
import express from "express";
import multer from "multer";
import { OpenAI } from "openai";
import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();
const upload = multer();
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Init OpenAI + Twilio
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// 🛜 TWILIO CALL WEBHOOK (incoming call)
app.post("/twilio/voice", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  twiml.say("Hello, thanks for calling. How can I help you today?");
  twiml.record({
    action: "/twilio/transcribe",
    transcribe: false,
    playBeep: true,
    timeout: 3
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

// 📝 TRANSCRIBE AUDIO & RESPOND
app.post("/twilio/transcribe", upload.none(), async (req, res) => {
  try {
    const recordingUrl = req.body.RecordingUrl + ".wav";

    const audio = await fetch(recordingUrl);
    const buffer = Buffer.from(await audio.arrayBuffer());

    const transcript = await openai.audio.transcriptions.create({
      file: new File([buffer], "audio.wav", { type: "audio/wav" }),
      model: "gpt-4o-mini-transcribe"
    });

    const text = transcript.text;

    const chat = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are an AI receptionist for a barbershop.

Your job:
1. Answer calls politely.
2. Understand what the caller wants.
3. If the caller wants to book, extract:
   - name
   - phone (use req.body.From if none given)
   - service
   - date
   - time

Return ONLY this JSON when booking intent is detected:

{
  "intent": "booking",
  "name": "caller name",
  "phone": "caller number",
  "service": "haircut",
  "date": "2025-01-04",
  "time": "15:00"
}

No extra explanation. No extra text.
`
        },
        { role: "user", content: text }
      ]
    });

    let reply = chat.choices[0].message.content;

    // Detect JSON
    let bookingData = null;
    try {
      bookingData = JSON.parse(reply);
    } catch (e) {}

    // IF booking JSON found
    if (bookingData && bookingData.intent === "booking") {
      console.log("Booking request detected:", bookingData);

      // Send to Make.com
      try {
        await fetch(process.env.MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bookingData)
        });
        console.log("Booking sent to Make.com");
      } catch (err) {
        console.error("Error sending booking to Make.com:", err);
      }

      // Respond to caller
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say("Perfect. I'm sending your booking now.");
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // If NOT booking → normal conversation response
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(reply);
    twiml.redirect("/twilio/voice");
    res.type("text/xml");
    res.send(twiml.toString());

  } catch (err) {
    console.error(err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("Sorry, I'm having trouble.");
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

// PORT
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log("AI Receptionist server running on port", PORT)
);
