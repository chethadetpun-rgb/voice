import { GoogleGenAI, Modality } from "@google/genai";

export async function generateSpeech(text: string, voiceName: string): Promise<string> {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      throw new Error("ไม่สามารถสร้างเสียงได้ กรุณาลองใหม่อีกครั้ง");
    }

    return base64Audio;
  } catch (error) {
    console.error("Gemini API error:", error);
    if (error instanceof Error) {
        return Promise.reject(new Error(`เกิดข้อผิดพลาดในการเชื่อมต่อกับ Gemini API: ${error.message}`));
    }
    return Promise.reject(new Error("เกิดข้อผิดพลาดที่ไม่รู้จักในการเชื่อมต่อกับ Gemini API"));
  }
}
