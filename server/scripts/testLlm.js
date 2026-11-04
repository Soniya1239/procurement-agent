import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

console.log('Testing Gemini LLM connection...');
console.log(`🔑 LLM key loaded: ${!!process.env.LLM_API_KEY}, length: ${process.env.LLM_API_KEY?.length || 0}`);
console.log(`🤖 Using model: ${process.env.LLM_MODEL || 'gemini-1.5-flash (default)'}`);

async function testLlm() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.LLM_API_KEY });
    const model = process.env.LLM_MODEL || 'gemini-1.5-flash';
    
    console.log('\nSending prompt: "Reply with the word OK"');
    
    const response = await ai.models.generateContent({
      model,
      contents: [{ text: 'Reply with the word OK' }]
    });

    console.log('\n✅ Success!');
    console.log('Response:', response.text);
  } catch (error) {
    console.error('\n❌ Error:');
    console.error(error.message);
    console.error('\nFull error details:');
    console.error(error);
  }
}

testLlm();
