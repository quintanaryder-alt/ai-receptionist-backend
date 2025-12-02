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

  // Answer call and record caller speech
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

    // Download audio
    const audio = await fetch(recordingUrl);
    const buffer = Buffer.from(await audio.arrayBuffer());

    // Transcribe with Whisper
    const transcript = await openai.audio.transcriptions.create({
      file: new File([buffer], "audio.wav", { type: "audio/wav" }),
      model: "gpt-4o-mini-transcribe"
    });

    const text = transcript.text;

    // Generate reply
    const chat = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an AI receptionist. Be friendly, concise, and helpful."
        },
        { role: "user", content: text }
      ]
    });

    const reply = chat.choices[0].message.content;

    // Respond to Twilio with voice
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(reply);
    twiml.redirect("/twilio/voice");

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error(err);

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("Sorry, I’m having trouble responding right now.");
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

// PORT
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("AI Receptionist server running on port", PORT));
